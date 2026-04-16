const challengeEngine = require('./challenge-engine');
const userEngine = require('./user-engine');

function toDateStart(dateKey) {
  const [year, month, day] = dateKey.split('-').map((n) => Number(n));
  return new Date(year, month - 1, day).getTime();
}

function calculateSuccessRate(passDays, judgedDays) {
  if (!judgedDays) {
    return 0;
  }
  return Math.round((passDays / judgedDays) * 100);
}

function calculatePassStreak(dailyResults) {
  if (!Array.isArray(dailyResults) || dailyResults.length === 0) {
    return 0;
  }
  const sorted = [...dailyResults]
    .sort((a, b) => toDateStart(a.dateKey) - toDateStart(b.dateKey));
  let streak = 0;
  let expectedDate = null;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const item = sorted[i];
    const dayStart = toDateStart(item.dateKey);
    if (item.status !== 'PASS') {
      break;
    }
    if (expectedDate !== null && dayStart !== expectedDate) {
      break;
    }
    streak += 1;
    expectedDate = dayStart - 24 * 60 * 60 * 1000;
  }
  return streak;
}

function getChallengeUserStat(activeChallenge, userId) {
  const checkIns = activeChallenge
    ? activeChallenge.checkIns.filter((item) => item.userId === userId)
    : [];
  const dailyResults = activeChallenge && Array.isArray(activeChallenge.dailyResults)
    ? activeChallenge.dailyResults.filter((item) => item.userId === userId)
    : [];
  const totalScore = checkIns.reduce((sum, item) => sum + item.dailyScore, 0);
  const passDays = dailyResults.filter((item) => item.status === 'PASS').length;
  const judgedDays = dailyResults.length;
  return {
    totalScore,
    checkedDays: checkIns.length,
    passDays,
    judgedDays,
    successRate: calculateSuccessRate(passDays, judgedDays),
    streak: calculatePassStreak(dailyResults)
  };
}

function toRankList(rows) {
  return rows
    .sort((a, b) => (b.totalScore - a.totalScore) || (b.successRate - a.successRate) || (b.streak - a.streak))
    .map((item, index) => ({ rank: index + 1, ...item }));
}

/**
 * 挑战内排行榜：只基于当前挑战真实数据，不混入 seed。
 */
function buildChallengeLeaderboard(activeChallenge) {
  if (!activeChallenge || !Array.isArray(activeChallenge.participants)) {
    return [];
  }
  const currentUserId = userEngine.getCurrentUserId();
  const rows = activeChallenge.participants
    .filter((participant) => participant.accepted)
    .map((participant) => {
      const stat = getChallengeUserStat(activeChallenge, participant.userId);
      return {
        userId: participant.userId,
        nickname: participant.userId === currentUserId ? `${participant.name}(我)` : participant.name,
        totalScore: stat.totalScore,
        checkedDays: stat.checkedDays,
        successRate: stat.successRate,
        streak: stat.streak
      };
    });
  return toRankList(rows);
}

/**
 * 用户总榜：用累计 UserStats + 当前挑战实时分。
 */
function buildUserTotalLeaderboard(activeChallenge) {
  // Get users from challenge participants and user directory
  const participantUserIds = new Set();
  if (activeChallenge && activeChallenge.participants) {
    activeChallenge.participants.forEach((p) => participantUserIds.add(p.userId));
  }
  
  const users = userEngine.getUsers();
  const allUserIds = new Set(users.map((u) => u.id));
  participantUserIds.forEach((id) => allUserIds.add(id));
  
  const currentUserId = userEngine.getCurrentUserId();
  const rows = Array.from(allUserIds).map((userId) => {
    const user = userEngine.getUserById(userId) || { id: userId, name: `用户${String(userId).slice(-6)}` };
    const userStats = challengeEngine.getUserStats(userId);
    const challengeStat = getChallengeUserStat(activeChallenge, userId);
    const judgedChallenges = userStats.completedChallenges + userStats.missedChallenges;
    return {
      userId,
      nickname: userId === currentUserId ? `${user.name}(我)` : user.name,
      totalScore: userStats.totalScore + challengeStat.totalScore,
      checkedDays: challengeStat.checkedDays,
      successRate: calculateSuccessRate(userStats.completedChallenges, judgedChallenges),
      streak: challengeStat.streak
    };
  });
  return toRankList(rows);
}

function buildLeaderboard(activeChallenge) {
  return buildChallengeLeaderboard(activeChallenge);
}

module.exports = {
  buildLeaderboard,
  buildChallengeLeaderboard,
  buildUserTotalLeaderboard
};
