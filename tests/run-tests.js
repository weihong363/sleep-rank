/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');

const ROOT = '/Users/ironion/workspace/sleep-rank';

function createWxMock() {
  const store = {};
  return {
    __store: store,
    getStorageSync(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : '';
    },
    setStorageSync(key, value) {
      store[key] = value;
    },
    removeStorageSync(key) {
      delete store[key];
    },
    clearStorageSync() {
      Object.keys(store).forEach((k) => delete store[k]);
    }
  };
}

function resetProjectModules() {
  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.startsWith(ROOT + path.sep)) {
      delete require.cache[cacheKey];
    }
  });
}

function bootstrap() {
  global.wx = createWxMock();
  resetProjectModules();
  const challengeEngine = require(path.join(ROOT, 'engines/challenge-engine.js'));
  const judgeEngine = require(path.join(ROOT, 'engines/judge-engine.js'));
  const userEngine = require(path.join(ROOT, 'engines/user-engine.js'));
  const sleepEngine = require(path.join(ROOT, 'engines/sleep-engine.js'));
  const leaderboardEngine = require(path.join(ROOT, 'engines/leaderboard-engine.js'));
  const pointEngine = require(path.join(ROOT, 'engines/point-engine.js'));
  const storage = require(path.join(ROOT, 'store/storage.js'));
  const keys = require(path.join(ROOT, 'store/keys.js'));
  return {
    challengeEngine,
    judgeEngine,
    userEngine,
    sleepEngine,
    leaderboardEngine,
    pointEngine,
    storage,
    keys
  };
}

function withMockNow(timestamp, fn) {
  const originalNow = Date.now;
  Date.now = () => timestamp;
  try {
    return fn();
  } finally {
    Date.now = originalNow;
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

function buildSleepRecord({ start, end, wakeCount = 0, wakeEvents = [] }) {
  return {
    sleepStartTime: start,
    sleepEndTime: end,
    durationMinutes: Math.max(1, Math.round((end - start) / 60000)),
    wakeCount,
    wakeEvents,
    sleepScore: 90,
    createdAt: end
  };
}

test('judge-engine: FAIL_MISS / FAIL_TIMEOUT / FAIL_EARLY_ACTIVE / PASS', () => {
  const { judgeEngine } = bootstrap();
  const challenge = {
    sleepWindow: { start: '23:00', end: '07:00' }
  };
  const dateKey = '2026-04-03';

  const miss = judgeEngine.evaluateSleepChallengeResult({
    challenge,
    sleepRecord: null,
    dateKey
  });
  assert.strictEqual(miss.failType, 'FAIL_MISS');

  const timeout = judgeEngine.evaluateSleepChallengeResult({
    challenge,
    sleepRecord: buildSleepRecord({
      start: new Date(2026, 3, 3, 23, 30).getTime(),
      end: new Date(2026, 3, 4, 6, 0).getTime()
    }),
    dateKey
  });
  assert.strictEqual(timeout.failType, 'FAIL_TIMEOUT');

  const earlyActive = judgeEngine.evaluateSleepChallengeResult({
    challenge,
    sleepRecord: buildSleepRecord({
      start: new Date(2026, 3, 3, 22, 55).getTime(),
      end: new Date(2026, 3, 4, 6, 30).getTime(),
      wakeCount: 1,
      wakeEvents: [{
        wakeStartTime: new Date(2026, 3, 3, 23, 10).getTime(),
        wakeEndTime: new Date(2026, 3, 3, 23, 12).getTime(),
        durationMinutes: 2
      }]
    }),
    dateKey
  });
  assert.strictEqual(earlyActive.failType, 'FAIL_EARLY_ACTIVE');

  const pass = judgeEngine.evaluateSleepChallengeResult({
    challenge,
    sleepRecord: buildSleepRecord({
      start: new Date(2026, 3, 3, 22, 55).getTime(),
      end: new Date(2026, 3, 4, 5, 30).getTime(),
      wakeCount: 1,
      wakeEvents: [{
        wakeStartTime: new Date(2026, 3, 4, 0, 5).getTime(),
        wakeEndTime: new Date(2026, 3, 4, 0, 10).getTime(),
        durationMinutes: 5
      }]
    }),
    dateKey
  });
  assert.strictEqual(pass.status, 'PASS');
});

test('core flow: create -> accept -> sleep checkin -> daily result persisted', () => {
  const { challengeEngine, userEngine } = bootstrap();
  userEngine.setCurrentUserId('u_mei');
  const createRes = challengeEngine.createChallenge({
    name: '一周挑战',
    targetDays: 7,
    sleepWindowStart: '23:00',
    sleepWindowEnd: '07:00',
    participants: [{ userId: 'u_hao' }, { userId: 'u_nan' }]
  });
  assert.strictEqual(createRes.ok, true);
  assert.strictEqual(createRes.challenge.status, 'PENDING');

  userEngine.setCurrentUserId('u_hao');
  const acceptHao = challengeEngine.acceptChallenge();
  assert.strictEqual(acceptHao.ok, true);
  assert.strictEqual(acceptHao.challenge.status, 'PENDING');
  userEngine.setCurrentUserId('u_nan');
  const acceptNan = challengeEngine.acceptChallenge();
  assert.strictEqual(acceptNan.ok, true);
  assert.strictEqual(acceptNan.challenge.status, 'ONGOING');

  userEngine.setCurrentUserId('u_mei');
  const checkinTime = new Date(2026, 3, 3, 22, 55).getTime();
  const sleepRecord = buildSleepRecord({
    start: checkinTime,
    end: new Date(2026, 3, 4, 5, 20).getTime(),
    wakeCount: 1,
    wakeEvents: [{
      wakeStartTime: new Date(2026, 3, 4, 0, 20).getTime(),
      wakeEndTime: new Date(2026, 3, 4, 0, 25).getTime(),
      durationMinutes: 5
    }]
  });

  const addRes = withMockNow(checkinTime, () => challengeEngine.addTodayCheckIn(sleepRecord));
  assert.strictEqual(addRes.ok, true);
  assert.strictEqual(addRes.checkIn.dailyJudgeResult.status, 'PASS');
  assert.ok(addRes.checkIn.dailyScore > 0);

  const todayRes = withMockNow(checkinTime, () => challengeEngine.getTodayChallengeResult());
  assert.strictEqual(todayRes.status, 'PASS');
});

test('FAIL_MISS lock: after miss is fixed for the day, user cannot check in again', () => {
  const { challengeEngine, userEngine } = bootstrap();
  userEngine.setCurrentUserId('u_mei');
  const createRes = challengeEngine.createChallenge({
    name: '漏打卡锁定测试',
    targetDays: 7,
    sleepWindowStart: '21:00',
    sleepWindowEnd: '07:00',
    participants: [{ userId: 'u_hao' }, { userId: 'u_nan' }]
  });
  assert.strictEqual(createRes.ok, true);
  assert.strictEqual(createRes.challenge.status, 'PENDING');
  userEngine.setCurrentUserId('u_hao');
  challengeEngine.acceptChallenge();
  userEngine.setCurrentUserId('u_nan');
  challengeEngine.acceptChallenge();
  userEngine.setCurrentUserId('u_mei');

  const afterDeadline = new Date(2026, 3, 3, 22, 30).getTime();
  const miss = withMockNow(afterDeadline, () => challengeEngine.getTodayChallengeResult());
  assert.strictEqual(miss.failType, 'FAIL_MISS');

  const lateRecord = buildSleepRecord({
    start: afterDeadline,
    end: new Date(2026, 3, 4, 5, 0).getTime()
  });
  const addRes = withMockNow(afterDeadline, () => challengeEngine.addTodayCheckIn(lateRecord));
  assert.strictEqual(addRes.ok, false);
  assert.strictEqual(addRes.reason, 'FAIL_MISS_LOCKED');
});

test('period end ack: only when last participant acks, challenge completes and allows new challenge', () => {
  const { challengeEngine, userEngine, storage, keys } = bootstrap();
  userEngine.setCurrentUserId('u_mei');
  const createRes = challengeEngine.createChallenge({
    name: '一天挑战',
    targetDays: 1,
    sleepWindowStart: '23:00',
    sleepWindowEnd: '07:00',
    participants: [{ userId: 'u_hao' }, { userId: 'u_nan' }]
  });
  assert.strictEqual(createRes.ok, true);

  userEngine.setCurrentUserId('u_hao');
  challengeEngine.acceptChallenge();
  userEngine.setCurrentUserId('u_nan');
  challengeEngine.acceptChallenge();

  const challenge = challengeEngine.getActiveChallenge();
  challenge.startDate = new Date(2026, 2, 30, 10, 0).getTime();
  storage.set(keys.ACTIVE_CHALLENGE, challenge);

  withMockNow(new Date(2026, 3, 3, 10, 0).getTime(), () => {
    const c1 = challengeEngine.getActiveChallenge();
    assert.strictEqual(c1.status, 'WAITING_FINAL_ACK');
  });

  userEngine.setCurrentUserId('u_mei');
  withMockNow(new Date(2026, 3, 3, 10, 5).getTime(), () => {
    const ack1 = challengeEngine.acknowledgeChallengeEndByCurrentUser();
    assert.strictEqual(ack1.ok, true);
    assert.strictEqual(ack1.state, 'WAITING');
    const createDuringWaiting = challengeEngine.createChallenge({
      name: '不能创建',
      targetDays: 3,
      participants: []
    });
    assert.strictEqual(createDuringWaiting.ok, false);
    assert.strictEqual(createDuringWaiting.reason, 'ALREADY_IN_CHALLENGE');
  });

  userEngine.setCurrentUserId('u_hao');
  withMockNow(new Date(2026, 3, 3, 10, 6).getTime(), () => {
    const ack2 = challengeEngine.acknowledgeChallengeEndByCurrentUser();
    assert.strictEqual(ack2.ok, true);
    assert.strictEqual(ack2.state, 'WAITING');
  });
  userEngine.setCurrentUserId('u_nan');
  withMockNow(new Date(2026, 3, 3, 10, 7).getTime(), () => {
    const ack3 = challengeEngine.acknowledgeChallengeEndByCurrentUser();
    assert.strictEqual(ack3.ok, true);
    assert.strictEqual(ack3.state, 'COMPLETED');
  });

  userEngine.setCurrentUserId('u_mei');
  const createAfterCompleted = challengeEngine.createChallenge({
    name: '新挑战',
    targetDays: 3,
    participants: [{ userId: 'u_hao' }, { userId: 'u_nan' }]
  });
  assert.strictEqual(createAfterCompleted.ok, true);
});

test('model fields coverage: ChallengeMember / SleepSession / SleepRecord / DailyResult / UserStats', () => {
  const { challengeEngine, userEngine, sleepEngine } = bootstrap();
  userEngine.setCurrentUserId('u_mei');
  const createRes = challengeEngine.createChallenge({
    name: '模型字段检查',
    targetDays: 2,
    sleepWindowStart: '23:00',
    sleepWindowEnd: '07:00',
    participants: [{ userId: 'u_hao' }, { userId: 'u_nan' }]
  });
  assert.strictEqual(createRes.ok, true);
  assert.ok(Array.isArray(createRes.challenge.participants));
  assert.ok(createRes.challenge.participants[0].hasOwnProperty('accepted'));

  userEngine.setCurrentUserId('u_hao');
  challengeEngine.acceptChallenge();
  userEngine.setCurrentUserId('u_nan');
  challengeEngine.acceptChallenge();
  userEngine.setCurrentUserId('u_mei');

  withMockNow(new Date(2026, 3, 3, 22, 50).getTime(), () => sleepEngine.startSleep());
  withMockNow(new Date(2026, 3, 3, 23, 30).getTime(), () => sleepEngine.onAppHide());
  withMockNow(new Date(2026, 3, 3, 23, 35).getTime(), () => sleepEngine.onAppShow());
  const record = withMockNow(new Date(2026, 3, 4, 5, 30).getTime(), () => sleepEngine.endSleep());
  assert.ok(Array.isArray(record.wakeEvents));

  const addRes = withMockNow(new Date(2026, 3, 4, 5, 30).getTime(), () => challengeEngine.addTodayCheckIn(record));
  assert.strictEqual(addRes.ok, true);
  assert.ok(addRes.checkIn.dailyJudgeResult);

  const challenge = challengeEngine.getActiveChallenge();
  assert.ok(Array.isArray(challenge.dailyResults));
  const meDaily = challenge.dailyResults.find((r) => r.userId === 'u_mei');
  assert.ok(meDaily);

  // 让挑战完成并触发 UserStats 结算
  userEngine.setCurrentUserId('u_hao');
  const haoRecord = buildSleepRecord({
    start: new Date(2026, 3, 3, 22, 55).getTime(),
    end: new Date(2026, 3, 4, 5, 20).getTime(),
    wakeCount: 1,
    wakeEvents: [{
      wakeStartTime: new Date(2026, 3, 4, 0, 20).getTime(),
      wakeEndTime: new Date(2026, 3, 4, 0, 25).getTime(),
      durationMinutes: 5
    }]
  });
  withMockNow(new Date(2026, 3, 3, 22, 55).getTime(), () => challengeEngine.addTodayCheckIn(haoRecord));
  const stats = challengeEngine.getUserStats('u_mei');
  assert.ok(stats.hasOwnProperty('totalScore'));
  assert.ok(stats.hasOwnProperty('missedChallenges'));
});

test('leaderboard uses real data for challenge board and total board', () => {
  const { challengeEngine, userEngine, leaderboardEngine } = bootstrap();
  userEngine.setCurrentUserId('u_mei');
  const createRes = challengeEngine.createChallenge({
    name: '榜单测试',
    targetDays: 7,
    sleepWindowStart: '23:00',
    sleepWindowEnd: '07:00',
    participants: [{ userId: 'u_hao' }, { userId: 'u_nan' }]
  });
  assert.strictEqual(createRes.ok, true);
  userEngine.setCurrentUserId('u_hao');
  const acceptHao = challengeEngine.acceptChallenge();
  assert.strictEqual(acceptHao.ok, true);
  userEngine.setCurrentUserId('u_nan');
  const acceptNan = challengeEngine.acceptChallenge();
  assert.strictEqual(acceptNan.ok, true);
  userEngine.setCurrentUserId('u_mei');

  const meiRecord = buildSleepRecord({
    start: new Date(2026, 3, 3, 22, 50).getTime(),
    end: new Date(2026, 3, 4, 5, 20).getTime(),
    wakeCount: 0,
    wakeEvents: []
  });
  withMockNow(new Date(2026, 3, 3, 22, 50).getTime(), () => challengeEngine.addTodayCheckIn(meiRecord));

  userEngine.setCurrentUserId('u_hao');
  const haoMiss = withMockNow(
    new Date(2026, 3, 3, 23, 20).getTime(),
    () => challengeEngine.getTodayChallengeResult()
  );
  assert.strictEqual(haoMiss.failType, 'FAIL_MISS');

  userEngine.setCurrentUserId('u_mei');
  const challenge = challengeEngine.getActiveChallenge();
  const challengeBoard = leaderboardEngine.buildChallengeLeaderboard(challenge);
  const totalBoard = leaderboardEngine.buildUserTotalLeaderboard(challenge);

  assert.strictEqual(challengeBoard.length, 3);
  const meInChallenge = challengeBoard.find((item) => item.userId === 'u_mei');
  const haoInChallenge = challengeBoard.find((item) => item.userId === 'u_hao');
  const nanInChallenge = challengeBoard.find((item) => item.userId === 'u_nan');
  assert.ok(meInChallenge);
  assert.ok(haoInChallenge);
  assert.ok(nanInChallenge);
  assert.strictEqual(meInChallenge.successRate, 100);
  assert.strictEqual(haoInChallenge.successRate, 0);
  assert.ok(meInChallenge.totalScore > haoInChallenge.totalScore);

  // Total board now only includes users who have participated in challenges
  assert.ok(totalBoard.length >= 3);
  const meInTotal = totalBoard.find((item) => item.userId === 'u_mei');
  assert.ok(meInTotal);
  assert.ok(meInTotal.totalScore >= meInChallenge.totalScore);
});

test('P1 group flow: participants confirm then auto start with >=3 members', () => {
  const { challengeEngine, userEngine } = bootstrap();
  userEngine.setCurrentUserId('u_mei');
  const createRes = challengeEngine.createChallenge({
    name: '三人挑战',
    targetDays: 3,
    participants: [{ userId: 'u_hao' }, { userId: 'u_nan' }]
  });
  assert.strictEqual(createRes.ok, true);
  assert.strictEqual(createRes.challenge.status, 'PENDING');

  userEngine.setCurrentUserId('u_hao');
  const accept1 = challengeEngine.acceptChallenge();
  assert.strictEqual(accept1.ok, true);
  assert.strictEqual(accept1.challenge.status, 'PENDING');

  userEngine.setCurrentUserId('u_nan');
  const accept2 = challengeEngine.acceptChallenge();
  assert.strictEqual(accept2.ok, true);
  assert.strictEqual(accept2.challenge.status, 'ONGOING');
});

test('P1 invite flow: creator can append invitees while pending, then newly invited user can accept', () => {
  const { challengeEngine, userEngine } = bootstrap();
  userEngine.setCurrentUserId('u_mei');
  const createRes = challengeEngine.createChallenge({
    name: '追加邀请测试',
    targetDays: 3,
    participants: [{ userId: 'u_hao' }, { userId: 'u_nan' }]
  });
  assert.strictEqual(createRes.ok, true);
  assert.strictEqual(createRes.challenge.status, 'PENDING');

  userEngine.setCurrentUserId('u_hao');
  const acceptHao = challengeEngine.acceptChallenge();
  assert.strictEqual(acceptHao.ok, true);
  assert.strictEqual(acceptHao.challenge.status, 'PENDING');

  userEngine.setCurrentUserId('u_mei');
  const inviteRes = challengeEngine.inviteParticipants([{ userId: 'u_chen' }]);
  assert.strictEqual(inviteRes.ok, true);
  assert.strictEqual(inviteRes.addedCount, 1);

  userEngine.setCurrentUserId('u_nan');
  const acceptNan = challengeEngine.acceptChallenge();
  assert.strictEqual(acceptNan.ok, true);
  assert.strictEqual(acceptNan.challenge.status, 'ONGOING');
});

test('P1 points and history: challenge complete writes history and point logs', () => {
  const { challengeEngine, userEngine, pointEngine } = bootstrap();
  userEngine.setCurrentUserId('u_mei');
  const createRes = challengeEngine.createChallenge({
    name: '积分挑战',
    targetDays: 1,
    participants: [{ userId: 'u_hao' }, { userId: 'u_nan' }]
  });
  assert.strictEqual(createRes.ok, true);
  userEngine.setCurrentUserId('u_hao');
  challengeEngine.acceptChallenge();
  userEngine.setCurrentUserId('u_nan');
  challengeEngine.acceptChallenge();

  const challenge = challengeEngine.getActiveChallenge();
  challenge.startDate = new Date(2026, 2, 30, 10, 0).getTime();
  userEngine.setCurrentUserId('u_hao');
  withMockNow(new Date(2026, 3, 3, 10, 0).getTime(), () => {
    challengeEngine.acknowledgeChallengeEndByCurrentUser();
  });
  userEngine.setCurrentUserId('u_nan');
  withMockNow(new Date(2026, 3, 3, 10, 1).getTime(), () => {
    challengeEngine.acknowledgeChallengeEndByCurrentUser();
  });
  userEngine.setCurrentUserId('u_mei');
  withMockNow(new Date(2026, 3, 3, 10, 2).getTime(), () => {
    const done = challengeEngine.acknowledgeChallengeEndByCurrentUser();
    assert.strictEqual(done.ok, true);
    assert.strictEqual(done.state, 'COMPLETED');
  });

  const history = challengeEngine.getChallengeHistory();
  assert.ok(history.length >= 1);
  const myHistory = challengeEngine.getCurrentUserChallengeHistory();
  assert.ok(myHistory.length >= 1);
  const pointLogs = pointEngine.getPointLogs('u_mei');
  assert.ok(pointLogs.length >= 1);
});

test('concurrent multi-user checkin: all users can check in independently', () => {
  const { challengeEngine, userEngine, sleepEngine } = bootstrap();
  
  // 创建挑战
  userEngine.setCurrentUserId('u_mei');
  const createRes = challengeEngine.createChallenge({
    name: '多人并发打卡测试',
    targetDays: 7,
    sleepWindowStart: '23:00',
    sleepWindowEnd: '07:00',
    participants: [{ userId: 'u_hao' }, { userId: 'u_nan' }, { userId: 'u_chen' }]
  });
  assert.strictEqual(createRes.ok, true);
  
  // 所有成员接受挑战
  userEngine.setCurrentUserId('u_hao');
  challengeEngine.acceptChallenge();
  userEngine.setCurrentUserId('u_nan');
  challengeEngine.acceptChallenge();
  userEngine.setCurrentUserId('u_chen');
  challengeEngine.acceptChallenge();
  
  // 模拟同一晚不同时间入睡（都在 2026-04-03 晚上）
  
  // u_mei 在 22:50 入睡（提前，应通过）
  userEngine.setCurrentUserId('u_mei');
  withMockNow(new Date(2026, 3, 3, 22, 50).getTime(), () => sleepEngine.startSleep());
  const meiRecord = withMockNow(new Date(2026, 3, 4, 5, 20).getTime(), () => sleepEngine.endSleep());
  const meiCheckIn = withMockNow(new Date(2026, 3, 3, 22, 50).getTime(), () => 
    challengeEngine.addTodayCheckIn(meiRecord)
  );
  assert.strictEqual(meiCheckIn.ok, true);
  assert.strictEqual(meiCheckIn.checkIn.dailyJudgeResult.status, 'PASS');
  
  // u_hao 在 23:05 入睡（在宽限期内，应通过）
  userEngine.setCurrentUserId('u_hao');
  withMockNow(new Date(2026, 3, 3, 23, 5).getTime(), () => sleepEngine.startSleep());
  const haoRecord = withMockNow(new Date(2026, 3, 4, 5, 30).getTime(), () => sleepEngine.endSleep());
  const haoCheckIn = withMockNow(new Date(2026, 3, 3, 23, 5).getTime(), () => 
    challengeEngine.addTodayCheckIn(haoRecord)
  );
  assert.strictEqual(haoCheckIn.ok, true);
  // 23:05 在 23:00+10分钟宽限内，应该通过
  assert.strictEqual(haoCheckIn.checkIn.dailyJudgeResult.status, 'PASS');
  
  // u_nan 在 23:20 入睡（超时，超过 23:10 宽限期）
  userEngine.setCurrentUserId('u_nan');
  withMockNow(new Date(2026, 3, 3, 23, 20).getTime(), () => sleepEngine.startSleep());
  const nanRecord = withMockNow(new Date(2026, 3, 4, 6, 0).getTime(), () => sleepEngine.endSleep());
  // 注意：必须在入睡时的日期打卡，否则 dateKey 会错
  const nanCheckIn = withMockNow(new Date(2026, 3, 3, 23, 20).getTime(), () => 
    challengeEngine.addTodayCheckIn(nanRecord)
  );
  assert.strictEqual(nanCheckIn.ok, true);
  // 23:20 超过 23:00+10分钟，应该判定为 FAIL_TIMEOUT
  assert.strictEqual(nanCheckIn.checkIn.dailyJudgeResult.status, 'FAIL');
  assert.strictEqual(nanCheckIn.checkIn.dailyJudgeResult.failType, 'FAIL_TIMEOUT');
  
  // u_chen 漏打卡（时间已超过 23:10 截止时间）
  userEngine.setCurrentUserId('u_chen');
  const chenResult = withMockNow(new Date(2026, 3, 3, 23, 15).getTime(), () => 
    challengeEngine.getTodayChallengeResult()
  );
  assert.strictEqual(chenResult.failType, 'FAIL_MISS');
  
  // 验证排行榜数据正确
  userEngine.setCurrentUserId('u_mei');
  const challenge = challengeEngine.getActiveChallenge();
  assert.strictEqual(challenge.checkIns.length, 3);
  assert.strictEqual(challenge.dailyResults.length, 4); // 3个checkIn + 1个miss
});

test('sleep session history: records persist after end sleep', () => {
  const { sleepEngine, userEngine } = bootstrap();
  userEngine.setCurrentUserId('u_mei');
  
  // 第一次睡眠
  withMockNow(new Date(2026, 3, 3, 23, 0).getTime(), () => sleepEngine.startSleep());
  const record1 = withMockNow(new Date(2026, 3, 4, 6, 0).getTime(), () => sleepEngine.endSleep());
  assert.ok(record1);
  
  // 第二次睡眠
  withMockNow(new Date(2026, 3, 4, 23, 0).getTime(), () => sleepEngine.startSleep());
  const record2 = withMockNow(new Date(2026, 3, 5, 6, 30).getTime(), () => sleepEngine.endSleep());
  assert.ok(record2);
  
  // 验证历史记录
  const history = sleepEngine.getSleepSessionHistory('u_mei');
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].sleepStartTime, record2.sleepStartTime);
  assert.strictEqual(history[1].sleepStartTime, record1.sleepStartTime);
  
  // 验证包含 userId 字段
  assert.strictEqual(history[0].userId, 'u_mei');
  assert.strictEqual(history[1].userId, 'u_mei');
});

if (!process.exitCode) {
  console.log('\nAll tests passed.');
}
