const { formatDateKey } = require('../utils/date');

/**
 * Judge Engine
 * - 负责“某用户某天是否遵守挑战规则”的判定
 * - 输出统一的日判定结果，供 Challenge Engine 写入 checkIn
 */
const DAILY_RESULT_STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL'
};

const FAIL_TYPE = {
  FAIL_TIMEOUT: 'FAIL_TIMEOUT',
  FAIL_MISS: 'FAIL_MISS',
  FAIL_EARLY_ACTIVE: 'FAIL_EARLY_ACTIVE',
  FAIL_INTERRUPT: 'FAIL_INTERRUPT',
  FAIL_EARLY_WAKE: 'FAIL_EARLY_WAKE',
  FAIL_LONG_WAKE: 'FAIL_LONG_WAKE'
};

const DEFAULT_RULE_CONFIG = {
  graceMinutes: 10,
  earlyActiveWindowMinutes: 30,
  maxWakeCount: 1,
  longWakeMinutes: 10,
  minSleepDurationMinutes: 240
};

function parseTargetTimestamp(dateKey, hhmm) {
  const [year, month, day] = dateKey.split('-').map((n) => Number(n));
  const [hours, minutes] = hhmm.split(':').map((n) => Number(n));
  return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
}

function failResult(dateKey, failType, message, detail, ruleConfig) {
  return {
    dateKey,
    status: DAILY_RESULT_STATUS.FAIL,
    failType,
    message,
    detail,
    ruleConfig
  };
}

function passResult(dateKey, ruleConfig) {
  return {
    dateKey,
    status: DAILY_RESULT_STATUS.PASS,
    failType: null,
    message: '遵守挑战规则',
    detail: null,
    ruleConfig
  };
}

function evaluateSleepChallengeResult(params) {
  const challenge = params.challenge;
  const sleepRecord = params.sleepRecord || null;
  const dateKey = params.dateKey || formatDateKey(
    sleepRecord ? sleepRecord.sleepStartTime : Date.now()
  );
  const ruleConfig = {
    ...DEFAULT_RULE_CONFIG,
    ...(params.ruleConfig || {})
  };

  // 1. 如果当天没有打卡，返回 FAIL_MISS
  if (!sleepRecord) {
    return failResult(
      dateKey,
      FAIL_TYPE.FAIL_MISS,
      '当天未打卡',
      { checkinMissing: true },
      ruleConfig
    );
  }

  const targetTime = parseTargetTimestamp(dateKey, challenge.sleepWindow.start);
  const timeoutDeadline = targetTime + ruleConfig.graceMinutes * 60000;
  const checkInTime = sleepRecord.sleepStartTime;

  // 2. 如果打卡时间晚于目标时间 + graceMinutes，返回 FAIL_TIMEOUT
  if (checkInTime > timeoutDeadline) {
    return failResult(
      dateKey,
      FAIL_TYPE.FAIL_TIMEOUT,
      '超过目标入睡时间后打卡',
      {
        checkInTime,
        timeoutDeadline
      },
      ruleConfig
    );
  }

  const earlyActiveDeadline = checkInTime + ruleConfig.earlyActiveWindowMinutes * 60000;
  const wakeEvents = sleepRecord.wakeEvents || [];
  const firstEarlyActive = wakeEvents.find(
    (event) => event.wakeStartTime && event.wakeStartTime <= earlyActiveDeadline
  );

  // 3. 如果打卡后 earlyActiveWindowMinutes 内再次进入小程序，返回 FAIL_EARLY_ACTIVE
  if (firstEarlyActive) {
    return failResult(
      dateKey,
      FAIL_TYPE.FAIL_EARLY_ACTIVE,
      '打卡后早期观察窗口内再次活跃',
      {
        wakeStartTime: firstEarlyActive.wakeStartTime,
        earlyActiveDeadline
      },
      ruleConfig
    );
  }

  // 4. 如果挑战时间段内 wakeCount > maxWakeCount，返回 FAIL_INTERRUPT
  if (sleepRecord.wakeCount > ruleConfig.maxWakeCount) {
    return failResult(
      dateKey,
      FAIL_TYPE.FAIL_INTERRUPT,
      '挑战睡眠窗口内醒来次数过多',
      {
        wakeCount: sleepRecord.wakeCount,
        maxWakeCount: ruleConfig.maxWakeCount
      },
      ruleConfig
    );
  }

  // 5. 如果总睡眠时长 < minSleepDurationMinutes，返回 FAIL_EARLY_WAKE
  if (sleepRecord.durationMinutes < ruleConfig.minSleepDurationMinutes) {
    return failResult(
      dateKey,
      FAIL_TYPE.FAIL_EARLY_WAKE,
      '总睡眠时长不足',
      {
        durationMinutes: sleepRecord.durationMinutes,
        minSleepDurationMinutes: ruleConfig.minSleepDurationMinutes
      },
      ruleConfig
    );
  }

  const longWakeEvent = wakeEvents.find(
    (event) => event.durationMinutes && event.durationMinutes > ruleConfig.longWakeMinutes
  );

  // 6. 如果任意一次醒来持续时间 > longWakeMinutes，返回 FAIL_LONG_WAKE
  if (longWakeEvent) {
    return failResult(
      dateKey,
      FAIL_TYPE.FAIL_LONG_WAKE,
      '存在持续时间过长的醒来片段',
      {
        durationMinutes: longWakeEvent.durationMinutes,
        longWakeMinutes: ruleConfig.longWakeMinutes,
        wakeStartTime: longWakeEvent.wakeStartTime
      },
      ruleConfig
    );
  }

  // 7. 如果以上都不满足，则判定 PASS
  return passResult(dateKey, ruleConfig);
}

module.exports = {
  DAILY_RESULT_STATUS,
  FAIL_TYPE,
  DEFAULT_RULE_CONFIG,
  evaluateSleepChallengeResult
};
