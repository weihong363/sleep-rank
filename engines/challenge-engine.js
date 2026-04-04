const scoreEngine = require('./score-engine');
const userEngine = require('./user-engine');
const judgeEngine = require('./judge-engine');
const pointEngine = require('./point-engine');
const challengeRepo = require('./challenge-repo');
const cloudSyncEngine = require('./cloud-sync-engine');
const storage = require('../store/storage');
const keys = require('../store/keys');
const { formatDateKey, formatDateTime } = require('../utils/date');

const CHALLENGE_STATUS = {
  PENDING: 'PENDING',
  ONGOING: 'ONGOING',
  WAITING_FINAL_ACK: 'WAITING_FINAL_ACK',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED'
};

const MEMBER_STATUS = {
  INVITED: 'INVITED',
  JOINED: 'JOINED',
  CONFIRMED: 'CONFIRMED'
};
const MIN_START_MEMBER_COUNT = 3;

function getStartOfDay(timestamp) {
  const d = new Date(timestamp);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function getChallengePeriodEndAt(challenge) {
  if (!challenge || !challenge.startDate || !challenge.targetDays) {
    return null;
  }
  const startDay = getStartOfDay(challenge.startDate);
  const endExclusive = startDay + challenge.targetDays * 24 * 60 * 60 * 1000;
  return endExclusive - 1;
}

function isChallengePeriodEnded(challenge, now = Date.now()) {
  const endAt = getChallengePeriodEndAt(challenge);
  return Boolean(endAt && now > endAt);
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
  const target = new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
  return target + getRuleConfig(challenge).graceMinutes * 60000;
}

function getDailyResult(challenge, userId, dateKey) {
  if (!challenge || !challenge.dailyResults) {
    return null;
  }
  return challenge.dailyResults.find((item) => item.userId === userId && item.dateKey === dateKey) || null;
}

function upsertDailyResult(challenge, dailyResult) {
  if (!challenge.dailyResults) {
    challenge.dailyResults = [];
  }
  const idx = challenge.dailyResults.findIndex(
    (item) => item.userId === dailyResult.userId && item.dateKey === dailyResult.dateKey
  );
  if (idx >= 0) {
    challenge.dailyResults[idx] = dailyResult;
    return;
  }
  challenge.dailyResults.push(dailyResult);
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

function upsertUserStats(userId, stats) {
  if (!userId || !stats) {
    return null;
  }
  const map = getUserStatsMap();
  map[userId] = {
    ...map[userId],
    ...stats,
    userId
  };
  saveUserStatsMap(map);
  return map[userId];
}

function getCurrentParticipant(challenge = getActiveChallenge()) {
  if (!challenge) {
    return null;
  }
  const currentUserId = userEngine.getCurrentUserId();
  return challenge.participants.find((p) => p.userId === currentUserId) || null;
}

function toMemberStatusText(memberStatus) {
  if (memberStatus === MEMBER_STATUS.CONFIRMED) {
    return '已确认';
  }
  if (memberStatus === MEMBER_STATUS.JOINED) {
    return '已加入';
  }
  return '待加入';
}

function getAcceptedUserIds(challenge) {
  if (!challenge) {
    return [];
  }
  return challenge.participants
    .filter((p) => p.memberStatus === MEMBER_STATUS.CONFIRMED || p.accepted)
    .map((p) => p.userId);
}

function getConfirmedCount(challenge) {
  return getAcceptedUserIds(challenge).length;
}

function getRequiredStartConfirmCount(challenge) {
  return MIN_START_MEMBER_COUNT;
}

function shouldStartChallenge(challenge) {
  return getConfirmedCount(challenge) >= getRequiredStartConfirmCount(challenge);
}

function saveChallenge(challenge) {
  challengeRepo.saveActiveChallenge(challenge);
  cloudSyncEngine.upsertChallenge(challenge);
  return challenge;
}

function finalizeChallenge(challenge, status, reason) {
  const now = Date.now();
  const doneChallenge = {
    ...challenge,
    status,
    updatedAt: now,
    completedAt: status === CHALLENGE_STATUS.COMPLETED ? now : challenge.completedAt || null,
    canceledAt: status === CHALLENGE_STATUS.CANCELED ? now : challenge.canceledAt || null,
    completedReason: status === CHALLENGE_STATUS.COMPLETED ? reason || challenge.completedReason || null : null
  };
  if (status === CHALLENGE_STATUS.COMPLETED) {
    settleCompletedChallengeStats(doneChallenge);
  }
  challengeRepo.appendChallengeHistory(doneChallenge);
  cloudSyncEngine.upsertChallenge(doneChallenge);
  challengeRepo.clearActiveChallenge();
  return doneChallenge;
}

function hasAllAcceptedParticipantsAckedEnd(challenge) {
  const acceptedUserIds = getAcceptedUserIds(challenge);
  if (acceptedUserIds.length === 0) {
    return false;
  }
  const ackSet = new Set(challenge.finalAckUserIds || []);
  return acceptedUserIds.every((userId) => ackSet.has(userId));
}

function getActiveChallenge() {
  const challenge = challengeRepo.getActiveChallenge();
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
    finalizeChallenge(challenge, CHALLENGE_STATUS.COMPLETED, 'PERIOD_ENDED_ACKED');
    return null;
  }

  return challenge;
}

function getChallengeHistory() {
  return challengeRepo.getChallengeHistory();
}

function getCurrentUserChallengeHistory() {
  const currentUserId = userEngine.getCurrentUserId();
  return getChallengeHistory().filter((challenge) => challenge.participants.some((p) => p.userId === currentUserId));
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
    const now = Date.now();
    return {
      userId,
      name: user ? user.name : userId,
      openid: user && user.openid ? user.openid : (String(userId).startsWith('u_') ? null : userId),
      avatarUrl: user && user.avatarUrl ? user.avatarUrl : '',
      memberStatus: isCreator ? MEMBER_STATUS.CONFIRMED : MEMBER_STATUS.INVITED,
      invitedAt: now,
      joinedAt: isCreator ? now : null,
      confirmedAt: isCreator ? now : null,
      accepted: isCreator,
      acceptedAt: isCreator ? now : null,
      role: isCreator ? 'CREATOR' : 'MEMBER'
    };
  });
}

function mergeParticipants(challenge, rawParticipants = []) {
  if (!challenge || !Array.isArray(challenge.participants)) {
    return [];
  }
  const existingUserIdSet = new Set(challenge.participants.map((item) => item.userId));
  const nextParticipants = normalizeParticipants(rawParticipants, challenge.creatorUserId)
    .filter((item) => !existingUserIdSet.has(item.userId));
  if (nextParticipants.length === 0) {
    return [];
  }
  challenge.participants = challenge.participants.concat(nextParticipants);
  challenge.updatedAt = Date.now();
  return nextParticipants;
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

function createChallenge(params) {
  if (isCurrentUserInAnyLiveChallenge()) {
    return { ok: false, reason: 'ALREADY_IN_CHALLENGE' };
  }
  const now = Date.now();
  const creator = userEngine.getCurrentUser();
  const participants = normalizeParticipants(params.participants || [], creator.id);
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
    creatorOpenId: creator.openid || (String(creator.id).startsWith('u_') ? null : creator.id),
    creatorAvatarUrl: creator.avatarUrl || '',
    participants,
    status: shouldStartChallenge({ participants }) ? CHALLENGE_STATUS.ONGOING : CHALLENGE_STATUS.PENDING,
    startDate: shouldStartChallenge({ participants }) ? now : null,
    checkIns: [],
    dailyResults: [],
    totalScore: 0,
    createdAt: now,
    updatedAt: now
  };
  return { ok: true, challenge: saveChallenge(challenge) };
}

function getChallengeByIdFromLocal(challengeId) {
  if (!challengeId) {
    return null;
  }
  const active = challengeRepo.getActiveChallenge();
  if (active && active.id === challengeId) {
    return active;
  }
  const historyItem = challengeRepo.getChallengeHistory().find((item) => item.id === challengeId);
  return historyItem || null;
}

function buildInvitedParticipant(userId) {
  const user = userEngine.getUserById(userId) || {};
  const now = Date.now();
  return {
    userId,
    name: user.name || `用户${String(userId).slice(-6)}`,
    openid: user.openid || (String(userId).startsWith('u_') ? null : userId),
    avatarUrl: user.avatarUrl || '',
    memberStatus: MEMBER_STATUS.INVITED,
    invitedAt: now,
    joinedAt: null,
    confirmedAt: null,
    accepted: false,
    acceptedAt: null,
    role: 'MEMBER'
  };
}

function joinChallengeByShareInvite(challengeId) {
  if (!challengeId) {
    return Promise.resolve({ ok: false, reason: 'INVALID_CHALLENGE_ID' });
  }
  const currentUserId = userEngine.getCurrentUserId();
  if (!currentUserId) {
    return Promise.resolve({ ok: false, reason: 'NO_CURRENT_USER' });
  }
  const currentLiveChallenge = getActiveChallenge();
  if (currentLiveChallenge && currentLiveChallenge.id !== challengeId) {
    return Promise.resolve({ ok: false, reason: 'ALREADY_IN_CHALLENGE' });
  }

  const localChallenge = getChallengeByIdFromLocal(challengeId);
  const loadPromise = localChallenge
    ? Promise.resolve(localChallenge)
    : cloudSyncEngine.pullChallengeById(challengeId);

  return loadPromise.then((challenge) => {
    if (!challenge) {
      return { ok: false, reason: 'CHALLENGE_NOT_FOUND' };
    }
    if (challenge.status !== CHALLENGE_STATUS.PENDING) {
      return { ok: false, reason: 'CHALLENGE_NOT_PENDING' };
    }
    if (!Array.isArray(challenge.participants)) {
      challenge.participants = [];
    }
    const hasJoined = challenge.participants.some((item) => item.userId === currentUserId);
    if (!hasJoined) {
      challenge.participants.push(buildInvitedParticipant(currentUserId));
      challenge.updatedAt = Date.now();
      saveChallenge(challenge);
    } else {
      challengeRepo.saveActiveChallenge(challenge);
    }
    return { ok: true, challenge, newlyInvited: !hasJoined };
  }).catch(() => ({ ok: false, reason: 'LOAD_CHALLENGE_FAILED' }));
}

function inviteParticipants(rawParticipants = []) {
  const challenge = getActiveChallenge();
  if (!challenge) {
    return { ok: false, reason: 'NO_CHALLENGE' };
  }
  if (challenge.status !== CHALLENGE_STATUS.PENDING) {
    return { ok: false, reason: 'CHALLENGE_NOT_PENDING' };
  }
  if (challenge.creatorUserId !== userEngine.getCurrentUserId()) {
    return { ok: false, reason: 'ONLY_CREATOR_CAN_INVITE' };
  }
  const addedParticipants = mergeParticipants(challenge, rawParticipants);
  if (addedParticipants.length === 0) {
    return { ok: false, reason: 'NO_NEW_MEMBER' };
  }
  saveChallenge(challenge);
  return {
    ok: true,
    challenge,
    addedCount: addedParticipants.length,
    addedParticipants
  };
}

function markParticipantJoined(participant) {
  if (!participant || participant.memberStatus !== MEMBER_STATUS.INVITED) {
    return;
  }
  participant.memberStatus = MEMBER_STATUS.JOINED;
  participant.joinedAt = Date.now();
}

function confirmParticipant(participant) {
  if (!participant || participant.memberStatus === MEMBER_STATUS.CONFIRMED) {
    return false;
  }
  participant.memberStatus = MEMBER_STATUS.CONFIRMED;
  participant.confirmedAt = Date.now();
  participant.joinedAt = participant.joinedAt || Date.now();
  participant.accepted = true;
  participant.acceptedAt = Date.now();
  return true;
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
  markParticipantJoined(participant);
  confirmParticipant(participant);
  challenge.updatedAt = Date.now();
  if (shouldStartChallenge(challenge)) {
    challenge.status = CHALLENGE_STATUS.ONGOING;
    challenge.startDate = challenge.startDate || Date.now();
  }
  saveChallenge(challenge);
  return { ok: true, challenge };
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
  finalizeChallenge(challenge, CHALLENGE_STATUS.CANCELED, 'CREATOR_CANCELLED');
  return { ok: true };
}

function getPendingInvitationForCurrentUser() {
  const challenge = getActiveChallenge();
  if (!challenge || challenge.status !== CHALLENGE_STATUS.PENDING) {
    return null;
  }
  const participant = getCurrentParticipant(challenge);
  if (!participant || participant.memberStatus === MEMBER_STATUS.CONFIRMED) {
    return null;
  }
  return challenge;
}

function canCurrentUserSleep(challenge = getActiveChallenge()) {
  if (!challenge || challenge.status !== CHALLENGE_STATUS.ONGOING || isChallengePeriodEnded(challenge)) {
    return false;
  }
  const participant = getCurrentParticipant(challenge);
  return Boolean(participant && participant.memberStatus === MEMBER_STATUS.CONFIRMED);
}

function acknowledgeChallengeEndByCurrentUser() {
  const challenge = getActiveChallenge();
  if (!challenge) {
    return { ok: false, reason: 'NO_CHALLENGE' };
  }
  if (!isChallengePeriodEnded(challenge)) {
    return { ok: false, reason: 'PERIOD_NOT_ENDED' };
  }
  if (challenge.status !== CHALLENGE_STATUS.ONGOING && challenge.status !== CHALLENGE_STATUS.WAITING_FINAL_ACK) {
    return { ok: true, state: 'NOT_ACTIVE' };
  }
  const participant = getCurrentParticipant(challenge);
  if (!participant || participant.memberStatus !== MEMBER_STATUS.CONFIRMED) {
    return { ok: false, reason: 'NOT_PARTICIPANT' };
  }
  if (!challenge.finalAckUserIds) {
    challenge.finalAckUserIds = [];
  }
  if (!challenge.finalAckUserIds.includes(participant.userId)) {
    challenge.finalAckUserIds.push(participant.userId);
  }
  if (hasAllAcceptedParticipantsAckedEnd(challenge)) {
    finalizeChallenge(challenge, CHALLENGE_STATUS.COMPLETED, 'PERIOD_ENDED_ACKED');
    return { ok: true, state: 'COMPLETED' };
  }
  challenge.status = CHALLENGE_STATUS.WAITING_FINAL_ACK;
  challenge.updatedAt = Date.now();
  saveChallenge(challenge);
  const remaining = getAcceptedUserIds(challenge)
    .filter((userId) => !(challenge.finalAckUserIds || []).includes(userId))
    .length;
  return { ok: true, state: 'WAITING', remaining };
}

function getProgress(challenge) {
  if (!challenge || challenge.status === CHALLENGE_STATUS.CANCELED) {
    return { checkedDays: 0, targetDays: 0, progressPercent: 0, todayChecked: false };
  }
  const currentUserId = userEngine.getCurrentUserId();
  const todayKey = formatDateKey();
  const userCheckIns = challenge.checkIns.filter((item) => item.userId === currentUserId);
  const checkedDays = userCheckIns.length;
  const targetDays = challenge.targetDays;
  const todayChecked = userCheckIns.some((item) => item.dateKey === todayKey);
  const progressPercent = targetDays > 0 ? Math.min(Math.round((checkedDays / targetDays) * 100), 100) : 0;
  return { checkedDays, targetDays, progressPercent, todayChecked };
}

function getUserCompletedDays(challenge, userId) {
  if (!challenge) {
    return 0;
  }
  const dateSet = new Set(challenge.checkIns.filter((item) => item.userId === userId).map((item) => item.dateKey));
  return dateSet.size;
}

function getUserChallengeScore(challenge, userId) {
  if (!challenge) {
    return 0;
  }
  return challenge.checkIns.filter((item) => item.userId === userId).reduce((sum, item) => sum + item.dailyScore, 0);
}

function getPassStreak(challenge, userId) {
  const dailyResults = (challenge.dailyResults || [])
    .filter((item) => item.userId === userId)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  let max = 0;
  let current = 0;
  dailyResults.forEach((item) => {
    if (item.status === judgeEngine.DAILY_RESULT_STATUS.PASS) {
      current += 1;
      max = Math.max(max, current);
      return;
    }
    current = 0;
  });
  return max;
}

function settleCompletedChallengeStats(challenge) {
  if (!challenge || challenge.status !== CHALLENGE_STATUS.COMPLETED) {
    return;
  }
  const settledUserIds = new Set(challenge.settledUserIds || []);
  const statsMap = getUserStatsMap();
  challenge.participants
    .filter((p) => p.memberStatus === MEMBER_STATUS.CONFIRMED || p.accepted)
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
      cloudSyncEngine.syncUserStats(userId, statsMap[userId]);
      if (completed) {
        pointEngine.changePoints({
          userId,
          delta: 20,
          reason: pointEngine.POINT_CHANGE_REASON.CHALLENGE_COMPLETED,
          challengeId: challenge.id
        });
      } else {
        pointEngine.changePoints({
          userId,
          delta: -10,
          reason: pointEngine.POINT_CHANGE_REASON.CHALLENGE_FAILED,
          challengeId: challenge.id
        });
      }
      const streak = getPassStreak(challenge, userId);
      if (streak >= 3) {
        pointEngine.changePoints({
          userId,
          delta: 5,
          reason: pointEngine.POINT_CHANGE_REASON.PASS_STREAK_BONUS,
          challengeId: challenge.id,
          meta: { streak }
        });
      }
      settledUserIds.add(userId);
    });
  challenge.settledUserIds = Array.from(settledUserIds);
  saveUserStatsMap(statsMap);
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
  const userCheckIns = challenge.checkIns.filter((item) => item.userId === currentUserId);
  const existingIndex = challenge.checkIns.findIndex(
    (item) => item.dateKey === dateKey && item.userId === currentUserId
  );
  const checkInIndex = existingIndex >= 0 ? userCheckIns.length : userCheckIns.length + 1;
  const dailyJudgeResult = judgeEngine.evaluateSleepChallengeResult({ challenge, sleepRecord, dateKey });
  const dailyScore = dailyJudgeResult.status === judgeEngine.DAILY_RESULT_STATUS.PASS
    ? scoreEngine.calculateDailyChallengeScore(sleepRecord.sleepScore, checkInIndex)
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
  upsertDailyResult(challenge, { userId: currentUserId, dateKey, ...dailyJudgeResult, createdAt: now });
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
  return challenge.checkIns.find((item) => item.dateKey === todayKey && item.userId === currentUserId) || null;
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
    const missResult = judgeEngine.evaluateSleepChallengeResult({ challenge, sleepRecord: null, dateKey: todayKey });
    const missDailyResult = { userId: currentUserId, dateKey: todayKey, ...missResult, createdAt: Date.now() };
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
  const currentUserId = userEngine.getCurrentUserId();
  const me = challenge.participants.find((p) => p.userId === currentUserId) || null;
  const meMemberStatus = me
    ? (me.memberStatus || (me.accepted ? MEMBER_STATUS.CONFIRMED : MEMBER_STATUS.INVITED))
    : null;
  return {
    id: challenge.id,
    name: challenge.name,
    targetDays: challenge.targetDays,
    creatorName: challenge.creatorName || '挑战发起人',
    creatorUserId: challenge.creatorUserId || '',
    creatorAvatarUrl: challenge.creatorAvatarUrl || '',
    sleepWindowText: `${challenge.sleepWindow.start} - ${challenge.sleepWindow.end}`,
    status: challenge.status,
    statusText: challenge.status === CHALLENGE_STATUS.PENDING
      ? `组队中（已确认 ${getConfirmedCount(challenge)} / ${getRequiredStartConfirmCount(challenge)}）`
      : challenge.status === CHALLENGE_STATUS.ONGOING
        ? '挑战进行中'
        : challenge.status === CHALLENGE_STATUS.WAITING_FINAL_ACK
          ? '挑战周期结束，等待成员确认'
          : challenge.status === CHALLENGE_STATUS.COMPLETED
            ? '挑战已完成'
            : '挑战已取消',
    startDateText: challenge.startDate ? formatDateTime(challenge.startDate) : '--',
    periodEndText: getChallengePeriodEndAt(challenge) ? formatDateTime(getChallengePeriodEndAt(challenge)) : '--',
    requiredCount: getRequiredStartConfirmCount(challenge),
    confirmedCount: getConfirmedCount(challenge),
    participants: challenge.participants.map((p) => ({
      userId: p.userId,
      name: p.name,
      accepted: p.memberStatus === MEMBER_STATUS.CONFIRMED || p.accepted,
      memberStatus: p.memberStatus || (p.accepted ? MEMBER_STATUS.CONFIRMED : MEMBER_STATUS.INVITED),
      acceptText: toMemberStatusText(p.memberStatus || (p.accepted ? MEMBER_STATUS.CONFIRMED : MEMBER_STATUS.INVITED))
    })),
    meMemberStatus,
    meAcceptText: meMemberStatus ? toMemberStatusText(meMemberStatus) : '--',
    isCreator: challenge.creatorUserId === userEngine.getCurrentUserId(),
    canInviteMore: challenge.status === CHALLENGE_STATUS.PENDING
      && challenge.creatorUserId === userEngine.getCurrentUserId()
  };
}

function refreshFromCloudForCurrentUser() {
  const userId = userEngine.getCurrentUserId();
  return Promise.all([
    cloudSyncEngine.refreshChallengeDataForUser(userId),
    cloudSyncEngine.pullUserStats(userId),
    pointEngine.refreshFromCloudForCurrentUser()
  ]).then(([, cloudStats]) => {
    if (cloudStats) {
      upsertUserStats(userId, cloudStats);
    }
    return {
      challenge: getActiveChallenge(),
      stats: getUserStats(userId)
    };
  }).catch(() => ({
    challenge: getActiveChallenge(),
    stats: getUserStats(userId)
  }));
}

module.exports = {
  CHALLENGE_STATUS,
  MEMBER_STATUS,
  getActiveChallenge,
  getChallengeHistory,
  getCurrentUserChallengeHistory,
  createChallenge,
  joinChallengeByShareInvite,
  inviteParticipants,
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
  getUserStats,
  upsertUserStats,
  refreshFromCloudForCurrentUser
};
