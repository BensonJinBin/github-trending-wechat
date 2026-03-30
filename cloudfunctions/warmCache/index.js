const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const LANGUAGES = [
  '', 'python', 'javascript', 'typescript', 'go', 'rust', 'java',
  'c++', 'c', 'c#', 'shell', 'swift', 'kotlin', 'ruby', 'php',
  'zig', 'lua', 'dart', 'elixir', 'scala', 'html', 'css',
]
const SINCE_LIST = ['daily', 'weekly', 'monthly']

exports.main = async (event) => {
  // 根据触发器名称或参数决定预热哪个语言
  // slot0 ~ slot21，每个 slot 对应一个语言
  let slot = 0
  if (event.Type === 'Timer') {
    const triggerName = event.TriggerName || ''
    const match = triggerName.match(/slot(\d+)/)
    if (match) slot = parseInt(match[1])
  } else if (event.slot != null) {
    slot = event.slot
  }

  if (slot >= LANGUAGES.length) {
    console.log(`[warmCache] slot ${slot} 超出语言列表范围，跳过`)
    return { slot, skipped: true }
  }

  const language = LANGUAGES[slot]
  const label = language || '全部语言'
  console.log(`[warmCache] slot ${slot}，预热语言: ${label}`)

  // 3 个时间维度串行调用，避免并发导致超时
  const results = []
  for (const since of SINCE_LIST) {
    try {
      await cloud.callFunction({
        name: 'getTrending',
        data: { since, language, forceRefresh: true },
      })
      results.push({ status: 'fulfilled' })
    } catch (e) {
      results.push({ status: 'rejected', reason: e })
    }
  }
  const settled = results

  const ok = settled.filter(r => r.status === 'fulfilled').length
  const fail = settled.filter(r => r.status === 'rejected').length
  const errors = settled
    .filter(r => r.status === 'rejected')
    .map(r => r.reason?.message || String(r.reason))

  console.log(`[warmCache] ${label}: ${ok} 成功 ${fail} 失败`, fail ? errors : '')
  return { slot, language: label, ok, fail }
}
