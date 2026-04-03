# SleepRank 挑战判定规则（MVP）

## 1. 规则设计目标

SleepRank 的挑战判定目标是：  
对“用户是否遵守挑战约定”做可解释、可复现、可配置的判断，而不是做医学上的睡眠真实性检测。

本规则在现有 MVP 中聚焦以下能力：
- 对某个用户、某个挑战日输出唯一判定结果
- 能明确给出失败原因代码（便于页面展示与统计）
- 判定参数可配置，默认值对小团队可直接使用

---

## 2. 挑战成功条件

某用户某天判定为 `PASS` 的条件是：  
不触发任何失败规则（超时、未打卡、早期活跃、中断过多、时长不足、单次清醒过长）。

---

## 3. 挑战失败条件

系统按固定顺序判定，命中即返回，不继续往后判定：

1. `FAIL_MISS`：当天没有打卡记录  
2. `FAIL_TIMEOUT`：打卡时间晚于目标时间 + 宽限分钟  
3. `FAIL_EARLY_ACTIVE`：打卡后早期观察窗口内再次活跃  
4. `FAIL_INTERRUPT`：挑战睡眠窗口内醒来次数过多  
5. `FAIL_EARLY_WAKE`：总睡眠时长不足  
6. `FAIL_LONG_WAKE`：存在任意一次过长清醒片段

---

## 4. 状态枚举说明

### 4.1 日判定结果状态

- `PASS`：当日遵守挑战规则  
- `FAIL`：当日未遵守挑战规则

### 4.2 失败类型枚举

- `FAIL_TIMEOUT`
- `FAIL_MISS`
- `FAIL_EARLY_ACTIVE`
- `FAIL_INTERRUPT`
- `FAIL_EARLY_WAKE`
- `FAIL_LONG_WAKE`

### 4.3 挑战主状态（已有）

- `PENDING`：等待成员接受  
- `ONGOING`：进行中  
- `COMPLETED`：已完成  
- `CANCELED`：已取消

---

## 5. 默认参数说明

默认参数定义在 `engines/judge-engine.js`：

- `graceMinutes = 10`  
  目标入睡时间的宽限分钟
- `earlyActiveWindowMinutes = 30`  
  打卡后早期观察窗口，窗口内再次活跃会失败
- `maxWakeCount = 1`  
  挑战睡眠窗口允许的最大醒来次数
- `longWakeMinutes = 10`  
  单次清醒时长阈值，超过即失败
- `minSleepDurationMinutes = 240`  
  最低总睡眠时长（分钟）

---

## 6. 判定流程说明

### 6.1 输入

- 挑战配置：`challenge.sleepWindow.start/end`
- 当日睡眠记录：`sleepRecord`
  - `sleepStartTime`
  - `sleepEndTime`
  - `durationMinutes`
  - `wakeCount`
  - `wakeEvents[]`

### 6.2 流程

1. 无打卡记录 -> `FAIL_MISS`  
2. `sleepStartTime` 晚于 `target + graceMinutes` -> `FAIL_TIMEOUT`  
3. `wakeEvents` 中出现 `wakeStartTime <= sleepStartTime + earlyActiveWindowMinutes` -> `FAIL_EARLY_ACTIVE`  
4. `wakeCount > maxWakeCount` -> `FAIL_INTERRUPT`  
5. `durationMinutes < minSleepDurationMinutes` -> `FAIL_EARLY_WAKE`  
6. 任一 `wakeEvent.durationMinutes > longWakeMinutes` -> `FAIL_LONG_WAKE`  
7. 否则 `PASS`

### 6.3 引擎落点

- 判定引擎：`engines/judge-engine.js`
- 打卡写入与判定接入：`engines/challenge-engine.js` 中 `addTodayCheckIn`
- 睡眠行为采集：`engines/sleep-engine.js`（输出 `wakeEvents`）

---

## 7. 面向用户的解释文案

建议在页面统一使用以下解释语：

> 我们判断的是你是否遵守了本次睡眠挑战规则（例如是否按时打卡、是否在约束窗口内保持稳定），  
> 而不是医学意义上的“是否真正睡着”。

可用于失败提示的简化文案：

- `FAIL_TIMEOUT`：你今天打卡晚于目标时间  
- `FAIL_MISS`：你今天没有完成打卡  
- `FAIL_EARLY_ACTIVE`：打卡后过早再次活跃  
- `FAIL_INTERRUPT`：睡眠过程中醒来次数超出规则  
- `FAIL_EARLY_WAKE`：本次睡眠时长不足  
- `FAIL_LONG_WAKE`：存在一次持续过长的清醒

---

## 8. 当前实现边界（MVP）

- 当前判定基于小程序行为事件与本地记录，不是医学睡眠监测
- 当前 `FAIL_MISS` 在“无当日打卡记录时”直接返回
- 规则参数已集中，后续可通过配置中心/后台管理扩展为可运营化调整
