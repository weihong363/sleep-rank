# SleepRank - 睡眠自律挑战小程序系统设计（MVP导向）

## 1. 项目定位与设计原则

SleepRank 不是“睡眠记录工具”，而是一个“行为游戏系统”。

核心目标：用 **挑战机制 + 社交压力 + 轻量奖励** 让用户更容易形成早睡行为。

设计遵循：
- **游戏化闭环优先**：先跑通“创建挑战 → 打卡 → 判定 → 排行榜”最短路径。
- **可扩展优先**：MVP 不做复杂系统，但数据结构和引擎边界要预留扩展能力。
- **个人开发可维护**：前后端职责清晰、模块内聚、流程可观测。

---

## 2. 系统架构图（文字版）

### 2.1 整体架构（客户端 + 服务端）

```text
[微信小程序客户端]
  ├─ Pages（challenge / checkin / ranking / profile）
  ├─ Components（挑战卡片、倒计时、排名列表等）
  ├─ Engines（Challenge/Sleep/Settlement/Social/Point）
  ├─ Store（用户态、当前挑战态、会话态）
  └─ Services（api、auth、share、telemetry）
            |
            v
[Backend API Layer]
  ├─ Challenge Service
  ├─ Sleep Service
  ├─ Settlement Service
  ├─ Ranking Service
  ├─ Point Service
  └─ Social Service
            |
            v
[Data Layer]
  ├─ MySQL / MongoDB（业务主库）
  ├─ Redis（排行榜、状态缓存、幂等锁）
  └─ Object Storage（分享海报、战报图）
```

### 2.2 五大引擎交互关系

```text
Challenge Engine
  -> 创建挑战、成员管理、状态推进
  -> 触发 Sleep Engine 每日窗口

Sleep Engine
  -> 接收 onShow/onHide + 打卡事件
  -> 产出行为判定结果（达标/违规/待确认）

Settlement Engine
  -> 消费行为结果
  -> 计算日结与终局结果，更新排名
  -> 调用 Point System 完成积分结算

Social Engine
  -> 邀请入局、战报分享、挑战传播
  -> 将新用户回流到 Challenge Engine

Point System
  -> 统一记账（冻结/扣减/奖励/返还）
  -> 向排行榜和成就系统提供经济事件
```

### 2.3 数据流（按日循环）

1. 用户创建挑战（目标时间、周期、押注）→ Challenge 写入 challenge/challenge_member。
2. 人数达到 3 人 → Challenge 状态从 `recruiting` 变 `active`。
3. 每日目标时段：客户端上报“准备睡了” + onShow/onHide 行为事件 → Sleep Engine 判定。
4. Sleep 判定结果写入 sleep_record，并触发 Settlement 日结。
5. Settlement 更新 challenge_member 的分数/连胜/失败状态，写 point_log。
6. Ranking 读取聚合结果实时展示；用户可生成分享卡片由 Social Engine 分发。

---

## 3. 小程序目录结构（详细）

```text
miniprogram/
├─ app.js
├─ app.json
├─ app.wxss
├─ pages/
│  ├─ challenge/
│  │  ├─ create/                 # 创建挑战
│  │  ├─ detail/                 # 挑战详情（状态、成员、规则）
│  │  └─ lobby/                  # 邀请大厅（未开赛）
│  ├─ checkin/
│  │  ├─ daily/                  # 每日打卡
│  │  └─ result/                 # 当日判定结果
│  ├─ ranking/
│  │  ├─ challenge-ranking/      # 挑战内排行榜
│  │  └─ hall/                   # 全局榜（后续扩展）
│  ├─ social/
│  │  ├─ invite/                 # 邀请页
│  │  └─ report/                 # 战报分享页
│  └─ profile/
│     └─ index/                  # 我的主页（基础信息）
│
├─ components/
│  ├─ challenge-card/
│  ├─ countdown-timer/
│  ├─ checkin-button/
│  ├─ ranking-list/
│  └─ status-badge/
│
├─ engines/                      # 业务核心（前端编排层）
│  ├─ challenge-engine/
│  │  ├─ state-machine.js
│  │  └─ challenge-orchestrator.js
│  ├─ sleep-engine/
│  │  ├─ activity-detector.js
│  │  └─ sleep-judge.js
│  ├─ settlement-engine/
│  │  ├─ daily-settlement.js
│  │  └─ final-settlement.js
│  ├─ social-engine/
│  │  ├─ invite-flow.js
│  │  └─ share-flow.js
│  └─ point-system/
│     ├─ point-ledger.js
│     └─ point-rules.js
│
├─ services/
│  ├─ api/
│  │  ├─ challenge.js
│  │  ├─ sleep.js
│  │  ├─ settlement.js
│  │  ├─ ranking.js
│  │  └─ point.js
│  ├─ auth/
│  ├─ share/
│  └─ telemetry/
│
├─ store/
│  ├─ user-store.js
│  ├─ challenge-store.js
│  └─ session-store.js
│
├─ utils/
│  ├─ time.js
│  ├─ idempotency.js
│  └─ constants.js
│
└─ config/
   ├─ env.dev.js
   ├─ env.prod.js
   └─ feature-flags.js
```

> 说明：`engines/` 是核心。页面只负责展示和交互，复杂业务集中在引擎层，降低后期扩展成本。

---

## 4. 核心模块设计（五大引擎）

## 4.1 Challenge Engine（挑战系统）

### 职责
- 创建挑战、校验规则、成员管理、状态推进。
- 管理挑战生命周期和每日执行窗口。

### 挑战状态机

```text
draft -> recruiting -> active -> settled -> archived
```

- `draft`：草稿（仅创建者可见）。
- `recruiting`：招募中（可邀请、可退出，未开赛）。
- `active`：进行中（达到最少 3 人并到达开始日）。
- `settled`：已结算（挑战周期结束，结果锁定）。
- `archived`：归档（历史可查，禁止写操作）。

### 核心转移条件
- `draft -> recruiting`：创建并发布挑战。
- `recruiting -> active`：人数 >=3 且到达 start_date。
- `active -> settled`：end_date 后完成最终结算。
- `settled -> archived`：超过展示期自动归档。

---

## 4.2 Sleep Engine（行为检测）

### 职责
- 采集并校验睡前行为。
- 在严格模式下判定是否违规。

### onShow/onHide 判定策略（严格模式）

1. 用户点击“准备睡了”触发 `checkin_at`。
2. 进入“观察窗口”（如目标时间后至次日 05:00）。
3. 若在窗口内收到任何 `onShow`（App 回到前台）且不在白名单场景，则记为“中途活跃违规”。
4. 若用户未在目标时间前打卡，记为“超时失败”。
5. 结果分级：
   - `PASS`：准时打卡且无中途活跃。
   - `FAIL_TIMEOUT`：超过目标时间未打卡。
   - `FAIL_ACTIVE`：打卡后中途活跃。
   - `PENDING`：窗口未结束，待最终确认。

### 反作弊建议（MVP可先埋点）
- 关键事件加服务端时间戳。
- 事件幂等 key（user_id + challenge_id + biz_date）。
- 记录设备与会话标识，识别异常高频切前后台。

---

## 4.3 Settlement Engine（结算系统）

### 职责
- 日结：更新当日积分、排名、连胜。
- 终局结算：确认赢家与挑战最终状态。

### 日结逻辑（简化）
- 输入：`sleep_record` + 当日挑战成员列表。
- 规则：
  - PASS：`score +1`，`streak +1`
  - FAIL_*：`score +0`，`streak = 0`
- 输出：
  - challenge_member 当日累计分
  - 排名快照（可落 Redis + DB）
  - point_log（若开启押注）

### 终局结算逻辑
- 周期结束后，按 `score DESC, latest_pass_at ASC` 排序。
- 平分处理：并列名次共享奖励（MVP 可仅展示并列，不拆奖金）。
- 挑战状态更新为 `settled`。

---

## 4.4 Social Engine（社交裂变）

### 职责
- 邀请用户参与挑战。
- 生成可传播的战报与排行榜快照。

### 邀请机制
- 创建者生成 `invite_code` / `invite_token`。
- 被邀请人通过小程序卡片或群分享链接进入 `lobby`。
- 服务端校验：挑战状态、人数上限、是否重复加入。

### 分享机制（MVP）
- 支持两类分享卡：
  1. 挑战邀请卡（显示目标时间、已参与人数）
  2. 每日榜单卡（显示我的排名变化）
- 分享落地页一键加入挑战，形成传播闭环。

---

## 4.5 Point System（积分经济）

### 职责
- 积分账户管理与流水记录。
- 为后续对赌、成就、商城扩展提供统一账本。

### 积分流转规则（MVP简化）
- `EARN_DAILY_PASS`：每日达标奖励 +N。
- `PENALTY_FAIL`：失败扣减 0（MVP 可先不扣，避免冷启动流失）。
- `FREEZE_STAKE`：创建押注挑战时冻结（后续版本启用）。
- `SETTLE_REWARD`：挑战结束发放奖励。
- 所有变更必须写 `point_log`，并维护余额快照。

---

## 5. 数据模型设计（结构化）

以下字段为建议最小集合（可按选型映射为 SQL 或云数据库文档结构）。

## 5.1 User
- `id` (PK)
- `openid` (unique)
- `nickname`
- `avatar_url`
- `timezone`
- `point_balance`
- `level`（MVP可固定1）
- `created_at`, `updated_at`

## 5.2 Challenge
- `id` (PK)
- `creator_user_id` (FK user.id)
- `title`
- `target_sleep_time`（如 23:00）
- `duration_days`
- `start_date`, `end_date`
- `min_participants`（默认3）
- `stake_points`（MVP可为0）
- `strict_mode`（bool）
- `status`（draft/recruiting/active/settled/archived）
- `created_at`, `updated_at`

## 5.3 ChallengeMember
- `id` (PK)
- `challenge_id` (FK)
- `user_id` (FK)
- `join_at`
- `member_status`（active/quit/eliminated）
- `score_total`
- `current_streak`
- `last_checkin_at`
- `rank_latest`

> unique key: (`challenge_id`, `user_id`)

## 5.4 SleepRecord
- `id` (PK)
- `challenge_id` (FK)
- `user_id` (FK)
- `biz_date`（挑战业务日）
- `checkin_at`
- `target_time_snapshot`
- `has_foreground_after_checkin`（bool）
- `judge_result`（PASS/FAIL_TIMEOUT/FAIL_ACTIVE/PENDING）
- `judge_at`
- `raw_event_count`

> unique key: (`challenge_id`, `user_id`, `biz_date`)

## 5.5 Battle（对赌，预留）
- `id` (PK)
- `challenge_id` (nullable)
- `left_user_id`, `right_user_id`
- `stake_points_each`
- `battle_date`
- `winner_user_id` (nullable)
- `status`（pending/settled/cancelled）
- `created_at`, `settled_at`

## 5.6 PointLog
- `id` (PK)
- `user_id` (FK)
- `event_type`（EARN_DAILY_PASS / SETTLE_REWARD / ...）
- `delta_points`（正负值）
- `balance_after`
- `ref_type`（challenge/sleep_record/battle/system）
- `ref_id`
- `created_at`

## 5.7 Achievement（预留）
- `id` (PK)
- `user_id` (FK)
- `achievement_code`
- `progress`
- `unlocked_at` (nullable)
- `created_at`, `updated_at`

---

## 6. 核心流程（端到端）

## 6.1 创建挑战流程

```text
用户填写参数 -> 前端基础校验 -> Challenge API 创建 draft
-> 发布挑战(recruiting) -> Social Engine 生成邀请卡
-> 被邀请用户加入 -> 人数>=3 且到开始日 -> 自动转 active
```

## 6.2 每日打卡流程

```text
用户进入打卡页 -> 点击“准备睡了” -> 记录 checkin_at
-> Sleep Engine 开启观察窗口 -> 期间监听 onShow/onHide
-> 窗口结束写 sleep_record 最终判定 -> 返回结果页
```

## 6.3 睡眠判定流程（严格模式）

```text
是否在目标时间前打卡?
  ├─ 否 -> FAIL_TIMEOUT
  └─ 是 -> 打卡后是否出现 onShow?
           ├─ 是 -> FAIL_ACTIVE
           └─ 否 -> PASS
```

## 6.4 挑战结算流程

```text
定时任务扫描 active 挑战
-> 聚合当日 sleep_record
-> Settlement Engine 日结更新 score/streak/rank
-> 若到 end_date 则终局结算
-> 更新 challenge.status=settled
```

## 6.5 分享裂变流程（MVP简化）

```text
用户在结果页点击分享
-> Social Engine 生成挑战卡/榜单卡
-> 分享到群
-> 新用户点击进入小程序落地页
-> 注册/授权后加入挑战
-> 回流挑战大厅
```

---

## 7. 后端方案对比（Node.js vs 微信云开发）

## 7.1 方案A：Node.js（Express/NestJS）

**优点**
- 架构自由度高，易做复杂规则与服务拆分。
- 可标准化工程能力（CI/CD、测试、分层、监控）。
- 未来接入 App/H5/开放平台更平滑。

**缺点**
- 初期运维成本更高（部署、监控、数据库维护）。
- 个人开发冷启动速度慢于云开发。

**适用**
- 目标是长期产品化，预期规则复杂、迭代快、要跨端。

## 7.2 方案B：微信云开发（云函数 + 云数据库）

**优点**
- 上手快，免服务器运维，开发链路短。
- 与小程序账号体系天然集成。
- 个人开发 MVP 成本最低。

**缺点**
- 复杂业务增长后，函数编排与调试成本上升。
- 可移植性较弱，后期迁移成本较高。

**适用**
- 先验证玩法，快速上线 MVP。

## 7.3 推荐策略（个人开发）

- **阶段1（MVP）**：优先微信云开发，2~4 周快速验证留存。
- **阶段2（增长）**：当 DAU 和规则复杂度上升后，逐步迁移到 NestJS（可先迁移结算与排行榜服务）。

---

## 8. MVP范围（严格限制）

## 8.1 必做
- 创建挑战（含基本参数、至少3人开赛）
- 每日打卡
- 简单判定（准时/超时 + 基础中途活跃检测）
- 基础排行榜（按累计达标天数）

## 8.2 明确不做（V2再上）
- 成就系统
- 1v1 对赌
- 复杂裂变（多级邀请奖励、战队系统）

## 8.3 MVP成功指标（建议）
- 次日留存（D1）
- 挑战开赛率（创建后成功达到3人）
- 日打卡率
- 7日挑战完赛率

---

## 9. 可扩展性预留建议

- **规则配置化**：目标时间容错、观察窗口、奖励参数放入 `feature-flags` / 配置表。
- **结算解耦**：Settlement 走异步任务，避免高峰时阻塞打卡接口。
- **排行榜分层**：挑战内榜（实时）+ 全局榜（离线聚合）。
- **统一事件总线**：将 checkin/judge/settle/share 作为事件，便于后续接入成就系统。

