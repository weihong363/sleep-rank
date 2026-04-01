/**
 * 日期工具，统一挑战和打卡所需的时间格式。
 */
function pad2(n) {
  return `${n}`.padStart(2, '0');
}

function formatDateKey(timestamp = Date.now()) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return '--';
  }
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

module.exports = {
  formatDateKey,
  formatDateTime
};
