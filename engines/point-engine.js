const storage = require('../store/storage');
const keys = require('../store/keys');
const userEngine = require('./user-engine');
const cloudSyncEngine = require('./cloud-sync-engine');

const POINT_CHANGE_REASON = {
  CHALLENGE_COMPLETED: 'CHALLENGE_COMPLETED',
  CHALLENGE_FAILED: 'CHALLENGE_FAILED',
  PASS_STREAK_BONUS: 'PASS_STREAK_BONUS'
};

function getAccountMap() {
  return storage.get(keys.POINT_ACCOUNT_MAP, {});
}

function saveAccountMap(map) {
  storage.set(keys.POINT_ACCOUNT_MAP, map);
  return map;
}

function getLogMap() {
  return storage.get(keys.POINT_LOG_MAP, {});
}

function saveLogMap(map) {
  storage.set(keys.POINT_LOG_MAP, map);
  return map;
}

function getPointAccount(userId = userEngine.getCurrentUserId()) {
  const map = getAccountMap();
  return map[userId] || {
    userId,
    balance: 0,
    earned: 0,
    spent: 0,
    updatedAt: null
  };
}

function getPointLogs(userId = userEngine.getCurrentUserId()) {
  const map = getLogMap();
  return map[userId] || [];
}

function upsertPointAccount(userId, account) {
  if (!userId || !account) {
    return null;
  }
  const map = getAccountMap();
  map[userId] = {
    ...account,
    userId
  };
  saveAccountMap(map);
  return map[userId];
}

function upsertPointLogs(userId, logs) {
  if (!userId || !Array.isArray(logs)) {
    return [];
  }
  const map = getLogMap();
  map[userId] = logs;
  saveLogMap(map);
  return logs;
}

function appendPointLog(userId, log) {
  const map = getLogMap();
  const logs = map[userId] || [];
  map[userId] = [log, ...logs].slice(0, 200);
  saveLogMap(map);
  cloudSyncEngine.appendPointLog(log);
}

function changePoints({ userId, delta, reason, challengeId, meta }) {
  if (!userId || !Number.isFinite(delta) || !reason) {
    return { ok: false, reason: 'INVALID_INPUT' };
  }
  const now = Date.now();
  const map = getAccountMap();
  const prev = map[userId] || getPointAccount(userId);
  const nextBalance = prev.balance + delta;
  map[userId] = {
    ...prev,
    userId,
    balance: nextBalance,
    earned: prev.earned + (delta > 0 ? delta : 0),
    spent: prev.spent + (delta < 0 ? Math.abs(delta) : 0),
    updatedAt: now
  };
  saveAccountMap(map);
  cloudSyncEngine.syncPointAccount(userId, map[userId]);
  appendPointLog(userId, {
    id: `point_${now}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    delta,
    reason,
    challengeId: challengeId || null,
    meta: meta || null,
    createdAt: now
  });
  return { ok: true, account: map[userId] };
}

function refreshFromCloudForCurrentUser() {
  const userId = userEngine.getCurrentUserId();
  return Promise.all([
    cloudSyncEngine.pullPointAccount(userId),
    cloudSyncEngine.pullPointLogs(userId)
  ]).then(([account, logs]) => {
    if (account) {
      upsertPointAccount(userId, account);
    }
    if (logs && logs.length > 0) {
      upsertPointLogs(userId, logs);
    }
    return {
      account: getPointAccount(userId),
      logs: getPointLogs(userId)
    };
  }).catch(() => ({
    account: getPointAccount(userId),
    logs: getPointLogs(userId)
  }));
}

module.exports = {
  POINT_CHANGE_REASON,
  getPointAccount,
  getPointLogs,
  upsertPointAccount,
  upsertPointLogs,
  changePoints,
  refreshFromCloudForCurrentUser
};
