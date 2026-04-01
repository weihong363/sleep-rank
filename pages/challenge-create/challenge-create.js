const challengeEngine = require('../../engines/challenge-engine');
const userEngine = require('../../engines/user-engine');
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
    users: [{ id: '--', name: '--' }],
    userIndex: 0
  },

  onShow() {
    this.syncCurrentUser();
    this.loadDraftSelection();
    this.refreshChallengeState();
  },

  syncCurrentUser() {
    const users = userEngine.getUsers();
    const currentUserId = userEngine.getCurrentUserId();
    const userIndex = Math.max(users.findIndex((u) => u.id === currentUserId), 0);
    this.setData({
      users,
      userIndex
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

  onSwitchUser(e) {
    const nextIndex = Number(e.detail.value);
    const user = this.data.users[nextIndex];
    if (!user) {
      return;
    }
    userEngine.setCurrentUserId(user.id);
    this.setData({ userIndex: nextIndex });
    this.refreshChallengeState();
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

  goSelectTargets() {
    wx.navigateTo({
      url: '/pages/challenge-target-select/challenge-target-select'
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
      participants: this.data.selectedParticipants
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
      title: '挑战已发起，等待成员接受',
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
  }
});
