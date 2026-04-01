// miniprogram/mock/index.js
const mockChallenge = {
  id: 'mock_001',
  title: '早睡挑战第 1 期',
  target_sleep_time: '23:00',
  status: 'active',
  members: [
    { user_id: 'u1', nickname: '用户 A', score: 5 },
    { user_id: 'u2', nickname: '用户 B', score: 3 }
  ]
}

module.exports = {
  mockChallenge
}
