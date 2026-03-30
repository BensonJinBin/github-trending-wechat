const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const LANGUAGES = [
  '', 'python', 'javascript', 'typescript', 'go', 'rust', 'java',
  'c++', 'c', 'c#', 'shell', 'swift', 'kotlin', 'ruby', 'php',
  'zig', 'lua', 'dart', 'elixir', 'scala', 'html', 'css',
]
const SINCE_LIST = ['daily', 'weekly', 'monthly']
const BATCH_COUNT = 4
const BATCH_DELAY_MS = 3000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 将语言列表均分为 BATCH_COUNT 批
function getBatch(batchIndex) {
  const size = Math.ceil(LANGUAGES.length / BATCH_COUNT)
  const start = batchIndex * size
  return LANGUAGES.slice(start, start + size)
}

exports.main = async (event) => {
  // 定时触发器通过 trigger name 区分批次
  // batch0 → 2:00, batch1 → 8:00, batch2 → 14:00, batch3 → 20:00
  let batchIndex = 0
  if (event.Type === 'Timer') {
    const triggerName = event.TriggerName || ''
    const match = triggerName.match(/batch(\d+)/)
    if (match) batchIndex = parseInt(match[1])
  } else if (event.batch != null) {
    batchIndex = event.batch
  }

  const languages = getBatch(batchIndex)
  const results = []
  console.log(`[warmCache] 批次 ${batchIndex}，预热 ${languages.length} 个语言: ${languages.map(l => l || '全部').join(', ')}`)

  for (let i = 0; i < languages.length; i++) {
    const language = languages[i]
    const label = language || '全部语言'

    const settled = await Promise.allSettled(
      SINCE_LIST.map(since =>
        cloud.callFunction({
          name: 'getTrending',
          data: { since, language, forceRefresh: true },
        })
      )
    )

    const ok = settled.filter(r => r.status === 'fulfilled').length
    const fail = settled.filter(r => r.status === 'rejected').length
    console.log(`[warmCache] ${label}: ${ok} 成功 ${fail} 失败`)
    results.push({ language: label, ok, fail })

    if (i < languages.length - 1) {
      await sleep(BATCH_DELAY_MS)
    }
  }

  console.log(`[warmCache] 批次 ${batchIndex} 完成`, JSON.stringify(results))
  return { batch: batchIndex, results }
}
