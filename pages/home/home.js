const sleepEngine = require('../../engines/sleep-engine');
const challengeEngine = require('../../engines/challenge-engine');
const userEngine = require('../../engines/user-engine');

const FAIL_TYPE_TEXT_MAP = {
  FAIL_TIMEOUT: '超时未按时入睡',
  FAIL_MISS: '当天漏打卡',
  FAIL_EARLY_ACTIVE: '打卡后过早活跃',
  FAIL_INTERRUPT: '醒来次数过多',
  FAIL_EARLY_WAKE: '睡眠时长不足',
  FAIL_LONG_WAKE: '单次清醒过长'
};

Page({
  data: {
    isSleeping: false,
    isGlowing: false,
    labelTop: 'sleep',
    labelBottom: 'now',
    ripples: [],
    hasPendingInvite: false,
    pendingInviteChallengeId: '',
    requireProfileComplete: false,
    requireCloudProfileSetup: false,
    cloudProfileSetupText: '',
    profileNickName: '',
    profileAvatarUrl: ''
  },

  glowTimer: null,
  rippleTimer: null,
  inviteProcessing: false,

  onLoad(options = {}) {
    const inviteChallengeId = (options && options.inviteChallengeId) || '';
    if (inviteChallengeId) {
      this.setData({ pendingInviteChallengeId: inviteChallengeId });
    }
  },

  getSleepActionLabel(challenge) {
    const canSleepInChallenge = challengeEngine.canCurrentUserSleep(challenge);
    if (!canSleepInChallenge) {
      return {
        labelTop: 'sleep',
        labelBottom: 'now'
      };
    }
    const hour = new Date().getHours();
    const isNight = hour >= 18 || hour < 5;
    return {
      labelTop: 'good',
      labelBottom: isNight ? 'night' : 'morning'
    };
  },

  refreshPageState() {
    const active = sleepEngine.getActiveSession();
    const challenge = challengeEngine.getActiveChallenge();
    const pendingInvite = challengeEngine.getPendingInvitationForCurrentUser();
    const actionLabel = this.getSleepActionLabel(challenge);
    const currentUser = userEngine.getCurrentUser();
    const cloudProfileSetup = userEngine.shouldPromptCloudProfileSetup(currentUser);
    const cloudProfileSetupText = cloudProfileSetup.missingNickname && cloudProfileSetup.missingAvatar
      ? '昵称和头像未设置，点击前往个人资料完善'
      : cloudProfileSetup.missingNickname
        ? '昵称未设置，点击前往个人资料完善'
        : cloudProfileSetup.missingAvatar
          ? '头像未设置，点击前往个人资料完善'
          : '';
    this.setData({
      isSleeping: Boolean(active && active.isSleeping),
      hasPendingInvite: Boolean(pendingInvite),
      labelTop: actionLabel.labelTop,
      labelBottom: actionLabel.labelBottom,
      requireProfileComplete: !userEngine.isProfileCompleted(currentUser),
      requireCloudProfileSetup: cloudProfileSetup.shouldPrompt,
      cloudProfileSetupText,
      profileNickName: currentUser.nickName || '',
      profileAvatarUrl: currentUser.avatarUrl || ''
    });
  },

  onShow() {
    userEngine.bootstrapCloudUser()
      .catch(() => null)
      .finally(() => {
        challengeEngine.refreshFromCloudForCurrentUser()
          .finally(() => {
            this.refreshPageState();
            this.processPendingInviteEntry();
          });
      });
  },

  processPendingInviteEntry() {
    const inviteChallengeId = this.data.pendingInviteChallengeId;
    if (!inviteChallengeId || this.inviteProcessing) {
      return;
    }
    if (this.data.requireProfileComplete) {
      return;
    }
    this.inviteProcessing = true;
    challengeEngine.joinChallengeByShareInvite(inviteChallengeId).then((res) => {
      this.inviteProcessing = false;
      if (!res.ok) {
        const reasonTextMap = {
          ALREADY_IN_CHALLENGE: '你已在其他挑战中',
          CHALLENGE_NOT_FOUND: '邀请挑战不存在',
          CHALLENGE_NOT_PENDING: '该挑战已开始或已结束',
          LOAD_CHALLENGE_FAILED: '邀请加载失败，请稍后重试'
        };
        wx.showToast({
          title: reasonTextMap[res.reason] || '加入挑战失败',
          icon: 'none'
        });
        this.setData({ pendingInviteChallengeId: '' });
        return;
      }
      this.setData({ pendingInviteChallengeId: '' });
      challengeEngine.refreshFromCloudForCurrentUser().finally(() => {
        this.refreshPageState();
        wx.navigateTo({
          url: `/pages/challenge-create/challenge-create?fromInvite=1&inviteChallengeId=${inviteChallengeId}`
        });
      });
    });
  },

  onProfileNickInput(e) {
    this.setData({
      profileNickName: e.detail.value || ''
    });
  },

  onChooseProfileAvatar(e) {
    this.setData({
      profileAvatarUrl: (e && e.detail && e.detail.avatarUrl) || ''
    });
  },

  onSaveProfileFromHome() {
    const result = userEngine.saveProfile({
      nickName: this.data.profileNickName,
      avatarUrl: this.data.profileAvatarUrl
    });
    if (!result.ok) {
      const msg = result.reason === 'INVALID_NICKNAME' ? '请输入有效昵称' : '请先选择头像';
      wx.showToast({
        title: msg,
        icon: 'none'
      });
      return;
    }
    challengeEngine.refreshFromCloudForCurrentUser()
      .finally(() => {
        this.refreshPageState();
        this.processPendingInviteEntry();
        wx.showToast({
          title: '资料已保存',
          icon: 'success'
        });
      });
  },

  handleTap(e) {
    if (this.data.requireProfileComplete) {
      wx.showToast({
        title: '请先完善个人资料',
        icon: 'none'
      });
      return;
    }

    const { x = 0, y = 0 } = e.detail || {};
    const size = 320;
    const left = x - size / 2;
    const top = y - size / 2;
    const rippleId = Date.now();
    const nextSleeping = !this.data.isSleeping;
    const challenge = challengeEngine.getActiveChallenge();

    if (!challenge) {
      wx.showToast({
        title: '请先创建或接受挑战',
        icon: 'none'
      });
      return;
    }

    const ackResult = challengeEngine.acknowledgeChallengeEndByCurrentUser();
    if (ackResult.ok && (ackResult.state === 'WAITING' || ackResult.state === 'COMPLETED')) {
      wx.showToast({
        title: ackResult.state === 'COMPLETED'
          ? '挑战已结束，可发起新挑战'
          : `挑战周期已结束，等待${ackResult.remaining}人确认`,
        icon: 'none'
      });
      return;
    }

    if (!challengeEngine.canCurrentUserSleep(challenge)) {
      const me = challengeEngine.getCurrentParticipant(challenge);
      const message = !me
        ? '请先创建或接受挑战'
        : challenge.status === challengeEngine.CHALLENGE_STATUS.COMPLETED
          ? '当前挑战已完成'
          : challenge.status === challengeEngine.CHALLENGE_STATUS.WAITING_FINAL_ACK
            ? '挑战周期已结束，请点击确认完成'
            : challenge.status === challengeEngine.CHALLENGE_STATUS.PENDING
              ? (me && me.accepted ? '请等待挑战开始' : '请先接受挑战邀请')
              : '挑战尚未开始';
      wx.showToast({
        title: message,
        icon: 'none'
      });
      return;
    }

    if (nextSleeping) {
      const todayCheckIn = challengeEngine.getTodayCheckIn(challenge);
      if (todayCheckIn) {
        wx.showToast({
          title: '今日已完成打卡',
          icon: 'none'
        });
        return;
      }
      sleepEngine.startSleep();
      wx.showToast({
        title: '已记录入睡时间',
        icon: 'none'
      });
    } else {
      const record = sleepEngine.endSleep();
      if (record) {
        const checkInResult = challengeEngine.addTodayCheckIn(record);
        if (checkInResult.ok) {
          const isPass = checkInResult.checkIn.dailyJudgeResult.status === 'PASS';
          const failType = checkInResult.checkIn.dailyJudgeResult.failType;
          wx.showToast({
            title: isPass
              ? `我的记录已更新 +${checkInResult.checkIn.dailyScore}`
              : `判定失败 ${FAIL_TYPE_TEXT_MAP[failType] || failType}`,
            icon: 'none'
          });
        } else {
          const failTextMap = {
            FAIL_MISS_LOCKED: '今日已判定漏打卡，不能再打卡',
            PERIOD_ENDED: '挑战周期已结束，请确认完成'
          };
          wx.showToast({
            title: failTextMap[checkInResult.reason] || `score ${record.sleepScore}`,
            icon: 'none'
          });
        }
      }
    }

    const actionLabel = this.getSleepActionLabel(challengeEngine.getActiveChallenge());
    this.setData({
      ripples: [...this.data.ripples, { id: rippleId, size, left, top }],
      isGlowing: true,
      isSleeping: nextSleeping,
      labelTop: actionLabel.labelTop,
      labelBottom: actionLabel.labelBottom
    });

    clearTimeout(this.glowTimer);
    this.glowTimer = setTimeout(() => {
      this.setData({ isGlowing: false });
    }, 520);

    clearTimeout(this.rippleTimer);
    this.rippleTimer = setTimeout(() => {
      this.setData({
        ripples: this.data.ripples.filter((item) => item.id !== rippleId)
      });
    }, 700);
  },

  goCreateChallenge() {
    wx.navigateTo({
      url: '/pages/challenge-create/challenge-create'
    });
  },

  goCheckIn() {
    wx.navigateTo({
      url: '/pages/checkin/checkin'
    });
  },

  goProfile() {
    wx.navigateTo({
      url: '/pages/profile/profile'
    });
  },

  onGoAcceptInvite() {
    wx.navigateTo({
      url: '/pages/challenge-create/challenge-create'
    });
  },

  onGoCloudProfileSetup() {
    wx.navigateTo({
      url: '/pages/profile/profile'
    });
  },

  onUnload() {
    if (this.glowTimer) {
      clearTimeout(this.glowTimer);
    }
    if (this.rippleTimer) {
      clearTimeout(this.rippleTimer);
    }
  }
});
