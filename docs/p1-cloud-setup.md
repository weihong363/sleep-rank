# P1 云端版接入说明（微信云开发）

## 已接入内容

### 核心功能
- 小程序启动时初始化 `wx.cloud`。
- 调用 `login` 云函数获取 `openid`，映射为当前用户。
- 挑战数据自动同步到云数据库集合。
- 页面 `onShow` 时会先从云端刷新当前用户可见数据。
- 云环境配置已抽离到 [cloud-config.js](../config/cloud-config.js)。

### 错误重试机制
- 所有云数据库操作支持指数退避重试
- 最大重试次数：3次
- 初始延迟：1秒，每次翻倍（1s → 2s → 4s）
- 自动记录重试日志，便于排查问题

---

## 云数据库集合清单

### 已创建的集合（5个）

| 集合名称 | 用途 | 关键字段 |
|---------|------|----------|
| `sleep_rank_users` | 用户资料 | id, openid, nickName, avatarUrl |
| `sleep_rank_challenges` | 挑战数据 | id, participantUserIds, status, updatedAt |
| `sleep_rank_user_stats` | 用户统计 | userId, totalScore, completedChallenges |
| `sleep_rank_point_accounts` | 积分账户 | userId, balance, earned, spent |
| `sleep_rank_point_logs` | 积分流水 | id, userId, delta, reason, createdAt |

### 待创建的集合（2个）

| 集合名称 | 用途 | 同步状态 |
|---------|------|----------|
| `sleep_rank_sleep_sessions` | 睡眠会话历史 | ❌ 未实现云端同步 |
| `sleep_rank_daily_results` | 每日判定结果 | ❌ 未实现云端同步 |

**说明：**
- 当前 SleepSession 和 DailyResult 仅存储在本地 storage
- 建议后续版本添加云端同步，支持多设备数据同步和历史查询

---

## 你需要在微信开发者工具完成

### 1. 开通云开发
1. 打开微信开发者工具
2. 点击「云开发」按钮
3. 创建新环境或选择已有环境
4. 记录环境 ID，更新 `config/cloud-config.js` 中的 `envId`

### 2. 部署云函数
需要部署以下 4 个云函数：

#### login（已存在）
```bash
# 在微信开发者工具中
1. 右键 functions/login 目录
2. 选择「上传并部署：云端安装依赖」
3. 等待部署完成
```
**用途：** 获取用户 openid

#### getLeaderboard（新增）
```bash
1. 右键 functions/getLeaderboard 目录
2. 选择「上传并部署：云端安装依赖」
```
**用途：** 获取排行榜数据（挑战内榜/总榜）
**参数：** `{ type: 'challenge' | 'total', challengeId?, limit? }`

#### getChallengeStats（新增）
```bash
1. 右键 functions/getChallengeStats 目录
2. 选择「上传并部署：云端安装依赖」
```
**用途：** 获取挑战统计数据
**参数：** `{ challengeId: string }`

#### batchSync（新增）
```bash
1. 右键 functions/batchSync 目录
2. 选择「上传并部署：云端安装依赖」
```
**用途：** 批量同步数据到云端
**参数：** `{ challenges?, userStats?, pointLogs? }`

### 3. 创建数据库集合
在云开发控制台 -> 数据库 -> 新建集合，创建以下 5 个集合：
- `sleep_rank_users`
- `sleep_rank_challenges`
- `sleep_rank_user_stats`
- `sleep_rank_point_accounts`
- `sleep_rank_point_logs`

### 4. 配置权限
**重要：** 必须配置数据库安全规则，详见 [cloud-security-rules.md](./cloud-security-rules.md)

建议设置为「自定义安全规则」，确保：
- 用户只能读写自己的数据
- 挑战参与者才能查看挑战详情
- 积分等敏感数据禁止前端直接修改

具体配置步骤和规则见专门的安全规则文档。

### 5. 测试流程
1. 进入首页，点击「一键授权」（`wx.getUserProfile`）
2. 检查 `sleep_rank_users` 中是否写入 `nickName/avatarUrl`
3. 创建挑战，检查 `sleep_rank_challenges` 是否有数据
4. 打卡后，检查相关集合是否同步

---  

## 索引配置（重要）

### 必需索引（影响查询性能）

#### sleep_rank_challenges
```javascript
// 联合索引（优先级最高）
{
  participantUserIds: 1,
  status: 1,
  updatedAt: -1
}
```
**用途：** 快速查询用户的活跃挑战

#### sleep_rank_point_logs
```javascript
// 联合索引
{
  userId: 1,
  createdAt: -1
}
```
**用途：** 查询用户积分流水

### 推荐索引（优化查询）

#### sleep_rank_users
```javascript
{
  openid: 1  // 唯一索引
}
```

#### sleep_rank_user_stats
```javascript
{
  userId: 1  // 唯一索引
}
```

#### sleep_rank_point_accounts
```javascript
{
  userId: 1  // 唯一索引
}
```

### 未来索引（待集合创建后配置）

#### sleep_rank_sleep_sessions（待创建）
```javascript
{
  userId: 1,
  sleepStartTime: -1
}
```

#### sleep_rank_daily_results（待创建）
```javascript
{
  userId: 1,
  dateKey: 1,
  challengeId: 1
}
```

**说明：**
- 如果暂时只建了单字段索引，功能通常也能跑
- 但在数据量上来后查询性能不如联合索引
- 建议最终以联合索引为准

---

## 兼容说明

### 离线场景
- 当前仅有重试机制，无离线队列
- 网络异常时数据可能丢失，建议后续添加离线缓存

### 数据迁移
- 首次登录时不会自动同步本地历史数据
- 如需迁移，需手动编写迁移脚本

### 多设备同步
- SleepSession 和 DailyResult 尚未云端同步
- 多设备间数据不一致，建议后续完善

---

## 云函数扩展建议

当前已有 4 个云函数：

| 云函数名 | 用途 | 状态 |
|---------|------|------|
| `login` | 获取用户openid | ✅ 已部署 |
| `getLeaderboard` | 排行榜查询（服务端聚合） | ✅ 已创建 |
| `getChallengeStats` | 挑战统计分析 | ✅ 已创建 |
| `batchSync` | 批量数据同步 | ✅ 已创建 |

后续可扩展：

| 云函数名 | 用途 | 优先级 |
|---------|------|--------|
| `dailySettlement` | 定时任务：日结结算 | 高 |
| `sendNotification` | 发送模板消息通知 | 中 |
| `generateReport` | 生成分享海报 | 低 |

---

## 监控与调试

### 日志查看
- 云开发控制台 -> 云函数 -> 日志
- 搜索关键词：`[cloud-sync]` 可查看同步日志

### 常见问题
1. **同步失败**：检查网络连接、权限配置
2. **查询慢**：检查是否创建了联合索引
3. **数据不一致**：检查重试日志，确认是否达到最大重试次数
