/**
 * 轻量本地存储封装。
 * 目前使用 wx storage，未来切换数据库或远端 API 时只需要替换这一层。
 */
function get(key, defaultValue = null) {
  try {
    const value = wx.getStorageSync(key);
    return value === '' ? defaultValue : value;
  } catch (error) {
    console.warn(`[storage] get failed: ${key}`, error);
    return defaultValue;
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    console.warn(`[storage] set failed: ${key}`, error);
    return false;
  }
}

function remove(key) {
  try {
    wx.removeStorageSync(key);
    return true;
  } catch (error) {
    console.warn(`[storage] remove failed: ${key}`, error);
    return false;
  }
}

module.exports = {
  get,
  set,
  remove
};
