const challengeEngine = require('../../engines/challenge-engine');
const storage = require('../../store/storage');
const keys = require('../../store/keys');

const TIME_OPTIONS = [
  '21:00', '21:30', '22:00', '22:30',
  '23:00', '23:30', '00:00', '00:30',
  '06:00', '06:30', '07:00', '07:30', '08:00'
];

Page({
  data: {
    challengeName: '早睡 7 天挑战',
    dayOptions: [1, 3, 5, 7, 14, 21, 30],
    dayOptionIndex: 2,
    timeOptions: TIME_OPTIONS,
    sleepStartIndex: 4,
    sleepEndIndex: 10,
    selectedParticipantNames: [],
    selectedParticipants: [],
    participantPreviewText: '暂未选择',
    activeSummary: null,
    showCreateCard: true,
    canCancel: false,
    pendingInviteSummary: null,
    fromInviteEntry: false,
    inviteChallengeId: ''
  },

  onLoad(options = {}) {
    this.setData({
      fromInviteEntry: String(options.fromInvite || '') === '1',
      inviteChallengeId: options.inviteChallengeId || ''
    });
  },

  onShow() {
    if (typeof wx !== 'undefined' && wx.showShareMenu) {
      wx.showShareMenu({
        menus: ['shareAppMessage', 'shareTimeline']
      });
    }
    challengeEngine.refreshFromCloudForCurrentUser().finally(() => {
      this.loadDraftSelection();
      this.refreshChallengeState();
    });
  },

  loadDraftSelection() {
    const draft = storage.get(keys.CHALLENGE_DRAFT_PARTICIPANTS, null);
    if (!draft) {
      return;
    }
    this.setData({
      selectedParticipants: draft.participants || [],
      selectedParticipantNames: draft.userNames || [],
      participantPreviewText: draft.participantPreviewText || ((draft.userNames || []).length > 0
        ? draft.userNames.join('、')
        : '暂未选择'
      )
    });
  },

  refreshChallengeState() {
    const challenge = challengeEngine.getActiveChallenge();
    const currentParticipant = challenge
      ? challengeEngine.getCurrentParticipant(challenge)
      : null;
    const summary = currentParticipant
      ? challengeEngine.getDisplayChallengeSummary(challenge)
      : null;
    const pendingInvite = challengeEngine.getPendingInvitationForCurrentUser();

    this.setData({
      activeSummary: summary,
      showCreateCard: (
        !summary ||
        summary.status === challengeEngine.CHALLENGE_STATUS.CANCELED ||
        summary.status === challengeEngine.CHALLENGE_STATUS.COMPLETED
      ),
      canCancel: Boolean(
        summary &&
        summary.isCreator &&
        summary.status === challengeEngine.CHALLENGE_STATUS.PENDING
      ),
      pendingInviteSummary: pendingInvite
        ? challengeEngine.getDisplayChallengeSummary(pendingInvite)
        : null
    });
  },

  onNameInput(e) {
    this.setData({
      challengeName: e.detail.value
    });
  },

  onDayChange(e) {
    this.setData({
      dayOptionIndex: Number(e.detail.value)
    });
  },

  onSleepStartChange(e) {
    this.setData({
      sleepStartIndex: Number(e.detail.value)
    });
  },

  onSleepEndChange(e) {
    this.setData({
      sleepEndIndex: Number(e.detail.value)
    });
  },

  onCreateTap() {
    const name = (this.data.challengeName || '').trim() || '我的睡眠挑战';
    const targetDays = this.data.dayOptions[this.data.dayOptionIndex];
    const sleepWindowStart = this.data.timeOptions[this.data.sleepStartIndex];
    const sleepWindowEnd = this.data.timeOptions[this.data.sleepEndIndex];

    const result = challengeEngine.createChallenge({
      name,
      targetDays,
      sleepWindowStart,
      sleepWindowEnd,
      participants: []
    });

    if (!result.ok) {
      const titleMap = {
        ALREADY_IN_CHALLENGE: '你已参与一个挑战'
      };
      wx.showToast({
        title: titleMap[result.reason] || '创建失败',
        icon: 'none'
      });
      return;
    }

    storage.remove(keys.CHALLENGE_DRAFT_PARTICIPANTS);
    this.refreshChallengeState();
    wx.showToast({
      title: '挑战已发起，等待成员确认',
      icon: 'none'
    });
  },

  onAcceptInvite() {
    const result = challengeEngine.acceptChallenge();
    if (!result.ok) {
      wx.showToast({
        title: '接受失败',
        icon: 'none'
      });
      return;
    }
    wx.showToast({
      title: '已接受挑战',
      icon: 'success'
    });
    setTimeout(() => {
      wx.reLaunch({
        url: '/pages/home/home'
      });
    }, 250);
  },

  onCancelChallenge() {
    const result = challengeEngine.cancelChallenge();
    if (!result.ok) {
      wx.showToast({
        title: '挑战已开始，不能取消',
        icon: 'none'
      });
      return;
    }
    wx.showToast({
      title: '挑战已取消',
      icon: 'none'
    });
    this.refreshChallengeState();
  },

  onLaterDealInvite() {
    wx.reLaunch({
      url: '/pages/home/home'
    });
  },

  getCurrentShareChallenge() {
    if (this.data.activeSummary && this.data.activeSummary.id) {
      return this.data.activeSummary;
    }
    if (this.data.pendingInviteSummary && this.data.pendingInviteSummary.id) {
      return this.data.pendingInviteSummary;
    }
    return null;
  },

  getSharePayload() {
    const summary = this.getCurrentShareChallenge();
    if (!summary) {
      return null;
    }
    const title = `${summary.name}｜邀请你加入睡眠挑战`;
    const path = `/pages/home/home?inviteChallengeId=${summary.id}`;
    return { title, path };
  },

  onShareAppMessage() {
    const payload = this.getSharePayload();
    if (!payload) {
      return {
        title: 'SleepRank 睡眠挑战',
        path: '/pages/home/home'
      };
    }
    return payload;
  },

  onShareTimeline() {
    const payload = this.getSharePayload();
    if (!payload) {
      return {
        title: 'SleepRank 睡眠挑战',
        query: ''
      };
    }
    const query = payload.path.split('?')[1] || '';
    return {
      title: payload.title,
      query
    };
  }
});
