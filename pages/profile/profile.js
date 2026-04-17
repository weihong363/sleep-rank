const userEngine = require('../../engines/user-engine');
const challengeEngine = require('../../engines/challenge-engine');

Page({
  data: {
    nickName: '',
    avatarUrl: '',
    profileCompleted: false
  },

  onShow() {
    challengeEngine.refreshFromCloudForCurrentUser().finally(() => {
      const user = userEngine.getCurrentUser();
      this.setData({
        nickName: user.nickName || user.name || '',
        avatarUrl: user.avatarUrl || '',
        profileCompleted: userEngine.isProfileCompleted(user)
      });
    });
  },

  onChooseAvatar(e) {
    this.setData({
      avatarUrl: (e && e.detail && e.detail.avatarUrl) || ''
    });
  },

  onSave() {
    const result = userEngine.saveProfile({
      nickName: this.data.nickName,
      avatarUrl: this.data.avatarUrl
    });
    if (!result.ok) {
      const msg = result.reason === 'INVALID_NICKNAME' ? '请输入有效昵称' : '请先选择头像';
      wx.showToast({
        title: msg,
        icon: 'none'
      });
      return;
    }
    challengeEngine.refreshFromCloudForCurrentUser().finally(() => {
      const user = userEngine.getCurrentUser();
      this.setData({
        nickName: user.nickName || user.name || '',
        avatarUrl: user.avatarUrl || '',
        profileCompleted: userEngine.isProfileCompleted(user)
      });
      wx.showToast({
        title: '资料已更新',
        icon: 'success'
      });
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
