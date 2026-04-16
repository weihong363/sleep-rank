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

function getSleepSessionHistory(userId = userEngine.getCurrentUserId()) {
  return storage.get(`${keys.SLEEP_SESSION_HISTORY}_${userId}`, []);
}

function saveSleepSessionHistory(history, userId = userEngine.getCurrentUserId()) {
  storage.set(`${keys.SLEEP_SESSION_HISTORY}_${userId}`, history);
  return history;
}

function appendSleepSession(record) {
  if (!record || !record.sleepStartTime) {
    return getSleepSessionHistory();
  }
  const userId = record.userId || userEngine.getCurrentUserId();
  const history = getSleepSessionHistory(userId);
  if (history.some((item) => item.sleepStartTime === record.sleepStartTime)) {
    return history;
  }
  const next = [record, ...history].slice(0, 50);
  return saveSleepSessionHistory(next, userId);
}

function startSleep() {
  const now = Date.now();
  const userId = userEngine.getCurrentUserId();
  const session = {
    userId,
    sleepStartTime: now,
    wakeCount: 0,
    lastHideTime: null,
    currentWakeStartTime: null,
    wakeEvents: [],
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
  const now = Date.now();
  if (session.currentWakeStartTime) {
    const durationMinutes = Math.max(
      1,
      Math.round((now - session.currentWakeStartTime) / 60000)
    );
    const currentWake = session.wakeEvents.find(
      (item) => item.wakeStartTime === session.currentWakeStartTime && !item.wakeEndTime
    );
    if (currentWake) {
      currentWake.wakeEndTime = now;
      currentWake.durationMinutes = durationMinutes;
    }
    session.currentWakeStartTime = null;
  }

  session.lastHideTime = now;
  session.updatedAt = now;
  storage.set(`${keys.ACTIVE_SLEEP_SESSION}_${session.userId}`, session);
}

function onAppShow() {
  const session = getActiveSession();
  if (!session || !session.isSleeping) {
    return;
  }
  // 只有从后台回来才计一次 wake_count，避免首次启动误计数
  if (session.lastHideTime) {
    const now = Date.now();
    session.wakeCount += 1;
    session.currentWakeStartTime = now;
    session.wakeEvents.push({
      wakeStartTime: now,
      wakeEndTime: null,
      durationMinutes: null
    });
    session.lastHideTime = null;
    session.updatedAt = now;
    storage.set(`${keys.ACTIVE_SLEEP_SESSION}_${session.userId}`, session);
  }
}

function endSleep() {
  const session = getActiveSession();
  if (!session || !session.isSleeping) {
    return null;
  }

  const sleepEndTime = Date.now();
  if (session.currentWakeStartTime) {
    const durationMinutes = Math.max(
      1,
      Math.round((sleepEndTime - session.currentWakeStartTime) / 60000)
    );
    const currentWake = session.wakeEvents.find(
      (item) => item.wakeStartTime === session.currentWakeStartTime && !item.wakeEndTime
    );
    if (currentWake) {
      currentWake.wakeEndTime = sleepEndTime;
      currentWake.durationMinutes = durationMinutes;
    }
    session.currentWakeStartTime = null;
  }
  const durationMinutes = Math.max(
    1,
    Math.round((sleepEndTime - session.sleepStartTime) / 60000)
  );
  const sleepScore = scoreEngine.calculateSleepScore(
    durationMinutes,
    session.wakeCount
  );

  const record = {
    userId: session.userId,
    sleepStartTime: session.sleepStartTime,
    sleepEndTime,
    durationMinutes,
    wakeCount: session.wakeCount,
    wakeEvents: session.wakeEvents,
    sleepScore,
    createdAt: sleepEndTime
  };

  storage.set(`${keys.LATEST_SLEEP_RECORD}_${session.userId}`, record);
  appendSleepSession(record, session.userId);
  storage.remove(`${keys.ACTIVE_SLEEP_SESSION}_${session.userId}`);
  return record;
}

module.exports = {
  getActiveSession,
  getLatestSleepRecord,
  getSleepSessionHistory,
  startSleep,
  endSleep,
  onAppShow,
  onAppHide,
  formatDateTime
};
