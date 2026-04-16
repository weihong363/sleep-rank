const challengeEngine = require('../../engines/challenge-engine');
const leaderboardEngine = require('../../engines/leaderboard-engine');

Page({
  data: {
    challengeName: '--',
    challengeRankList: [],
    totalRankList: []
  },

  onShow() {
    challengeEngine.refreshFromCloudForCurrentUser().finally(() => {
      const challenge = challengeEngine.getActiveChallenge();
      const challengeRankList = leaderboardEngine.buildChallengeLeaderboard(challenge);
      const totalRankList = leaderboardEngine.buildUserTotalLeaderboard(challenge);

      this.setData({
        challengeName: challenge ? challenge.name : '尚未创建挑战',
        challengeRankList,
        totalRankList
      });
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
