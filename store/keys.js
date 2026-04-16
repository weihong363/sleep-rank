/**
 * Storage key 常量管理。
 * 统一管理 key，避免散落硬编码，便于后续迁移到后端或做版本升级。
 */
module.exports = {
  ACTIVE_CHALLENGE: 'sleep_rank_v2_active_challenge',
  CHALLENGE_HISTORY: 'sleep_rank_v2_challenge_history',
  ACTIVE_SLEEP_SESSION: 'sleep_rank_v2_active_sleep_session',
  LATEST_SLEEP_RECORD: 'sleep_rank_v2_latest_sleep_record',
  SLEEP_SESSION_HISTORY: 'sleep_rank_v2_sleep_session_history',
  CURRENT_USER_ID: 'sleep_rank_v2_current_user_id',
  CHALLENGE_DRAFT_PARTICIPANTS: 'sleep_rank_v2_challenge_draft_participants',
  SHARE_CONTEXT: 'sleep_rank_v2_share_context',
  USER_STATS_MAP: 'sleep_rank_v2_user_stats_map',
  USER_DIRECTORY: 'sleep_rank_v2_user_directory',
  POINT_ACCOUNT_MAP: 'sleep_rank_v2_point_account_map',
  POINT_LOG_MAP: 'sleep_rank_v2_point_log_map'
};
