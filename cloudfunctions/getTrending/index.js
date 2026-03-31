const cloud = require('wx-server-sdk')
const cheerio = require('cheerio')
const fetch = require('node-fetch')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const TRENDING_TTL = 24 * 60 * 60 * 1000  // 24 小时（每天预热一次，撑满全天）
const ENRICH_TTL = 24 * 60 * 60 * 1000   // 24 小时

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID
const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY

if (!GITHUB_TOKEN) console.warn('[getTrending] GITHUB_TOKEN 未配置，使用未认证 GitHub API（限 60 次/小时）')

// ——————————————————————————————————————————
// 翻译（腾讯翻译君）
// ——————————————————————————————————————————
async function translateBatch(texts) {
  const toTranslate = texts.filter(t => t && t.trim())
  if (!toTranslate.length) return texts
  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) return texts // 未配置则返回原文

  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs-tmt')
    const TmtClient = tencentcloud.tmt.v20180321.Client
    const client = new TmtClient({
      credential: { secretId: TENCENT_SECRET_ID, secretKey: TENCENT_SECRET_KEY },
      region: 'ap-guangzhou',
      profile: {},
    })

    // SDK 无 TextTranslateBatch，限速 5 QPS 顺序调用（免费版限制）
    const CHUNK = 5
    const results = []
    for (let i = 0; i < toTranslate.length; i += CHUNK) {
      const batch = toTranslate.slice(i, i + CHUNK).map(text =>
        client.TextTranslate({ SourceText: text, Source: 'auto', Target: 'zh', ProjectId: 0 })
          .then(v => ({ status: 'fulfilled', value: v }))
          .catch(e => ({ status: 'rejected', reason: e }))
      )
      results.push(...await Promise.all(batch))
    }

    const translatedMap = new Map()
    toTranslate.forEach((text, i) => {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value?.TargetText) {
        translatedMap.set(text, r.value.TargetText)
      }
    })

    return texts.map(t => {
      if (!t || !t.trim()) return t
      return translatedMap.get(t) || t
    })
  } catch (e) {
    console.error('翻译失败，返回原文', e.message)
    return texts
  }
}

// ——————————————————————————————————————————
// GitHub API 补充数据（topics / license / issues / pushedAt）
// ——————————————————————————————————————————
async function enrichRepo(owner, repo) {
  const cacheKey = `${owner}__${repo}`  // 用 __ 替代 /，云数据库 doc ID 不允许 /

  // 查 enrich_cache
  try {
    const doc = await db.collection('enrich_cache').doc(cacheKey).get()
    if (doc.data && doc.data.expireAt > Date.now()) {
      return doc.data.payload
    }
  } catch (_) {
    // 文档不存在，继续
  }

  try {
    const headers = { 'User-Agent': 'github-trending-app' }
    if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
    if (!res.ok) return null

    const json = await res.json()
    const payload = {
      topics: json.topics || [],
      license: json.license?.spdx_id || null,
      openIssues: json.open_issues_count ?? null,
      pushedAt: json.pushed_at || null,
    }

    // 写缓存
    await db.collection('enrich_cache').doc(cacheKey).set({
      data: { payload, expireAt: Date.now() + ENRICH_TTL },
    })

    return payload
  } catch (e) {
    console.error(`enrichRepo ${cacheKey} 失败`, e.message)
    return null
  }
}

// ——————————————————————————————————————————
// 主函数
// ——————————————————————————————————————————
exports.main = async (event) => {
  const VALID_SINCE = ['daily', 'weekly', 'monthly']
  const since = VALID_SINCE.includes(event.since) ? event.since : 'daily'
  const language = event.language || ''
  const forceRefresh = event.forceRefresh || false
  // encodeURIComponent 处理 c#、c++ 等含特殊字符的语言名，用于 DB key 和 URL
  const languageEncoded = language ? encodeURIComponent(language) : ''
  const cacheKey = `${since}-${languageEncoded || 'all'}`

  // 1. 读 trending_cache（forceRefresh 时跳过）
  if (!forceRefresh) {
    try {
      const doc = await db.collection('trending_cache').doc(cacheKey).get()
      if (doc.data && doc.data.expireAt > Date.now()) {
        console.log(`缓存命中: ${cacheKey}`)
        return doc.data.payload
      }
    } catch (_) {
      // 文档不存在，继续爬取
    }
  }

  // 2. 爬取 GitHub Trending
  const langPath = languageEncoded ? `/${languageEncoded}` : ''
  const url = `https://github.com/trending${langPath}?since=${since}`

  console.log(`[getTrending] 开始爬取: ${url}`)
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeout: 15000,
  })

  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)

  const html = await response.text()
  console.log(`[getTrending] 爬取完成，HTML 长度: ${html.length}`)
  const $ = cheerio.load(html)
  const repos = []

  // 3. 解析 HTML
  $('article.Box-row').each((i, el) => {
    const $el = $(el)

    const fullName = $el.find('h2 a').attr('href')?.replace(/^\//, '') || ''
    const [owner, repo] = fullName.split('/')

    const description = $el.find('p').first().text().trim() || ''
    const lang = $el.find('[itemprop="programmingLanguage"]').text().trim() || ''
    const langColor = $el.find('.repo-language-color').attr('style')?.match(/background-color:\s*(#\w+|[a-z]+)/)?.[1] || '#858585'

    const starsText = $el.find('a[href$="/stargazers"]').text().trim().replace(/,/g, '') || '0'
    const stars = parseInt(starsText) || 0

    const starsAddedText = $el.find('.float-sm-right').text().trim() || ''
    const starsAdded = starsAddedText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || '0'

    const forksText = $el.find('a[href$="/forks"]').text().trim().replace(/,/g, '') || '0'
    const forks = parseInt(forksText) || 0

    const contributors = []
    $el.find('a[data-hovercard-type="user"] img').each((_, img) => {
      contributors.push($(img).attr('src') || '')
    })

    if (owner && repo) {
      repos.push({
        rank: i + 1,
        owner,
        repo,
        fullName: `${owner}/${repo}`,
        url: `https://github.com/${owner}/${repo}`,
        description,
        language: lang,
        langColor,
        stars,
        starsFormatted: stars.toLocaleString(),
        starsAdded: parseInt(starsAdded).toLocaleString(),
        forks,
        forksFormatted: forks.toLocaleString(),
        contributors: contributors.slice(0, 5),
      })
    }
  })

  // 4. 批量翻译描述
  console.log(`[getTrending] 开始翻译 ${repos.length} 条描述`)
  const descriptions = repos.map(r => r.description)
  const translated = await translateBatch(descriptions)
  repos.forEach((r, i) => { r.description = translated[i] })
  console.log(`[getTrending] 翻译完成`)

  // 5. 并发补充 GitHub API 数据
  console.log(`[getTrending] 开始补充 GitHub API 数据`)
  const enriched = await Promise.allSettled(repos.map(r => enrichRepo(r.owner, r.repo)))
  repos.forEach((r, i) => {
    const result = enriched[i]
    if (result.status === 'fulfilled' && result.value) {
      Object.assign(r, result.value)
    }
  })

  // 6. 写 trending_cache
  const payload = { repos, since, language, updatedAt: new Date().toISOString() }
  try {
    await db.collection('trending_cache').doc(cacheKey).set({
      data: { payload, expireAt: Date.now() + TRENDING_TTL },
    })
  } catch (e) {
    console.error(`缓存写入失败: ${cacheKey}`, e.message)
  }

  return payload
}
