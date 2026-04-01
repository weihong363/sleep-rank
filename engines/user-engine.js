const storage = require('../store/storage');
const keys = require('../store/keys');

/**
 * User Engine
 * - MVP 本地用户与群组数据
 * - 提供当前用户身份切换能力（用于模拟“被邀请人接受挑战”流程）
 */
const USERS = [
  { id: 'u_mei', name: '小美' },
  { id: 'u_hao', name: '小浩' },
  { id: 'u_nan', name: '小楠' },
  { id: 'u_chen', name: '小晨' },
  { id: 'u_leo', name: 'Leo' }
];

const GROUPS = [
  { id: 'g_early', name: '早睡俱乐部', memberIds: ['u_mei', 'u_hao', 'u_nan'] },
  { id: 'g_team', name: '晚安挑战群', memberIds: ['u_mei', 'u_chen', 'u_leo'] }
];

function getUsers() {
  return USERS;
}

function getGroups() {
  return GROUPS;
}

function getCurrentUserId() {
  const saved = storage.get(keys.CURRENT_USER_ID, null);
  return saved || USERS[0].id;
}

function setCurrentUserId(userId) {
  storage.set(keys.CURRENT_USER_ID, userId);
}

function getCurrentUser() {
  const id = getCurrentUserId();
  return USERS.find((u) => u.id === id) || USERS[0];
}

function getUserById(userId) {
  return USERS.find((u) => u.id === userId) || null;
}

module.exports = {
  getUsers,
  getGroups,
  getCurrentUser,
  getCurrentUserId,
  setCurrentUserId,
  getUserById
};
