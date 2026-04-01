const sleepEngine = require('../../engines/sleep-engine');
const challengeEngine = require('../../engines/challenge-engine');

Page({
  data: {
    isSleeping: false,
    isGlowing: false,
    labelTop: 'sleep',
    labelBottom: 'now',
    ripples: [],
    hasPendingInvite: false
  },

  glowTimer: null,
  rippleTimer: null,

  onShow() {
    // 页面恢复时与实际睡眠状态同步，避免文案与会话状态不一致
    const active = sleepEngine.getActiveSession();
    const isSleeping = Boolean(active && active.isSleeping);
    const pendingInvite = challengeEngine.getPendingInvitationForCurrentUser();
    this.setData({
      isSleeping,
      labelTop: isSleeping ? 'good' : 'sleep',
      labelBottom: isSleeping ? 'night' : 'now',
      hasPendingInvite: Boolean(pendingInvite)
    });
  },

  handleTap(e) {
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
    if (!challengeEngine.canCurrentUserSleep(challenge)) {
      const me = challengeEngine.getCurrentParticipant(challenge);
      const message = !me
        ? '请先创建或接受挑战'
        : challenge.status === challengeEngine.CHALLENGE_STATUS.COMPLETED
        ? '当前挑战已完成'
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
          wx.showToast({
            title: `我的记录已更新 +${checkInResult.checkIn.dailyScore}`,
            icon: 'none'
          });
        } else {
          wx.showToast({
            title: `score ${record.sleepScore}`,
            icon: 'none'
          });
        }
      }
    }

    this.setData({
      ripples: [...this.data.ripples, { id: rippleId, size, left, top }],
      isGlowing: true,
      isSleeping: nextSleeping,
      labelTop: nextSleeping ? 'good' : 'sleep',
      labelBottom: nextSleeping ? 'night' : 'now'
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

  onGoAcceptInvite() {
    wx.navigateTo({
      url: '/pages/challenge-create/challenge-create'
    });
  },

  goLeaderboard() {
    wx.navigateTo({
      url: '/pages/leaderboard/leaderboard'
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
