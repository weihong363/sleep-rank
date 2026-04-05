---
name: P0 - 严格模式判定
about: 实现睡眠挑战核心裁决逻辑
title: "[P0] 严格模式判定引擎"
labels: ["P0", "core", "engine"]
assignees: ""
---

## 🎯 目标
将当前“行为记录”升级为“胜负裁决系统”

---

## 📦 任务拆解

- [ ] 定义 DailyResult 状态
  - [ ] PENDING
  - [ ] PASS
  - [ ] FAIL_TIMEOUT
  - [ ] FAIL_ACTIVE
  - [ ] FAIL_MISS

- [ ] 实现目标时间校验（targetSleepTime）
- [ ] 实现超时未打卡判负
- [ ] 实现 onShow 唤醒检测
- [ ] 实现 wakeCount 判定规则
- [ ] 实现观察窗口（30分钟内唤醒判负）

---

## 🧠 技术点
- sleep-engine 与 challenge-engine 解耦
- 判定逻辑幂等

---

## ✅ 验收标准
- [ ] 每天有明确 PASS/FAIL 状态
- [ ] 能复盘失败原因
- [ ] 不依赖手动触发结算