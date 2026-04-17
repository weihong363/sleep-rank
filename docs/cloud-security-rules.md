# SleepRank 云数据库安全规则配置

## 配置说明

在微信云开发控制台 -> 数据库 -> 选择集合 -> 权限设置中，配置以下安全规则。

---

## 1. sleep_rank_users（用户资料）

**权限策略：** 用户只能读写自己的数据

```json
{
  "read": "auth.openid == doc.openid",
  "write": "auth.openid == doc.openid"
}
```

**说明：**
- 只有用户本人可以查看和修改自己的资料
- openid 字段必须与当前登录用户一致

---

## 2. sleep_rank_challenges（挑战数据）

**权限策略：** 挑战参与者才能查看和修改

```json
{
  "read": "auth.openid in get('sleep_rank_challenges')[doc._id].participantUserIds",
  "write": "auth.openid in get('sleep_rank_challenges')[doc._id].participantUserIds && auth.openid == doc.creatorUserId"
}
```

**简化版（推荐）：**
```json
{
  "read": "auth.openid in doc.participantUserIds",
  "write": "auth.openid == doc.creatorUserId"
}
```

**说明：**
- 所有参与者都可以读取挑战详情
- 只有创建者可以修改挑战（邀请成员、取消挑战等）
- 参与者通过客户端 SDK 同步自己的打卡数据

---

## 3. sleep_rank_user_stats（用户统计）

**权限策略：** 用户只能读写自己的统计数据

```json
{
  "read": "auth.openid == doc.userId",
  "write": "auth.openid == doc.userId"
}
```

**说明：**
- 用户只能查看自己的累计统计
- 统计数据由系统自动更新，不建议手动修改

---

## 4. sleep_rank_point_accounts（积分账户）

**权限策略：** 用户只能查看自己的积分，不能直接修改

```json
{
  "read": "auth.openid == doc.userId",
  "write": false
}
```

**说明：**
- 积分只能通过云函数或系统逻辑变更
- 禁止前端直接修改积分余额，防止作弊

---

## 5. sleep_rank_point_logs（积分流水）

**权限策略：** 用户只能查看自己的积分流水

```json
{
  "read": "auth.openid == doc.userId",
  "write": false
}
```

**说明：**
- 积分流水由系统自动记录
- 用户只能查看，不能修改或删除

---

## 6. sleep_rank_sleep_sessions（睡眠会话历史）- 待创建

**权限策略：** 用户只能读写自己的睡眠记录

```json
{
  "read": "auth.openid == doc.userId",
  "write": "auth.openid == doc.userId"
}
```

---

## 7. sleep_rank_daily_results（每日判定结果）- 待创建

**权限策略：** 挑战参与者可查看相关判定结果

```json
{
  "read": "auth.openid == doc.userId",
  "write": false
}
```

**说明：**
- 用户只能查看自己的判定结果
- 判定结果由系统自动生成，禁止手动修改

---

## 通用安全建议

### 1. 数据验证
在云函数中进行二次验证，不要完全依赖前端传来的数据：
```javascript
// 验证用户身份
if (context.OPENID !== event.userId) {
  throw new Error('无权操作');
}
```

### 2. 防作弊措施
- 关键操作使用服务端时间戳：`db.serverDate()`
- 重要计算在服务端完成（如积分结算、排行榜）
- 记录操作日志，便于追溯异常行为

### 3. 权限最小化原则
- 只开放必要的读写权限
- 敏感数据（如积分）禁止前端直接写入
- 使用云函数作为中间层处理复杂逻辑

### 4. 定期审计
- 定期检查数据库访问日志
- 监控异常数据变更
- 及时更新安全规则

---

## 配置步骤

1. 打开微信开发者工具
2. 点击「云开发」按钮
3. 进入「数据库」标签
4. 选择对应集合
5. 点击「权限设置」
6. 选择「自定义安全规则」
7. 粘贴上述 JSON 配置
8. 保存并测试

---

## 测试方法

### 测试读取权限
```javascript
// 应该成功：读取自己的数据
wx.cloud.database().collection('sleep_rank_users')
  .where({ openid: '当前用户openid' })
  .get()

// 应该失败：读取他人数据
wx.cloud.database().collection('sleep_rank_users')
  .where({ openid: '其他用户openid' })
  .get()
```

### 测试写入权限
```javascript
// 应该成功：修改自己的资料
wx.cloud.database().collection('sleep_rank_users')
  .doc('自己的文档ID')
  .update({ data: { nickName: '新昵称' } })

// 应该失败：修改积分
wx.cloud.database().collection('sleep_rank_point_accounts')
  .doc('自己的文档ID')
  .update({ data: { balance: 999999 } })
```
