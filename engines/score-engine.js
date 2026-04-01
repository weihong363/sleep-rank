/**
 * Score Engine
 * - 负责基础评分规则，页面和业务流程不直接写评分公式。
 * - 目前仅 MVP 简化版，后续可替换为更复杂模型。
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function calculateSleepScore(durationMinutes, wakeCount) {
  const targetMinutes = 8 * 60;
  const durationPenalty = Math.min(
    (Math.abs(durationMinutes - targetMinutes) / targetMinutes) * 40,
    40
  );
  const wakePenalty = Math.min(wakeCount * 8, 30);
  return Math.round(clamp(100 - durationPenalty - wakePenalty, 0, 100));
}

function calculateDailyChallengeScore(sleepScore, checkInIndex) {
  const streakBonus = Math.min(checkInIndex * 1.5, 10);
  return Math.round(clamp(sleepScore + streakBonus, 0, 110));
}

module.exports = {
  calculateSleepScore,
  calculateDailyChallengeScore
};
