const storage = require('../store/storage');
const keys = require('../store/keys');
const scoreEngine = require('./score-engine');
const userEngine = require('./user-engine');
const { formatDateTime } = require('../utils/date');

/**
 * Sleep Engine
 * - 负责睡眠会话生命周期（开始/结束）
 * - 监听前后台切换并统计 wake_count
 * - 输出标准化睡眠记录供 Challenge Engine 使用
 */
function getActiveSession() {
  const userId = userEngine.getCurrentUserId();
  return storage.get(`${keys.ACTIVE_SLEEP_SESSION}_${userId}`, null);
}

function getLatestSleepRecord() {
  const userId = userEngine.getCurrentUserId();
  return storage.get(`${keys.LATEST_SLEEP_RECORD}_${userId}`, null);
}

function startSleep() {
  const now = Date.now();
  const userId = userEngine.getCurrentUserId();
  const session = {
    userId,
    sleepStartTime: now,
    wakeCount: 0,
    lastHideTime: null,
    isSleeping: true,
    updatedAt: now
  };
  storage.set(`${keys.ACTIVE_SLEEP_SESSION}_${userId}`, session);
  return session;
}

function onAppHide() {
  const session = getActiveSession();
  if (!session || !session.isSleeping) {
    return;
  }
  session.lastHideTime = Date.now();
  session.updatedAt = Date.now();
  storage.set(`${keys.ACTIVE_SLEEP_SESSION}_${session.userId}`, session);
}

function onAppShow() {
  const session = getActiveSession();
  if (!session || !session.isSleeping) {
    return;
  }
  // 只有从后台回来才计一次 wake_count，避免首次启动误计数
  if (session.lastHideTime) {
    session.wakeCount += 1;
    session.lastHideTime = null;
    session.updatedAt = Date.now();
    storage.set(`${keys.ACTIVE_SLEEP_SESSION}_${session.userId}`, session);
  }
}

function endSleep() {
  const session = getActiveSession();
  if (!session || !session.isSleeping) {
    return null;
  }

  const sleepEndTime = Date.now();
  const durationMinutes = Math.max(
    1,
    Math.round((sleepEndTime - session.sleepStartTime) / 60000)
  );
  const sleepScore = scoreEngine.calculateSleepScore(
    durationMinutes,
    session.wakeCount
  );

  const record = {
    sleepStartTime: session.sleepStartTime,
    sleepEndTime,
    durationMinutes,
    wakeCount: session.wakeCount,
    sleepScore,
    createdAt: sleepEndTime
  };

  storage.set(`${keys.LATEST_SLEEP_RECORD}_${session.userId}`, record);
  storage.remove(`${keys.ACTIVE_SLEEP_SESSION}_${session.userId}`);
  return record;
}

module.exports = {
  getActiveSession,
  getLatestSleepRecord,
  startSleep,
  endSleep,
  onAppShow,
  onAppHide,
  formatDateTime
};
