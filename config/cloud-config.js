/**
 * 云开发配置统一入口。
 * 后续如果切环境，只改这里即可。
 */
const CLOUD_CONFIG = {
  envId: 'cloud1-7geyd1um08f1f7cf',
  traceUser: true,
  collections: {
    users: 'sleep_rank_users',
    challenges: 'sleep_rank_challenges',
    userStats: 'sleep_rank_user_stats',
    pointAccounts: 'sleep_rank_point_accounts',
    pointLogs: 'sleep_rank_point_logs'
  }
};

module.exports = {
  CLOUD_CONFIG
};
