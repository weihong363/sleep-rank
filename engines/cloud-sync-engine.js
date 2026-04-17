const challengeRepo = require('./challenge-repo');
const { CLOUD_CONFIG } = require('../config/cloud-config');

const COLLECTIONS = {
  USERS: CLOUD_CONFIG.collections.users,
  CHALLENGES: CLOUD_CONFIG.collections.challenges,
  USER_STATS: CLOUD_CONFIG.collections.userStats,
  POINT_ACCOUNTS: CLOUD_CONFIG.collections.pointAccounts,
  POINT_LOGS: CLOUD_CONFIG.collections.pointLogs
};

let inited = false;
const MAX_RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1000;

function retryWithBackoff(fn, retryCount = 0) {
  return fn().catch((err) => {
    if (retryCount < MAX_RETRY_COUNT) {
      console.warn(`[cloud-sync] Retry ${retryCount + 1}/${MAX_RETRY_COUNT}`);
      return new Promise((resolve) => {
        setTimeout(() => {
          retryWithBackoff(fn, retryCount + 1).then(resolve).catch(resolve);
        }, RETRY_DELAY_MS * Math.pow(2, retryCount));
      });
    }
    console.error('[cloud-sync] Max retries reached', err);
    throw err;
  });
}

function canUseCloud() {
  return typeof wx !== 'undefined' && wx && wx.cloud && typeof wx.cloud.database === 'function';
}

function initCloud() {
  if (!canUseCloud() || inited) {
    return;
  }
  wx.cloud.init({
    env: CLOUD_CONFIG.envId,
    traceUser: CLOUD_CONFIG.traceUser
  });
  inited = true;
}

function getDb() {
  if (!canUseCloud()) {
    return null;
  }
  initCloud();
  return wx.cloud.database();
}

function upsertChallenge(challenge) {
  const db = getDb();
  if (!db || !challenge || !challenge.id) {
    return Promise.resolve();
  }
  const participantUserIds = (challenge.participants || []).map((item) => item.userId);
  return retryWithBackoff(() => db.collection(COLLECTIONS.CHALLENGES).doc(challenge.id).set({
    data: {
      ...challenge,
      participantUserIds
    }
  })).catch((err) => {
    console.warn('[cloud-sync][challenge]', err);
    return null;
  });
}

function deleteChallenge(challengeId) {
  const db = getDb();
  if (!db || !challengeId) {
    return Promise.resolve();
  }
  return db.collection(COLLECTIONS.CHALLENGES).doc(challengeId).remove()
    .catch((err) => {
      console.warn('[cloud-sync][challenge-delete]', err);
      return null;
    });
}

function syncUserProfile(user) {
  const db = getDb();
  if (!db || !user || !user.id) {
    return Promise.resolve();
  }
  return retryWithBackoff(() => db.collection(COLLECTIONS.USERS).doc(user.id).set({
    data: {
      id: user.id,
      openid: user.openid || (String(user.id).startsWith('u_') ? null : user.id),
      name: user.name || '',
      nickName: user.nickName || user.name || '',
      avatarUrl: user.avatarUrl || '',
      updatedAt: user.updatedAt || Date.now()
    }
  })).catch((err) => {
    console.warn('[cloud-sync][user-profile]', err);
    return null;
  });
}

function pullUserProfile(userId) {
  const db = getDb();
  if (!db || !userId) {
    return Promise.resolve(null);
  }
  return db.collection(COLLECTIONS.USERS).doc(userId).get()
    .then((res) => res.data || null)
    .catch(() => null);
}

function pullUserProfileByOpenid(openid) {
  const db = getDb();
  if (!db || !openid) {
    return Promise.resolve(null);
  }
  return db.collection(COLLECTIONS.USERS)
    .where({ openid })
    .limit(1)
    .get()
    .then((res) => (res.data && res.data[0]) || null)
    .catch(() => null);
}

function syncUserStats(userId, stats) {
  const db = getDb();
  if (!db || !userId || !stats) {
    return Promise.resolve();
  }
  return db.collection(COLLECTIONS.USER_STATS).doc(userId).set({
    data: {
      ...stats,
      userId
    }
  }).catch((err) => {
    console.warn('[cloud-sync][user-stats]', err);
    return null;
  });
}

function syncPointAccount(userId, account) {
  const db = getDb();
  if (!db || !userId || !account) {
    return Promise.resolve();
  }
  return db.collection(COLLECTIONS.POINT_ACCOUNTS).doc(userId).set({
    data: {
      ...account,
      userId
    }
  }).catch((err) => {
    console.warn('[cloud-sync][point-account]', err);
    return null;
  });
}

function appendPointLog(log) {
  const db = getDb();
  if (!db || !log || !log.id) {
    return Promise.resolve();
  }
  return db.collection(COLLECTIONS.POINT_LOGS).doc(log.id).set({
    data: log
  }).catch((err) => {
    console.warn('[cloud-sync][point-log]', err);
    return null;
  });
}

function pullLiveChallengeForUser(userId) {
  const db = getDb();
  if (!db || !userId) {
    return Promise.resolve(null);
  }
  const _ = db.command;
  return db.collection(COLLECTIONS.CHALLENGES)
    .where({
      participantUserIds: userId,
      status: _.in(['PENDING', 'ONGOING', 'WAITING_FINAL_ACK'])
    })
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get()
    .then((res) => (res.data && res.data[0]) || null)
    .catch(() => null);
}

function pullChallengeById(challengeId) {
  const db = getDb();
  if (!db || !challengeId) {
    return Promise.resolve(null);
  }
  return db.collection(COLLECTIONS.CHALLENGES).doc(challengeId).get()
    .then((res) => res.data || null)
    .catch(() => null);
}

function pullHistoryForUser(userId, limit = 5) {
  const db = getDb();
  if (!db || !userId) {
    return Promise.resolve([]);
  }
  const _ = db.command;
  return db.collection(COLLECTIONS.CHALLENGES)
    .where({
      participantUserIds: userId,
      status: _.in(['COMPLETED'])
    })
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get()
    .then((res) => res.data || [])
    .catch(() => []);
}

function pullUserStats(userId) {
  const db = getDb();
  if (!db || !userId) {
    return Promise.resolve(null);
  }
  return db.collection(COLLECTIONS.USER_STATS).doc(userId).get()
    .then((res) => res.data || null)
    .catch(() => null);
}

function pullPointAccount(userId) {
  const db = getDb();
  if (!db || !userId) {
    return Promise.resolve(null);
  }
  return db.collection(COLLECTIONS.POINT_ACCOUNTS).doc(userId).get()
    .then((res) => res.data || null)
    .catch(() => null);
}

function pullPointLogs(userId, limit = 30) {
  const db = getDb();
  if (!db || !userId) {
    return Promise.resolve([]);
  }
  return db.collection(COLLECTIONS.POINT_LOGS)
    .where({ userId })
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()
    .then((res) => res.data || [])
    .catch(() => []);
}

function refreshChallengeDataForUser(userId) {
  if (!userId) {
    return Promise.resolve();
  }
  return Promise.all([
    pullLiveChallengeForUser(userId),
    pullHistoryForUser(userId)
  ]).then(([activeChallenge, history]) => {
    if (activeChallenge) {
      challengeRepo.saveActiveChallenge(activeChallenge);
    } else {
      challengeRepo.clearActiveChallenge();
    }
    challengeRepo.saveChallengeHistory(history);
  }).catch(() => null);
}

module.exports = {
  canUseCloud,
  initCloud,
  syncUserProfile,
  pullUserProfile,
  pullUserProfileByOpenid,
  deleteChallenge,
  upsertChallenge,
  syncUserStats,
  syncPointAccount,
  appendPointLog,
  pullUserStats,
  pullPointAccount,
  pullPointLogs,
  pullChallengeById,
  refreshChallengeDataForUser
};
