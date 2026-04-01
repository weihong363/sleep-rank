const challengeEngine = require('../../engines/challenge-engine');
const leaderboardEngine = require('../../engines/leaderboard-engine');

Page({
  data: {
    challengeName: '--',
    rankList: []
  },

  onShow() {
    const challenge = challengeEngine.getActiveChallenge();
    const rankList = leaderboardEngine.buildLeaderboard(challenge);

    this.setData({
      challengeName: challenge ? challenge.name : '尚未创建挑战',
      rankList
    });
  }
});
