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
  const storage = require(path.join(ROOT, 'store/storage.js'));
  const keys = require(path.join(ROOT, 'store/keys.js'));
  return {
    challengeEngine,
    judgeEngine,
    userEngine,
    sleepEngine,
    leaderboardEngine,
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
    participants: [{ userId: 'u_hao' }]
  });
  assert.strictEqual(createRes.ok, true);
  assert.strictEqual(createRes.challenge.status, 'PENDING');

  userEngine.setCurrentUserId('u_hao');
  const acceptRes = challengeEngine.acceptChallenge();
  assert.strictEqual(acceptRes.ok, true);
  assert.strictEqual(acceptRes.challenge.status, 'ONGOING');

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
    participants: []
  });
  assert.strictEqual(createRes.ok, true);
  assert.strictEqual(createRes.challenge.status, 'ONGOING');

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
    participants: [{ userId: 'u_hao' }]
  });
  assert.strictEqual(createRes.ok, true);

  userEngine.setCurrentUserId('u_hao');
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
    assert.strictEqual(ack2.state, 'COMPLETED');
  });

  userEngine.setCurrentUserId('u_mei');
  const createAfterCompleted = challengeEngine.createChallenge({
    name: '新挑战',
    targetDays: 3,
    participants: []
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
    participants: [{ userId: 'u_hao' }]
  });
  assert.strictEqual(createRes.ok, true);
  assert.ok(Array.isArray(createRes.challenge.participants));
  assert.ok(createRes.challenge.participants[0].hasOwnProperty('accepted'));

  userEngine.setCurrentUserId('u_hao');
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
    participants: [{ userId: 'u_hao' }]
  });
  assert.strictEqual(createRes.ok, true);
  userEngine.setCurrentUserId('u_hao');
  const acceptRes = challengeEngine.acceptChallenge();
  assert.strictEqual(acceptRes.ok, true);
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

  assert.strictEqual(challengeBoard.length, 2);
  const meInChallenge = challengeBoard.find((item) => item.userId === 'u_mei');
  const haoInChallenge = challengeBoard.find((item) => item.userId === 'u_hao');
  assert.ok(meInChallenge);
  assert.ok(haoInChallenge);
  assert.strictEqual(meInChallenge.successRate, 100);
  assert.strictEqual(haoInChallenge.successRate, 0);
  assert.ok(meInChallenge.totalScore > haoInChallenge.totalScore);

  assert.strictEqual(totalBoard.length, 5);
  const meInTotal = totalBoard.find((item) => item.userId === 'u_mei');
  assert.ok(meInTotal);
  assert.ok(meInTotal.totalScore >= meInChallenge.totalScore);
});

if (!process.exitCode) {
  console.log('\nAll tests passed.');
}
