const cloud = require('wx-server-sdk')
const cheerio = require('cheerio')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const TRENDING_TTL = 5 * 60 * 1000   // 5 分钟
const ENRICH_TTL = 60 * 60 * 1000    // 1 小时

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID
const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY

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

    const result = await client.TextTranslateBatch({
      Source: 'en',
      Target: 'zh',
      ProjectId: 0,
      SourceTextList: toTranslate,
    })

    let idx = 0
    return texts.map(t => {
      if (!t || !t.trim()) return t
      return result.TargetTextList[idx++] || t
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
  const cacheKey = `${owner}/${repo}`

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
  const since = event.since || 'daily'
  const language = event.language || ''
  const cacheKey = `${since}-${language || 'all'}`

  // 1. 读 trending_cache
  try {
    const doc = await db.collection('trending_cache').doc(cacheKey).get()
    if (doc.data && doc.data.expireAt > Date.now()) {
      console.log(`缓存命中: ${cacheKey}`)
      return doc.data.payload
    }
  } catch (_) {
    // 文档不存在，继续爬取
  }

  // 2. 爬取 GitHub Trending
  const langPath = language ? `/${language}` : ''
  const url = `https://github.com/trending${langPath}?since=${since}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })

  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)

  const html = await response.text()
  const $ = cheerio.load(html)
  const repos = []

  // 3. 解析 HTML（与 server.js:102-154 一致）
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
  const descriptions = repos.map(r => r.description)
  const translated = await translateBatch(descriptions)
  repos.forEach((r, i) => { r.description = translated[i] })

  // 5. 并发补充 GitHub API 数据
  const enriched = await Promise.allSettled(repos.map(r => enrichRepo(r.owner, r.repo)))
  repos.forEach((r, i) => {
    const result = enriched[i]
    if (result.status === 'fulfilled' && result.value) {
      Object.assign(r, result.value)
    }
  })

  // 6. 写 trending_cache
  const payload = { repos, since, language, updatedAt: new Date().toISOString() }
  await db.collection('trending_cache').doc(cacheKey).set({
    data: { payload, expireAt: Date.now() + TRENDING_TTL },
  })

  return payload
}
