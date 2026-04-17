const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

/**
 * 获取挑战统计数据
 * @param {string} challengeId - 挑战ID
 */
exports.main = async (event, context) => {
  const { challengeId } = event;
  
  if (!challengeId) {
    return { success: false, error: '缺少challengeId参数' };
  }
  
  try {
    // 获取挑战详情
    const challengeRes = await db.collection('sleep_rank_challenges')
      .doc(challengeId)
      .get();
    
    if (!challengeRes.data) {
      return { success: false, error: '挑战不存在' };
    }
    
    const challenge = challengeRes.data;
    const participantIds = challenge.participantUserIds || [];
    
    // 获取参与者统计
    const statsRes = await db.collection('sleep_rank_user_stats')
      .where({
        userId: _.in(participantIds)
      })
      .get();
    
    // 计算整体统计
    const totalParticipants = challenge.participants.length;
    const acceptedParticipants = challenge.participants.filter(p => p.accepted || p.memberStatus === 'CONFIRMED').length;
    
    // 计算每日通过率
    const dailyResults = challenge.dailyResults || [];
    const totalJudged = dailyResults.length;
    const totalPassed = dailyResults.filter(r => r.status === 'PASS').length;
    const overallPassRate = totalJudged > 0 ? Math.round((totalPassed / totalJudged) * 100) : 0;
    
    // 按日期统计
    const dateStats = {};
    dailyResults.forEach(result => {
      if (!dateStats[result.dateKey]) {
        dateStats[result.dateKey] = { total: 0, passed: 0 };
      }
      dateStats[result.dateKey].total++;
      if (result.status === 'PASS') {
        dateStats[result.dateKey].passed++;
      }
    });
    
    const dailyStats = Object.keys(dateStats).map(dateKey => ({
      dateKey,
      total: dateStats[dateKey].total,
      passed: dateStats[dateKey].passed,
      passRate: Math.round((dateStats[dateKey].passed / dateStats[dateKey].total) * 100)
    })).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    
    // 计算平均连胜
    let totalStreak = 0;
    let maxStreak = 0;
    statsRes.data.forEach(stat => {
      const streak = stat.currentStreak || 0;
      totalStreak += streak;
      maxStreak = Math.max(maxStreak, streak);
    });
    const avgStreak = statsRes.data.length > 0 ? Math.round(totalStreak / statsRes.data.length) : 0;
    
    return {
      success: true,
      data: {
        challengeInfo: {
          id: challenge.id,
          name: challenge.name,
          status: challenge.status,
          targetDays: challenge.targetDays,
          startDate: challenge.startDate,
          creatorName: challenge.creatorName
        },
        participantStats: {
          total: totalParticipants,
          accepted: acceptedParticipants,
          active: acceptedParticipants
        },
        overallStats: {
          totalJudged,
          totalPassed,
          overallPassRate,
          avgStreak,
          maxStreak
        },
        dailyStats,
        topPerformers: statsRes.data
          .sort((a, b) => b.totalScore - a.totalScore)
          .slice(0, 5)
          .map(stat => ({
            userId: stat.userId,
            totalScore: stat.totalScore,
            completedChallenges: stat.completedChallenges || 0
          }))
      }
    };
    
  } catch (err) {
    console.error('[getChallengeStats] Error:', err);
    return { success: false, error: err.message };
  }
};
