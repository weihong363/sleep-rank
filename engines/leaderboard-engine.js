const userEngine = require('./user-engine');

/**
 * Leaderboard Engine
 * - MVP 阶段提供“本地简易排行榜”能力
 * - 目前使用本地挑战数据 + 固定示例玩家生成榜单
 */
function buildLeaderboard(activeChallenge) {
  const currentUser = userEngine.getCurrentUser();
  const myCheckIns = activeChallenge
    ? activeChallenge.checkIns.filter((item) => item.userId === currentUser.id)
    : [];
  const checkedDays = myCheckIns.length;
  const totalScore = myCheckIns.reduce((sum, item) => sum + item.dailyScore, 0);

  const seeds = [
    { nickname: '夜跑阿泽', totalScore: 560, checkedDays: 7 },
    { nickname: '晨光Mia', totalScore: 520, checkedDays: 7 },
    { nickname: '晚睡克星', totalScore: 498, checkedDays: 6 }
  ];

  const me = {
    nickname: `${currentUser.name}(我)`,
    totalScore,
    checkedDays
  };

  const merged = [me, ...seeds]
    .sort((a, b) => (b.totalScore - a.totalScore) || (b.checkedDays - a.checkedDays))
    .map((item, index) => ({
      rank: index + 1,
      ...item
    }));

  return merged;
}

module.exports = {
  buildLeaderboard
};
