const storage = require('../../store/storage');
const keys = require('../../store/keys');
const userEngine = require('../../engines/user-engine');

Page({
  data: {
    tab: 'USER',
    users: [],
    groups: [],
    selectedCount: 0
  },

  onShow() {
    const draft = storage.get(keys.CHALLENGE_DRAFT_PARTICIPANTS, { participants: [] });
    const selectedIds = new Set((draft.participants || []).map((p) => p.userId));
    const currentUserId = userEngine.getCurrentUserId();

    const users = userEngine.getUsers()
      .filter((u) => u.id !== currentUserId)
      .map((u) => ({
        ...u,
        checked: selectedIds.has(u.id)
      }));

    const groups = userEngine.getGroups().map((g) => {
      const allMembersSelected = g.memberIds
        .filter((id) => id !== currentUserId)
        .every((id) => selectedIds.has(id));
      return {
        ...g,
        checked: allMembersSelected
      };
    });

    this.setData({
      users,
      groups
    });
    this.refreshSelectedCount();
  },

  switchTab(e) {
    this.setData({
      tab: e.currentTarget.dataset.tab
    });
  },

  toggleUser(e) {
    const { id } = e.currentTarget.dataset;
    this.setData({
      users: this.data.users.map((u) => (
        u.id === id ? { ...u, checked: !u.checked } : u
      ))
    });
    this.refreshSelectedCount();
  },

  toggleGroup(e) {
    const { id } = e.currentTarget.dataset;
    this.setData({
      groups: this.data.groups.map((g) => (
        g.id === id ? { ...g, checked: !g.checked } : g
      ))
    });
    this.refreshSelectedCount();
  },

  refreshSelectedCount() {
    const selectedUserIds = this.collectSelectedUserIds();
    this.setData({
      selectedCount: selectedUserIds.length
    });
  },

  collectSelectedUserIds() {
    const userIds = new Set();
    this.data.users.filter((u) => u.checked).forEach((u) => userIds.add(u.id));
    const selectedGroupIds = new Set(
      this.data.groups.filter((g) => g.checked).map((g) => g.id)
    );
    this.data.groups.forEach((g) => {
      if (!selectedGroupIds.has(g.id)) {
        return;
      }
      g.memberIds.forEach((memberId) => {
        if (memberId !== userEngine.getCurrentUserId()) {
          userIds.add(memberId);
        }
      });
    });
    return Array.from(userIds);
  },

  confirmSelection() {
    const userIds = this.collectSelectedUserIds();
    const participants = userIds.map((userId) => ({ userId }));
    const userNames = userIds
      .map((id) => userEngine.getUserById(id))
      .filter(Boolean)
      .map((u) => u.name);

    storage.set(keys.CHALLENGE_DRAFT_PARTICIPANTS, {
      participants,
      userNames,
      participantPreviewText: userNames.length > 0 ? userNames.join('、') : '暂未选择'
    });

    wx.navigateBack();
  }
});
