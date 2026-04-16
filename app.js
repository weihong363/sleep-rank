const sleepEngine = require('./engines/sleep-engine');
const userEngine = require('./engines/user-engine');
const challengeEngine = require('./engines/challenge-engine');
const cloudSyncEngine = require('./engines/cloud-sync-engine');
const shareEngine = require('./engines/share-engine');

App({
  onLaunch(options = {}) {
    cloudSyncEngine.initCloud();
    shareEngine.captureShareInfoFromAppOptions(options, 'onLaunch').catch(() => null);
    // 静默登录获取 openid，不请求用户资料
    userEngine.bootstrapCloudUser()
      .then(() => challengeEngine.refreshFromCloudForCurrentUser())
      .catch(() => null);
  },

  onShow(options = {}) {
    // 全局前后台切换监听：由 Sleep Engine 统一处理 wake_count 统计
    sleepEngine.onAppShow();
    shareEngine.captureShareInfoFromAppOptions(options, 'onShow').catch(() => null);
    challengeEngine.refreshFromCloudForCurrentUser().catch(() => null);
  },

  onHide() {
    sleepEngine.onAppHide();
  }
});
