const challengeEngine = require('../../engines/challenge-engine');
const sleepEngine = require('../../engines/sleep-engine');
const userEngine = require('../../engines/user-engine');
const pointEngine = require('../../engines/point-engine');

const JUDGE_STATUS_TEXT_MAP = {
  PASS: '达标',
  FAIL: '未达标'
};

const FAIL_TYPE_TEXT_MAP = {
  FAIL_TIMEOUT: '超时未按时入睡',
  FAIL_MISS: '当天漏打卡',
  FAIL_EARLY_ACTIVE: '打卡后过早活跃',
  FAIL_INTERRUPT: '醒来次数过多',
  FAIL_EARLY_WAKE: '睡眠时长不足',
  FAIL_LONG_WAKE: '单次清醒过长'
};

const POINT_REASON_TEXT_MAP = {
  CHALLENGE_COMPLETED: '挑战完成奖励',
  CHALLENGE_FAILED: '挑战失败扣分',
  PASS_STREAK_BONUS: '连续达标奖励'
};

function toJudgeStatusText(status) {
  return JUDGE_STATUS_TEXT_MAP[status] || '--';
}

function toFailTypeText(failType) {
  if (!failType) {
    return '--';
  }
  return FAIL_TYPE_TEXT_MAP[failType] || failType;
}

function buildMonthCalendar(results) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const resultMap = {};
  (results || []).forEach((item) => {
    resultMap[item.dateKey] = item;
  });
  const cells = [];
  for (let i = 0; i < startWeekday; i += 1) {
    cells.push({ key: `empty_${i}`, dayText: '', statusText: '', toneClass: 'calendar-empty' });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const daily = resultMap[dateKey];
    const statusText = daily
      ? (daily.status === 'PASS' ? '达标' : '失败')
      : '--';
    const toneClass = !daily
      ? 'calendar-pending'
      : daily.status === 'PASS'
        ? 'calendar-pass'
        : 'calendar-fail';
    cells.push({
      key: dateKey,
      dayText: String(day),
      statusText,
      toneClass
    });
  }
  return cells;
}

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
    todayJudgeStatus: '--',
    todayFailType: '--',
    todayJudgeMessage: '--',
    currentUserName: '--',
    checkInHistory: [],
    challengeHistory: [],
    pointBalance: 0,
    pointLogs: [],
    calendarCells: [],
    historyExpanded: false
  },

  onShow() {
    challengeEngine.refreshFromCloudForCurrentUser().finally(() => {
      this.refreshPage();
    });
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
        judgeStatus: toJudgeStatusText(item.dailyJudgeResult.status),
        failType: toFailTypeText(item.dailyJudgeResult.failType),
        toneClass: `history-tone-${index % 4}`
      }));
    const userTotalScore = userCheckIns.reduce((sum, item) => sum + item.dailyScore, 0);
    const userStats = challengeEngine.getUserStats(currentUserId);
    const pointAccount = pointEngine.getPointAccount(currentUserId);
    const pointLogs = pointEngine.getPointLogs(currentUserId).slice(0, 5);
    const todayJudgeResult = challengeEngine.getTodayChallengeResult(challenge, {
      hasActiveSleepSession: Boolean(sleepSession && sleepSession.isSleeping)
    });
    const myDailyResults = challenge && Array.isArray(challenge.dailyResults)
      ? challenge.dailyResults.filter((item) => item.userId === currentUserId)
      : [];
    const challengeHistory = challengeEngine.getCurrentUserChallengeHistory()
      .map((item) => ({
        id: item.id,
        name: item.name,
        statusText: item.status === challengeEngine.CHALLENGE_STATUS.COMPLETED ? '已完成' : '已取消',
        periodText: `${item.targetDays} 天`,
        score: item.checkIns
          .filter((record) => record.userId === currentUserId)
          .reduce((sum, record) => sum + record.dailyScore, 0)
      }));

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
      todayJudgeStatus: todayJudgeResult
        ? toJudgeStatusText(todayJudgeResult.status)
        : '--',
      todayFailType: todayJudgeResult
        ? toFailTypeText(todayJudgeResult.failType)
        : '--',
      todayJudgeMessage: todayJudgeResult ? todayJudgeResult.message : '--',
      checkInHistory: history,
      challengeHistory,
      pointBalance: pointAccount.balance,
      pointLogs: pointLogs.map((item) => ({
        ...item,
        deltaText: item.delta > 0 ? `+${item.delta}` : `${item.delta}`,
        reasonText: POINT_REASON_TEXT_MAP[item.reason] || item.reason
      })),
      calendarCells: buildMonthCalendar(myDailyResults)
    });
  },

  toggleHistory() {
    this.setData({
      historyExpanded: !this.data.historyExpanded
    });
  }
});
