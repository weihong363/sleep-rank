const storage = require('../store/storage');
const keys = require('../store/keys');
const scoreEngine = require('./score-engine');
const userEngine = require('./user-engine');
const judgeEngine = require('./judge-engine');
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
  WAITING_FINAL_ACK: 'WAITING_FINAL_ACK',
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

function getRuleConfig(challenge) {
  return {
    ...judgeEngine.DEFAULT_RULE_CONFIG,
    ...(challenge && challenge.ruleConfig ? challenge.ruleConfig : {})
  };
}

function getDailyMissDeadline(challenge, dateKey) {
  if (!challenge || !challenge.sleepWindow || !challenge.sleepWindow.start) {
    return null;
  }
  const [year, month, day] = dateKey.split('-').map((n) => Number(n));
  const [hours, minutes] = challenge.sleepWindow.start.split(':').map((n) => Number(n));
  const ruleConfig = getRuleConfig(challenge);
  const target = new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
  return target + ruleConfig.graceMinutes * 60000;
}

function getDailyResult(challenge, userId, dateKey) {
  if (!challenge || !challenge.dailyResults) {
    return null;
  }
  return challenge.dailyResults.find(
    (item) => item.userId === userId && item.dateKey === dateKey
  ) || null;
}

function upsertDailyResult(challenge, dailyResult) {
  if (!challenge.dailyResults) {
    challenge.dailyResults = [];
  }
  const index = challenge.dailyResults.findIndex(
    (item) => item.userId === dailyResult.userId && item.dateKey === dailyResult.dateKey
  );
  if (index >= 0) {
    challenge.dailyResults[index] = dailyResult;
  } else {
    challenge.dailyResults.push(dailyResult);
  }
}

function hasAllAcceptedParticipantsAckedEnd(challenge) {
  if (!challenge) {
    return false;
  }
  const acceptedUserIds = challenge.participants
    .filter((p) => p.accepted)
    .map((p) => p.userId);
  if (acceptedUserIds.length === 0) {
    return false;
  }
  const ackSet = new Set(challenge.finalAckUserIds || []);
  return acceptedUserIds.every((userId) => ackSet.has(userId));
}

function getActiveChallenge() {
  const challenge = storage.get(keys.ACTIVE_CHALLENGE, null);
  if (!challenge) {
    return null;
  }
  if (challenge.status === CHALLENGE_STATUS.ONGOING && isChallengePeriodEnded(challenge)) {
    challenge.status = CHALLENGE_STATUS.WAITING_FINAL_ACK;
    challenge.updatedAt = Date.now();
    if (!challenge.finalAckUserIds) {
      challenge.finalAckUserIds = [];
    }
    saveChallenge(challenge);
  }

  if (challenge.status === CHALLENGE_STATUS.WAITING_FINAL_ACK && hasAllAcceptedParticipantsAckedEnd(challenge)) {
    challenge.status = CHALLENGE_STATUS.COMPLETED;
    challenge.completedAt = Date.now();
    challenge.updatedAt = Date.now();
    challenge.completedReason = 'PERIOD_ENDED_ACKED';
    settleCompletedChallengeStats(challenge);
    saveChallenge(challenge);
  }

  if (
    challenge.status !== CHALLENGE_STATUS.ONGOING &&
    challenge.status !== CHALLENGE_STATUS.WAITING_FINAL_ACK
  ) {
    if (challenge.status === CHALLENGE_STATUS.COMPLETED) {
      settleCompletedChallengeStats(challenge);
      saveChallenge(challenge);
    }
    return challenge;
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
  if (isChallengePeriodEnded(challenge)) {
    return false;
  }
  const participant = getCurrentParticipant(challenge);
  return Boolean(participant && participant.accepted);
}

function acknowledgeChallengeEndByCurrentUser() {
  const challenge = getActiveChallenge();
  if (!challenge) {
    return { ok: false, reason: 'NO_CHALLENGE' };
  }
  if (!isChallengePeriodEnded(challenge)) {
    return { ok: false, reason: 'PERIOD_NOT_ENDED' };
  }
  if (
    challenge.status !== CHALLENGE_STATUS.ONGOING &&
    challenge.status !== CHALLENGE_STATUS.WAITING_FINAL_ACK
  ) {
    return {
      ok: true,
      state: challenge.status === CHALLENGE_STATUS.COMPLETED ? 'COMPLETED' : 'NOT_ACTIVE'
    };
  }

  const participant = getCurrentParticipant(challenge);
  if (!participant || !participant.accepted) {
    return { ok: false, reason: 'NOT_PARTICIPANT' };
  }

  if (!challenge.finalAckUserIds) {
    challenge.finalAckUserIds = [];
  }
  if (!challenge.finalAckUserIds.includes(participant.userId)) {
    challenge.finalAckUserIds.push(participant.userId);
  }

  if (hasAllAcceptedParticipantsAckedEnd(challenge)) {
    challenge.status = CHALLENGE_STATUS.COMPLETED;
    challenge.completedAt = Date.now();
    challenge.updatedAt = Date.now();
    challenge.completedReason = 'PERIOD_ENDED_ACKED';
    settleCompletedChallengeStats(challenge);
    saveChallenge(challenge);
    return { ok: true, state: 'COMPLETED' };
  }

  challenge.status = CHALLENGE_STATUS.WAITING_FINAL_ACK;
  challenge.updatedAt = Date.now();
  saveChallenge(challenge);

  const remaining = challenge.participants
    .filter((p) => p.accepted)
    .filter((p) => !(challenge.finalAckUserIds || []).includes(p.userId))
    .length;
  return { ok: true, state: 'WAITING', remaining };
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
  const currentUserId = userEngine.getCurrentUserId();
  const todayKey = formatDateKey();
  const todayChecked = challenge.checkIns.some(
    (item) => item.dateKey === todayKey && item.userId === currentUserId
  );
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
  if (isChallengePeriodEnded(challenge)) {
    return { ok: false, reason: 'PERIOD_ENDED' };
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
  const existingDailyResult = getDailyResult(challenge, currentUserId, dateKey);
  if (existingDailyResult && existingDailyResult.failType === judgeEngine.FAIL_TYPE.FAIL_MISS) {
    return { ok: false, reason: 'FAIL_MISS_LOCKED' };
  }

  const currentUserCheckInCount = challenge.checkIns.filter(
    (item) => item.userId === currentUserId
  ).length;
  const existingIndex = challenge.checkIns.findIndex(
    (item) => item.dateKey === dateKey && item.userId === currentUserId
  );
  const checkInIndex = existingIndex >= 0 ? currentUserCheckInCount : currentUserCheckInCount + 1;
  const dailyJudgeResult = judgeEngine.evaluateSleepChallengeResult({
    challenge,
    sleepRecord,
    dateKey
  });
  const dailyScore = dailyJudgeResult.status === judgeEngine.DAILY_RESULT_STATUS.PASS
    ? scoreEngine.calculateDailyChallengeScore(
      sleepRecord.sleepScore,
      checkInIndex
    )
    : 0;

  const checkIn = {
    id: `checkin_${now}`,
    userId: currentUserId,
    dateKey,
    sleepRecord,
    dailyJudgeResult,
    dailyScore,
    createdAt: now
  };
  upsertDailyResult(challenge, {
    userId: currentUserId,
    dateKey,
    ...dailyJudgeResult,
    createdAt: now
  });

  if (existingIndex >= 0) {
    challenge.checkIns[existingIndex] = checkIn;
  } else {
    challenge.checkIns.push(checkIn);
  }

  challenge.totalScore = challenge.checkIns.reduce((sum, item) => sum + item.dailyScore, 0);
  challenge.updatedAt = now;

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

function getTodayChallengeResult(challenge = getActiveChallenge(), options = {}) {
  if (!challenge) {
    return null;
  }
  const currentUserId = userEngine.getCurrentUserId();
  const todayKey = formatDateKey();
  const existingDailyResult = getDailyResult(challenge, currentUserId, todayKey);
  if (existingDailyResult) {
    return existingDailyResult;
  }

  const todayCheckIn = getTodayCheckIn(challenge);
  if (todayCheckIn) {
    return todayCheckIn.dailyJudgeResult;
  }

  const missDeadline = getDailyMissDeadline(challenge, todayKey);
  if (!options.hasActiveSleepSession && missDeadline && Date.now() > missDeadline) {
    const missResult = judgeEngine.evaluateSleepChallengeResult({
      challenge,
      sleepRecord: null,
      dateKey: todayKey
    });
    const missDailyResult = {
      userId: currentUserId,
      dateKey: todayKey,
      ...missResult,
      createdAt: Date.now()
    };
    upsertDailyResult(challenge, missDailyResult);
    challenge.updatedAt = Date.now();
    saveChallenge(challenge);
    return missDailyResult;
  }
  return null;
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
        : challenge.status === CHALLENGE_STATUS.WAITING_FINAL_ACK
          ? '挑战周期结束，等待成员确认'
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
  acknowledgeChallengeEndByCurrentUser,
  getProgress,
  addTodayCheckIn,
  getTodayCheckIn,
  getTodayChallengeResult,
  getDisplayChallengeSummary,
  getUserStats
};
