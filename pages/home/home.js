const sleepEngine = require('../../engines/sleep-engine');
const challengeEngine = require('../../engines/challenge-engine');

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
    hasPendingInvite: false
  },

  glowTimer: null,
  rippleTimer: null,

  getGreetingLabel() {
    const hour = new Date().getHours();
    const isNight = hour >= 18 || hour < 5;
    return {
      labelTop: 'good',
      labelBottom: isNight ? 'night' : 'morning'
    };
  },

  onShow() {
    // 页面恢复时与实际睡眠状态同步，避免文案与会话状态不一致
    const active = sleepEngine.getActiveSession();
    const isSleeping = Boolean(active && active.isSleeping);
    const pendingInvite = challengeEngine.getPendingInvitationForCurrentUser();
    const greeting = this.getGreetingLabel();
    this.setData({
      isSleeping,
      labelTop: greeting.labelTop,
      labelBottom: greeting.labelBottom,
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

    const greeting = this.getGreetingLabel();
    this.setData({
      ripples: [...this.data.ripples, { id: rippleId, size, left, top }],
      isGlowing: true,
      isSleeping: nextSleeping,
      labelTop: greeting.labelTop,
      labelBottom: greeting.labelBottom
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
