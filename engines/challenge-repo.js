const storage = require('../store/storage');
const keys = require('../store/keys');

function getActiveChallenge() {
  return storage.get(keys.ACTIVE_CHALLENGE, null);
}

function saveActiveChallenge(challenge) {
  storage.set(keys.ACTIVE_CHALLENGE, challenge);
  return challenge;
}

function clearActiveChallenge() {
  storage.remove(keys.ACTIVE_CHALLENGE);
}

function getChallengeHistory() {
  return storage.get(keys.CHALLENGE_HISTORY, []);
}

function saveChallengeHistory(history) {
  storage.set(keys.CHALLENGE_HISTORY, history);
  return history;
}

function appendChallengeHistory(challenge) {
  if (!challenge || challenge.status !== 'COMPLETED') {
    return getChallengeHistory();
  }
  const history = getChallengeHistory();
  if (history.some((item) => item.id === challenge.id)) {
    return history;
  }
  const next = [challenge, ...history].slice(0, 5);
  return saveChallengeHistory(next);
}

module.exports = {
  getActiveChallenge,
  saveActiveChallenge,
  clearActiveChallenge,
  getChallengeHistory,
  saveChallengeHistory,
  appendChallengeHistory
};
