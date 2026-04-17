const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

/**
 * 批量同步数据到云端
 * @param {Array} challenges - 挑战数据数组
 * @param {Object} userStats - 用户统计数据
 * @param {Array} pointLogs - 积分流水数组
 */
exports.main = async (event, context) => {
  const { challenges, userStats, pointLogs } = event;
  const openid = context.OPENID;
  
  const results = {
    challenges: { success: 0, failed: 0, errors: [] },
    userStats: { success: false, error: null },
    pointLogs: { success: 0, failed: 0, errors: [] }
  };
  
  try {
    // 1. 批量同步挑战数据
    if (challenges && Array.isArray(challenges)) {
      for (const challenge of challenges) {
        try {
          // 验证权限：只有参与者才能同步
          if (!challenge.participantUserIds || !challenge.participantUserIds.includes(openid)) {
            results.challenges.failed++;
            results.challenges.errors.push(`挑战 ${challenge.id} 无权访问`);
            continue;
          }
          
          await db.collection('sleep_rank_challenges')
            .doc(challenge.id)
            .set({
              data: {
                ...challenge,
                updatedAt: db.serverDate()
              }
            });
          
          results.challenges.success++;
        } catch (err) {
          results.challenges.failed++;
          results.challenges.errors.push(`挑战 ${challenge.id}: ${err.message}`);
        }
      }
    }
    
    // 2. 同步用户统计
    if (userStats) {
      try {
        if (userStats.userId !== openid) {
          results.userStats.error = '无权修改其他用户数据';
        } else {
          await db.collection('sleep_rank_user_stats')
            .doc(userStats.userId)
            .set({
              data: {
                ...userStats,
                updatedAt: db.serverDate()
              }
            });
          results.userStats.success = true;
        }
      } catch (err) {
        results.userStats.error = err.message;
      }
    }
    
    // 3. 批量同步积分流水
    if (pointLogs && Array.isArray(pointLogs)) {
      for (const log of pointLogs) {
        try {
          // 验证权限
          if (log.userId !== openid) {
            results.pointLogs.failed++;
            results.pointLogs.errors.push(`积分流水 ${log.id} 无权访问`);
            continue;
          }
          
          await db.collection('sleep_rank_point_logs')
            .doc(log.id)
            .set({
              data: log
            });
          
          results.pointLogs.success++;
        } catch (err) {
          results.pointLogs.failed++;
          results.pointLogs.errors.push(`积分流水 ${log.id}: ${err.message}`);
        }
      }
    }
    
    return {
      success: true,
      results
    };
    
  } catch (err) {
    console.error('[batchSync] Error:', err);
    return { 
      success: false, 
      error: err.message,
      results
    };
  }
};
