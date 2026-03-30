/**
 * 格式化工具函数（从 github-trending-zh/public/index.html 移植）
 */

const PERIOD_LABELS = {
  daily: '今日',
  weekly: '本周',
  monthly: '本月',
}

/**
 * 格式化新增 star 数，如 "+1,234 ⭐ 今日"
 * @param {string|number} n
 * @param {string} since
 * @returns {string|null}
 */
function formatStarsAdded(n, since) {
  if (!n || n === '0' || n === 0) return null
  const label = PERIOD_LABELS[since] || ''
  const num = typeof n === 'string' ? n : n.toLocaleString()
  return `+${num} ⭐ ${label}`
}

/**
 * 将 ISO 时间字符串转为相对时间描述
 * @param {string} isoStr
 * @returns {string|null}
 */
function timeAgo(isoStr) {
  if (!isoStr) return null
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return mins <= 1 ? '刚刚更新' : `${mins} 分钟前更新`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前更新`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨天更新'
  if (days < 30) return `${days} 天前更新`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前更新`
  return `${Math.floor(months / 12)} 年前更新`
}

module.exports = { formatStarsAdded, timeAgo }
