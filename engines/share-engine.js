const storage = require('../store/storage');
const keys = require('../store/keys');

function getLastShareContext() {
  return storage.get(keys.SHARE_CONTEXT, null);
}

function saveShareContext(context) {
  if (!context) {
    return null;
  }
  storage.set(keys.SHARE_CONTEXT, {
    ...context,
    capturedAt: Date.now()
  });
  return getLastShareContext();
}

function pickShareTicket(options = {}) {
  if (!options) {
    return '';
  }
  if (typeof options.shareTicket === 'string') {
    return options.shareTicket;
  }
  if (Array.isArray(options.shareTickets) && options.shareTickets.length > 0) {
    return options.shareTickets[0] || '';
  }
  return '';
}

function captureShareInfoFromAppOptions(options = {}, source = 'onShow') {
  const shareTicket = pickShareTicket(options);
  if (!shareTicket) {
    return Promise.resolve(null);
  }
  const baseContext = {
    source,
    scene: options.scene || null,
    path: options.path || '',
    query: options.query || {},
    shareTicket
  };
  if (typeof wx === 'undefined' || !wx || typeof wx.getShareInfo !== 'function') {
    return Promise.resolve(saveShareContext(baseContext));
  }
  return new Promise((resolve) => {
    wx.getShareInfo({
      shareTicket,
      success: (res) => resolve(saveShareContext({
        ...baseContext,
        encryptedData: res.encryptedData || '',
        iv: res.iv || '',
        cloudID: res.cloudID || ''
      })),
      fail: () => resolve(saveShareContext(baseContext))
    });
  });
}

module.exports = {
  getLastShareContext,
  captureShareInfoFromAppOptions
};
