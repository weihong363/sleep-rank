const storage = require('../store/storage');
const keys = require('../store/keys');
const scoreEngine = require('./score-engine');
const userEngine = require('./user-engine');
const { formatDateKey, formatDateTime } = require('../utils/date');

/**
 * Challenge Engine
 * - 管理挑战生命周期：创建 -> 待接受 -> 进行中 -> 完成/取消
 * - 管理参与人接受状态、发起人取消规则、自动开始时机
 * - 管理每日打卡写入
 */
const CHALLENGE_STATUS = {
  PENDING: 'PENDING',
  ONGOING: 'ONGOING',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED'
};

function getStartOfDay(timestamp) {
  const d = new Date(timestamp);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function getChallengePeriodEndAt(challenge) {
  if (!challenge || !challenge.startDate || !challenge.targetDays) {
    return null;
  }
  // 以“开始当天”为第 1 天，挑战周期结束于第 N 天 23:59:59.999
  const startDay = getStartOfDay(challenge.startDate);
  const endExclusive = startDay + challenge.targetDays * 24 * 60 * 60 * 1000;
  return endExclusive - 1;
}

function isChallengePeriodEnded(challenge, now = Date.now()) {
  const endAt = getChallengePeriodEndAt(challenge);
  if (!endAt) {
    return false;
  }
  return now > endAt;
}

function getActiveChallenge() {
  const challenge = storage.get(keys.ACTIVE_CHALLENGE, null);
  if (!challenge) {
    return null;
  }
  if (challenge.status !== CHALLENGE_STATUS.ONGOING) {
    if (challenge.status === CHALLENGE_STATUS.COMPLETED) {
      settleCompletedChallengeStats(challenge);
      saveChallenge(challenge);
    }
    return challenge;
  }

  if (hasAllParticipantsCompleted(challenge) || isChallengePeriodEnded(challenge)) {
    challenge.status = CHALLENGE_STATUS.COMPLETED;
    challenge.completedAt = Date.now();
    challenge.updatedAt = Date.now();
    challenge.completedReason = hasAllParticipantsCompleted(challenge)
      ? 'ALL_PARTICIPANTS_DONE'
      : 'PERIOD_ENDED';
    settleCompletedChallengeStats(challenge);
    saveChallenge(challenge);
  }

  return challenge;
}

function saveChallenge(challenge) {
  storage.set(keys.ACTIVE_CHALLENGE, challenge);
  return challenge;
}

function getCurrentParticipant(challenge = getActiveChallenge()) {
  if (!challenge) {
    return null;
  }
  const currentUserId = userEngine.getCurrentUserId();
  return challenge.participants.find((p) => p.userId === currentUserId) || null;
}

function isCurrentUserInAnyLiveChallenge() {
  const challenge = getActiveChallenge();
  if (!challenge) {
    return false;
  }
  if (challenge.status === CHALLENGE_STATUS.CANCELED || challenge.status === CHALLENGE_STATUS.COMPLETED) {
    return false;
  }
  return Boolean(getCurrentParticipant(challenge));
}

function normalizeParticipants(rawParticipants, creatorId) {
  const map = {};
  rawParticipants.forEach((item) => {
    if (!item || !item.userId) {
      return;
    }
    map[item.userId] = item;
  });
  map[creatorId] = { userId: creatorId };

  return Object.keys(map).map((userId) => {
    const user = userEngine.getUserById(userId);
    const isCreator = userId === creatorId;
    return {
      userId,
      name: user ? user.name : userId,
      accepted: isCreator,
      acceptedAt: isCreator ? Date.now() : null,
      role: isCreator ? 'CREATOR' : 'MEMBER'
    };
  });
}

function createChallenge(params) {
  if (isCurrentUserInAnyLiveChallenge()) {
    return { ok: false, reason: 'ALREADY_IN_CHALLENGE' };
  }

  const now = Date.now();
  const creator = userEngine.getCurrentUser();
  const participants = normalizeParticipants(params.participants || [], creator.id);
  const allAccepted = participants.every((p) => p.accepted);

  const challenge = {
    id: `challenge_${now}`,
    name: params.name || '我的睡眠挑战',
    targetDays: Number(params.targetDays) || 7,
    sleepWindow: {
      start: params.sleepWindowStart || '23:00',
      end: params.sleepWindowEnd || '07:00'
    },
    creatorUserId: creator.id,
    creatorName: creator.name,
    participants,
    status: allAccepted ? CHALLENGE_STATUS.ONGOING : CHALLENGE_STATUS.PENDING,
    startDate: allAccepted ? now : null,
    checkIns: [],
    totalScore: 0,
    createdAt: now,
    updatedAt: now
  };

  return { ok: true, challenge: saveChallenge(challenge) };
}

function acceptChallenge() {
  const challenge = getActiveChallenge();
  if (!challenge || challenge.status !== CHALLENGE_STATUS.PENDING) {
    return { ok: false, reason: 'NO_PENDING_CHALLENGE' };
  }

  const currentUserId = userEngine.getCurrentUserId();
  const participant = challenge.participants.find((p) => p.userId === currentUserId);
  if (!participant) {
    return { ok: false, reason: 'NOT_INVITED' };
  }
  if (participant.accepted) {
    return { ok: true, challenge };
  }

  participant.accepted = true;
  participant.acceptedAt = Date.now();
  challenge.updatedAt = Date.now();

  const allAccepted = challenge.participants.every((p) => p.accepted);
  if (allAccepted) {
    challenge.status = CHALLENGE_STATUS.ONGOING;
    challenge.startDate = Date.now();
  }

  return { ok: true, challenge: saveChallenge(challenge) };
}

function cancelChallenge() {
  const challenge = getActiveChallenge();
  if (!challenge) {
    return { ok: false, reason: 'NO_CHALLENGE' };
  }
  if (challenge.status !== CHALLENGE_STATUS.PENDING) {
    return { ok: false, reason: 'ALREADY_STARTED' };
  }
  if (challenge.creatorUserId !== userEngine.getCurrentUserId()) {
    return { ok: false, reason: 'ONLY_CREATOR_CAN_CANCEL' };
  }

  challenge.status = CHALLENGE_STATUS.CANCELED;
  challenge.canceledAt = Date.now();
  challenge.updatedAt = Date.now();
  saveChallenge(challenge);
  return { ok: true };
}

function getPendingInvitationForCurrentUser() {
  const challenge = getActiveChallenge();
  if (!challenge || challenge.status !== CHALLENGE_STATUS.PENDING) {
    return null;
  }
  const participant = getCurrentParticipant(challenge);
  if (!participant || participant.accepted) {
    return null;
  }
  return challenge;
}

function canCurrentUserSleep(challenge = getActiveChallenge()) {
  if (!challenge || challenge.status !== CHALLENGE_STATUS.ONGOING) {
    return false;
  }
  const participant = getCurrentParticipant(challenge);
  return Boolean(participant && participant.accepted);
}

function getProgress(challenge) {
  if (!challenge || challenge.status === CHALLENGE_STATUS.CANCELED) {
    return {
      checkedDays: 0,
      targetDays: 0,
      progressPercent: 0,
      todayChecked: false
    };
  }

  const checkedDays = challenge.checkIns.length;
  const targetDays = challenge.targetDays;
  const todayKey = formatDateKey();
  const todayChecked = challenge.checkIns.some((item) => item.dateKey === todayKey);
  const progressPercent = targetDays > 0
    ? Math.min(Math.round((checkedDays / targetDays) * 100), 100)
    : 0;

  return {
    checkedDays,
    targetDays,
    progressPercent,
    todayChecked
  };
}

function getUserCompletedDays(challenge, userId) {
  if (!challenge) {
    return 0;
  }
  const dateSet = new Set(
    challenge.checkIns
      .filter((item) => item.userId === userId)
      .map((item) => item.dateKey)
  );
  return dateSet.size;
}

function getUserChallengeScore(challenge, userId) {
  if (!challenge) {
    return 0;
  }
  return challenge.checkIns
    .filter((item) => item.userId === userId)
    .reduce((sum, item) => sum + item.dailyScore, 0);
}

function getUserStatsMap() {
  return storage.get(keys.USER_STATS_MAP, {});
}

function saveUserStatsMap(map) {
  storage.set(keys.USER_STATS_MAP, map);
}

function getUserStats(userId = userEngine.getCurrentUserId()) {
  const map = getUserStatsMap();
  return map[userId] || {
    userId,
    totalScore: 0,
    completedChallenges: 0,
    missedChallenges: 0,
    lastUpdatedAt: null
  };
}

function settleCompletedChallengeStats(challenge) {
  if (!challenge || challenge.status !== CHALLENGE_STATUS.COMPLETED) {
    return;
  }
  const settledUserIds = new Set(challenge.settledUserIds || []);
  const statsMap = getUserStatsMap();

  challenge.participants
    .filter((p) => p.accepted)
    .forEach((participant) => {
      if (settledUserIds.has(participant.userId)) {
        return;
      }

      const userId = participant.userId;
      const completedDays = getUserCompletedDays(challenge, userId);
      const challengeScore = getUserChallengeScore(challenge, userId);
      const completed = completedDays >= challenge.targetDays;
      const prev = statsMap[userId] || getUserStats(userId);

      statsMap[userId] = {
        ...prev,
        userId,
        totalScore: prev.totalScore + challengeScore,
        completedChallenges: prev.completedChallenges + (completed ? 1 : 0),
        missedChallenges: prev.missedChallenges + (completed ? 0 : 1),
        lastUpdatedAt: Date.now()
      };
      settledUserIds.add(userId);
    });

  challenge.settledUserIds = Array.from(settledUserIds);
  saveUserStatsMap(statsMap);
}

function hasAllParticipantsCompleted(challenge) {
  if (!challenge) {
    return false;
  }
  const acceptedParticipants = challenge.participants.filter((p) => p.accepted);
  if (acceptedParticipants.length === 0) {
    return false;
  }
  return acceptedParticipants.every(
    (p) => getUserCompletedDays(challenge, p.userId) >= challenge.targetDays
  );
}

function addTodayCheckIn(sleepRecord) {
  const challenge = getActiveChallenge();
  if (!challenge || challenge.status !== CHALLENGE_STATUS.ONGOING) {
    return { ok: false, reason: 'NO_ACTIVE_CHALLENGE' };
  }
  if (!sleepRecord) {
    return { ok: false, reason: 'NO_SLEEP_RECORD' };
  }
  if (!canCurrentUserSleep(challenge)) {
    return { ok: false, reason: 'NOT_ACCEPTED' };
  }

  const now = Date.now();
  const currentUserId = userEngine.getCurrentUserId();
  const dateKey = formatDateKey(now);
  const currentUserCheckInCount = challenge.checkIns.filter(
    (item) => item.userId === currentUserId
  ).length;
  const existingIndex = challenge.checkIns.findIndex(
    (item) => item.dateKey === dateKey && item.userId === currentUserId
  );
  const checkInIndex = existingIndex >= 0 ? currentUserCheckInCount : currentUserCheckInCount + 1;
  const dailyScore = scoreEngine.calculateDailyChallengeScore(
    sleepRecord.sleepScore,
    checkInIndex
  );

  const checkIn = {
    id: `checkin_${now}`,
    userId: currentUserId,
    dateKey,
    sleepRecord,
    dailyScore,
    createdAt: now
  };

  if (existingIndex >= 0) {
    challenge.checkIns[existingIndex] = checkIn;
  } else {
    challenge.checkIns.push(checkIn);
  }

  challenge.totalScore = challenge.checkIns.reduce((sum, item) => sum + item.dailyScore, 0);
  challenge.updatedAt = now;

  if (hasAllParticipantsCompleted(challenge)) {
    challenge.status = CHALLENGE_STATUS.COMPLETED;
    challenge.completedAt = now;
    challenge.completedReason = 'ALL_PARTICIPANTS_DONE';
    settleCompletedChallengeStats(challenge);
  }

  saveChallenge(challenge);
  return { ok: true, challenge, checkIn };
}

function getTodayCheckIn(challenge = getActiveChallenge()) {
  if (!challenge) {
    return null;
  }
  const currentUserId = userEngine.getCurrentUserId();
  const todayKey = formatDateKey();
  return challenge.checkIns.find(
    (item) => item.dateKey === todayKey && item.userId === currentUserId
  ) || null;
}

function getDisplayChallengeSummary(challenge = getActiveChallenge()) {
  if (!challenge) {
    return null;
  }
  return {
    id: challenge.id,
    name: challenge.name,
    targetDays: challenge.targetDays,
    sleepWindowText: `${challenge.sleepWindow.start} - ${challenge.sleepWindow.end}`,
    status: challenge.status,
    statusText: challenge.status === CHALLENGE_STATUS.PENDING
      ? '等待成员接受'
      : challenge.status === CHALLENGE_STATUS.ONGOING
        ? '挑战进行中'
        : challenge.status === CHALLENGE_STATUS.COMPLETED
          ? '挑战已完成'
          : '挑战已取消',
    startDateText: challenge.startDate ? formatDateTime(challenge.startDate) : '--',
    periodEndText: getChallengePeriodEndAt(challenge)
      ? formatDateTime(getChallengePeriodEndAt(challenge))
      : '--',
    participants: challenge.participants.map((p) => ({
      userId: p.userId,
      name: p.name,
      accepted: p.accepted,
      acceptText: p.accepted ? '已接受' : '待接受'
    })),
    isCreator: challenge.creatorUserId === userEngine.getCurrentUserId()
  };
}

module.exports = {
  CHALLENGE_STATUS,
  getActiveChallenge,
  createChallenge,
  acceptChallenge,
  cancelChallenge,
  getPendingInvitationForCurrentUser,
  getCurrentParticipant,
  isCurrentUserInAnyLiveChallenge,
  canCurrentUserSleep,
  getProgress,
  addTodayCheckIn,
  getTodayCheckIn,
  getDisplayChallengeSummary,
  getUserStats
};
