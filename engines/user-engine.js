const storage = require('../store/storage');
const keys = require('../store/keys');
const cloudSyncEngine = require('./cloud-sync-engine');

// Mock users removed - now using cloud-based user system only

function getCurrentUserId() {
  return storage.get(keys.CURRENT_USER_ID, null);
}

function setCurrentUserId(userId) {
  if (!userId) {
    return;
  }
  storage.set(keys.CURRENT_USER_ID, userId);
}

function getUserDirectory() {
  return storage.get(keys.USER_DIRECTORY, {});
}

function saveUserDirectory(directory) {
  storage.set(keys.USER_DIRECTORY, directory);
}

function upsertUser(user) {
  if (!user || !user.id) {
    return null;
  }
  const directory = getUserDirectory();
  directory[user.id] = {
    ...directory[user.id],
    ...user,
    updatedAt: Date.now()
  };
  saveUserDirectory(directory);
  cloudSyncEngine.syncUserProfile(directory[user.id]);
  return directory[user.id];
}

function isCloudUserId(userId) {
  return Boolean(userId && !String(userId).startsWith('u_'));
}

function getUsers() {
  const directory = getUserDirectory();
  const values = Object.keys(directory).map((id) => directory[id]);
  // Return empty array if no users, forcing cloud sync
  return values;
}

function getGroups() {
  // Groups feature not implemented yet, return empty array
  return [];
}

function getUserById(userId) {
  if (!userId) {
    return null;
  }
  const directory = getUserDirectory();
  if (directory[userId]) {
    return directory[userId];
  }
  // No mock fallback - user must be synced from cloud
  return null;
}

function getCurrentUser() {
  const currentUserId = getCurrentUserId();
  if (!currentUserId) {
    return { id: '', name: '未登录', avatarUrl: '' };
  }
  return getUserById(currentUserId) || { id: currentUserId, name: `用户${String(currentUserId).slice(-6)}`, avatarUrl: '' };
}

function ensureCurrentUser() {
  const currentUserId = getCurrentUserId();
  if (currentUserId) {
    const found = getUserById(currentUserId);
    if (found) {
      return found;
    }
    const fallback = { id: currentUserId, name: `用户${String(currentUserId).slice(-6)}`, avatarUrl: '' };
    return upsertUser(fallback) || fallback;
  }
  // No default mock user - must login first
  return { id: '', name: '未登录', avatarUrl: '' };
}

function upsertCurrentUserProfile(profile = {}) {
  const currentUser = ensureCurrentUser();
  const next = {
    ...currentUser,
    name: profile.nickName || profile.name || currentUser.name,
    nickName: profile.nickName || profile.name || currentUser.nickName || currentUser.name,
    avatarUrl: profile.avatarUrl || currentUser.avatarUrl || '',
    openid: profile.openid || currentUser.openid || null,
    cloudProfileExists: profile.cloudProfileExists === true || currentUser.cloudProfileExists === true
  };
  return upsertUser(next);
}

function fetchWechatProfile() {
  if (typeof wx === 'undefined' || !wx || typeof wx.getUserProfile !== 'function') {
    return Promise.reject(new Error('USER_PROFILE_API_UNAVAILABLE'));
  }

  const runGetUserProfile = () => new Promise((resolve, reject) => {
    wx.getUserProfile({
      desc: '用于完善你的昵称和头像',
      success: (res) => resolve(res.userInfo || {}),
      fail: (err) => reject(err)
    });
  });
  if (typeof wx.requirePrivacyAuthorize !== 'function') {
    return runGetUserProfile();
  }
  return new Promise((resolve, reject) => {
    wx.requirePrivacyAuthorize({
      success: () => runGetUserProfile().then(resolve).catch(reject),
      fail: (err) => reject(err)
    });
  });
}

function authorizeCurrentUserProfile() {
  return fetchWechatProfile().then((userInfo) => {
    const profile = upsertCurrentUserProfile({
      nickName: userInfo.nickName,
      avatarUrl: userInfo.avatarUrl
    });
    return profile;
  });
}

function isMaskedWechatProfile(userInfo = {}) {
  const nickName = String(userInfo.nickName || '').trim();
  const avatarUrl = String(userInfo.avatarUrl || '').trim();
  // 如果没有昵称或头像，或者昵称为默认值，则认为是匿名
  const maskedName = !nickName || nickName === '微信用户' || nickName.startsWith('用户');
  return maskedName || !avatarUrl;
}

function isValidNickname(nickName) {
  const value = String(nickName || '').trim();
  if (!value) {
    return false;
  }
  if (value === '微信用户' || value.startsWith('用户')) {
    return false;
  }
  return true;
}

function shouldPromptProfileAuth(user = getCurrentUser()) {
  return isMaskedWechatProfile({
    nickName: user.nickName || user.name,
    avatarUrl: user.avatarUrl
  });
}

function isProfileCompleted(user = getCurrentUser()) {
  if (user && user.cloudProfileExists) {
    return true;
  }
  const nick = user.nickName || user.name;
  const avatar = user.avatarUrl || '';
  return isValidNickname(nick) && Boolean(String(avatar).trim());
}

function shouldPromptCloudProfileSetup(user = getCurrentUser()) {
  if (!user || !user.cloudProfileExists) {
    return {
      shouldPrompt: false,
      missingNickname: false,
      missingAvatar: false
    };
  }
  const nick = user.nickName || user.name || '';
  const missingNickname = !isValidNickname(nick);
  const missingAvatar = !String(user.avatarUrl || '').trim();
  return {
    shouldPrompt: missingNickname || missingAvatar,
    missingNickname,
    missingAvatar
  };
}

function saveProfile({ nickName, avatarUrl }) {
  if (!isValidNickname(nickName)) {
    return { ok: false, reason: 'INVALID_NICKNAME' };
  }
  if (!String(avatarUrl || '').trim()) {
    return { ok: false, reason: 'MISSING_AVATAR' };
  }
  const profile = upsertCurrentUserProfile({
    nickName: String(nickName).trim(),
    avatarUrl: String(avatarUrl).trim()
  });
  return { ok: true, profile };
}

function authorizeCurrentUserProfileOneTap(eventUserInfo) {
  if (eventUserInfo && !isMaskedWechatProfile(eventUserInfo)) {
    const profile = upsertCurrentUserProfile({
      nickName: eventUserInfo.nickName,
      avatarUrl: eventUserInfo.avatarUrl
    });
    return Promise.resolve({
      ok: true,
      profile,
      source: 'getUserProfile',
      masked: false
    });
  }
  return authorizeCurrentUserProfile()
    .then((profile) => {
      const masked = isMaskedWechatProfile(profile);
      if (masked) {
        const current = ensureCurrentUser();
        return {
          ok: true,
          profile: current,
          source: 'getUserProfile',
          masked: true
        };
      }
      return {
        ok: true,
        profile,
        source: 'getUserProfile',
        masked: false
      };
    });
}

function bootstrapCloudUser() {
  if (typeof wx === 'undefined' || !wx || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.resolve(ensureCurrentUser());
  }
  return wx.cloud.callFunction({
    name: 'login'
  }).then((res) => {
    const openid = res && res.result && res.result.openid;
    if (!openid) {
      return ensureCurrentUser();
    }
    setCurrentUserId(openid);
    const fallbackUser = {
      id: openid,
      openid,
      name: `用户${String(openid).slice(-6)}`,
      avatarUrl: '',
      cloudProfileExists: false
    };
    const applyCloudUser = (cloudUser) => {
      if (!cloudUser) {
        return upsertCurrentUserProfile({
          openid,
          cloudProfileExists: false
        }) || fallbackUser;
      }
      return upsertCurrentUserProfile({
        openid,
        name: cloudUser.name,
        nickName: cloudUser.nickName || cloudUser.name,
        avatarUrl: cloudUser.avatarUrl || '',
        cloudProfileExists: true
      }) || fallbackUser;
    };
    return cloudSyncEngine.pullUserProfile(openid)
      .then((cloudUserById) => {
        if (cloudUserById) {
          return applyCloudUser(cloudUserById);
        }
        return cloudSyncEngine.pullUserProfileByOpenid(openid)
          .then((cloudUserByOpenid) => applyCloudUser(cloudUserByOpenid));
      });
  }).catch(() => ensureCurrentUser());
}

module.exports = {
  getUsers,
  getGroups,
  getCurrentUser,
  getCurrentUserId,
  setCurrentUserId,
  getUserById,
  upsertUser,
  upsertCurrentUserProfile,
  authorizeCurrentUserProfile,
  authorizeCurrentUserProfileOneTap,
  isMaskedWechatProfile,
  isValidNickname,
  shouldPromptProfileAuth,
  shouldPromptCloudProfileSetup,
  isProfileCompleted,
  saveProfile,
  ensureCurrentUser,
  bootstrapCloudUser
};
