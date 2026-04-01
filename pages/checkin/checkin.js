const challengeEngine = require('../../engines/challenge-engine');
const sleepEngine = require('../../engines/sleep-engine');
const userEngine = require('../../engines/user-engine');

Page({
  data: {
    hasChallenge: false,
    challengeName: '--',
    isSleeping: false,
    sleepStartTimeText: '--',
    wakeCount: 0,
    latestRecord: null,
    todayChecked: false,
    targetDays: 0,
    checkedDays: 0,
    totalScore: 0,
    currentChallengeScore: 0,
    missedChallenges: 0,
    todayDailyScore: '--',
    todaySleepScore: '--',
    todayDurationMinutes: '--',
    todayWakeCount: '--',
    todayStatusText: '未开始',
    todaySleepStartText: '--',
    currentUserName: '--',
    checkInHistory: [],
    historyExpanded: false
  },

  onShow() {
    this.refreshPage();
  },

  refreshPage() {
    const challenge = challengeEngine.getActiveChallenge();
    const progress = challengeEngine.getProgress(challenge);
    const sleepSession = sleepEngine.getActiveSession();
    const latestRecord = sleepEngine.getLatestSleepRecord();
    const todayCheckIn = challengeEngine.getTodayCheckIn(challenge);
    const currentUser = userEngine.getCurrentUser();
    const currentUserId = currentUser.id;
    const userCheckIns = challenge
      ? challenge.checkIns.filter((item) => item.userId === currentUserId)
      : [];
    const history = [...userCheckIns]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((item, index) => ({
        id: item.id,
        index: userCheckIns.length - index,
        dateKey: item.dateKey,
        dailyScore: item.dailyScore,
        sleepScore: item.sleepRecord.sleepScore,
        durationMinutes: item.sleepRecord.durationMinutes,
        wakeCount: item.sleepRecord.wakeCount,
        toneClass: `history-tone-${index % 4}`
      }));
    const userTotalScore = userCheckIns.reduce((sum, item) => sum + item.dailyScore, 0);
    const userStats = challengeEngine.getUserStats(currentUserId);

    let todayStatusText = '未开始';
    if (todayCheckIn) {
      todayStatusText = '已完成';
    } else if (sleepSession && sleepSession.isSleeping) {
      todayStatusText = '睡眠中';
    }

    const recordForDisplay = todayCheckIn
      ? todayCheckIn.sleepRecord
      : (sleepSession || latestRecord || null);
    const sleepStartTimeText = recordForDisplay
      ? sleepEngine.formatDateTime(recordForDisplay.sleepStartTime)
      : '--';

    this.setData({
      hasChallenge: Boolean(challenge),
      currentUserName: currentUser.name,
      challengeName: challenge ? challenge.name : '--',
      isSleeping: Boolean(sleepSession && sleepSession.isSleeping),
      sleepStartTimeText,
      wakeCount: sleepSession ? sleepSession.wakeCount : 0,
      latestRecord,
      todayChecked: Boolean(todayCheckIn),
      targetDays: progress.targetDays,
      checkedDays: history.length,
      totalScore: userStats.totalScore,
      currentChallengeScore: userTotalScore,
      missedChallenges: userStats.missedChallenges,
      todayDailyScore: todayCheckIn ? todayCheckIn.dailyScore : '--',
      todaySleepScore: todayCheckIn ? todayCheckIn.sleepRecord.sleepScore : '--',
      todayDurationMinutes: todayCheckIn ? todayCheckIn.sleepRecord.durationMinutes : '--',
      todayWakeCount: todayCheckIn ? todayCheckIn.sleepRecord.wakeCount : '--',
      todayStatusText,
      todaySleepStartText: sleepStartTimeText,
      checkInHistory: history
    });
  },

  toggleHistory() {
    this.setData({
      historyExpanded: !this.data.historyExpanded
    });
  }
});
