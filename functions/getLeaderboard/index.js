const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

/**
 * 获取排行榜数据
 * @param {string} type - 排行榜类型：'challenge' | 'total'
 * @param {string} challengeId - 挑战ID（type为challenge时必需）
 * @param {number} limit - 返回数量限制，默认50
 */
exports.main = async (event, context) => {
  const { type, challengeId, limit = 50 } = event;
  
  try {
    if (type === 'challenge') {
      // 挑战内排行榜
      if (!challengeId) {
        return { success: false, error: '缺少challengeId参数' };
      }
      
      const challengeRes = await db.collection('sleep_rank_challenges')
        .doc(challengeId)
        .get();
      
      if (!challengeRes.data) {
        return { success: false, error: '挑战不存在' };
      }
      
      const challenge = challengeRes.data;
      const participantIds = challenge.participantUserIds || [];
      
      if (participantIds.length === 0) {
        return { success: true, data: [] };
      }
      
      // 获取参与者的统计数据
      const statsRes = await db.collection('sleep_rank_user_stats')
        .where({
          userId: _.in(participantIds)
        })
        .get();
      
      const statsMap = {};
      statsRes.data.forEach(stat => {
        statsMap[stat.userId] = stat;
      });
      
      // 构建排行榜
      const leaderboard = challenge.participants
        .filter(p => p.accepted || p.memberStatus === 'CONFIRMED')
        .map(participant => {
          const stats = statsMap[participant.userId] || {
            totalScore: 0,
            completedChallenges: 0,
            missedChallenges: 0
          };
          
          // 计算当前挑战的分数
          const checkIns = challenge.checkIns || [];
          const userCheckIns = checkIns.filter(c => c.userId === participant.userId);
          const challengeScore = userCheckIns.reduce((sum, c) => sum + (c.dailyScore || 0), 0);
          
          // 计算成功率
          const dailyResults = challenge.dailyResults || [];
          const userResults = dailyResults.filter(r => r.userId === participant.userId);
          const passCount = userResults.filter(r => r.status === 'PASS').length;
          const judgedCount = userResults.length;
          const successRate = judgedCount > 0 ? Math.round((passCount / judgedCount) * 100) : 0;
          
          // 计算连胜
          let streak = 0;
          let currentStreak = 0;
          userResults.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
          for (let i = userResults.length - 1; i >= 0; i--) {
            if (userResults[i].status === 'PASS') {
              currentStreak++;
              streak = Math.max(streak, currentStreak);
            } else {
              break;
            }
          }
          
          return {
            userId: participant.userId,
            nickname: participant.name,
            avatarUrl: participant.avatarUrl || '',
            totalScore: stats.totalScore + challengeScore,
            checkedDays: userCheckIns.length,
            successRate,
            streak,
            isMe: participant.userId === context.OPENID
          };
        })
        .sort((a, b) => {
          return (b.totalScore - a.totalScore) || 
                 (b.successRate - a.successRate) || 
                 (b.streak - a.streak);
        })
        .map((item, index) => ({ ...item, rank: index + 1 }))
        .slice(0, limit);
      
      return { success: true, data: leaderboard };
      
    } else if (type === 'total') {
      // 用户总榜
      const statsRes = await db.collection('sleep_rank_user_stats')
        .orderBy('totalScore', 'desc')
        .limit(limit)
        .get();
      
      const leaderboard = statsRes.data.map((stat, index) => ({
        userId: stat.userId,
        totalScore: stat.totalScore,
        completedChallenges: stat.completedChallenges || 0,
        missedChallenges: stat.missedChallenges || 0,
        rank: index + 1
      }));
      
      return { success: true, data: leaderboard };
      
    } else {
      return { success: false, error: '无效的排行榜类型' };
    }
    
  } catch (err) {
    console.error('[getLeaderboard] Error:', err);
    return { success: false, error: err.message };
  }
};
