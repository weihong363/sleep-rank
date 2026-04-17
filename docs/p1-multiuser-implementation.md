# P1 多人系统与闭环实现说明

## 本次实现范围

已在当前本地项目中落地以下 P1 能力（保持现有目录结构）：

1. 用户系统去页面手动切换  
- 创建挑战页移除“切换身份”入口。  
- App 启动时通过 `userEngine.ensureCurrentUser()` 初始化会话用户。  

2. 邀请与组队  
- 参与人状态：`INVITED / JOINED / CONFIRMED`。  
- 自动开赛规则：确认成员数达到 `min(3, 总成员数)` 自动开始。  

2.1 云端同步（微信云开发）  
- 新增云同步引擎：`engines/cloud-sync-engine.js`。  
- 挑战、用户统计、积分账户、积分流水自动上云。  
- 页面 `onShow` 先从云端拉取当前用户可见的最新挑战与历史数据。  
- App 启动时初始化 `wx.cloud` 并拉取云端状态。  

3. 历史记录与日历  
- 新增挑战历史仓储（`CHALLENGE_HISTORY`）。  
- 挑战完成/取消后自动归档。  
- “我的记录”页新增：
  - 本月挑战日历（按日展示 达标/失败/待判定）
  - 历史挑战列表

4. 积分系统（基础版）  
- 新增 `PointAccount` 与 `PointLog` 本地存储。  
- 规则：
  - 挑战完成：+20
  - 挑战失败：-10
  - 邀请成员确认：发起人 +5
  - 连续达标（>=3）：+5
- “我的记录”页新增积分余额与最近积分流水。

## 关键文件

- `engines/challenge-engine.js`
- `engines/challenge-repo.js`
- `engines/cloud-sync-engine.js`
- `engines/point-engine.js`
- `engines/user-engine.js`
- `pages/challenge-create/challenge-create.js`
- `pages/challenge-create/challenge-create.wxml`
- `pages/checkin/checkin.js`
- `pages/checkin/checkin.wxml`
- `pages/checkin/checkin.wxss`
- `tests/run-tests.js`

## 说明

- 当前为“本地存储 + 云端同步”混合架构：本地可离线运行，在线时自动同步。  
- 微信登录采用 `login` 云函数返回 `openid` 并映射本地用户 ID。  
