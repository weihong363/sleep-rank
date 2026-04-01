const sleepEngine = require('./engines/sleep-engine');

App({
  onShow() {
    // 全局前后台切换监听：由 Sleep Engine 统一处理 wake_count 统计
    sleepEngine.onAppShow();
  },

  onHide() {
    sleepEngine.onAppHide();
  }
});
