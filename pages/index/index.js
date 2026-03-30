const cloud = require('../../utils/cloud')
const storage = require('../../utils/storage')

Page({
  data: {
    repos: [],
    since: 'daily',
    language: '',
    loading: false,
    refreshing: false,
    error: null,
    updatedAt: '',
  },

  onLoad() {
    // 恢复上次筛选条件
    const saved = storage.get('filters')
    if (saved) {
      this.setData({
        since: saved.since || 'daily',
        language: saved.language || '',
      })
    }
    this.loadTrending()
  },

  onSinceChange(e) {
    this.setData({ since: e.detail.since })
    storage.set('filters', { since: e.detail.since, language: this.data.language })
    this.loadTrending()
  },

  onLanguageChange(e) {
    const language = e.detail.language
    this.setData({ language })
    storage.set('filters', { since: this.data.since, language })
    this._saveRecentLanguage(language)
    this.loadTrending()
  },

  async loadTrending() {
    this.setData({ loading: true, error: null })
    try {
      const result = await cloud.callFunction('getTrending', {
        since: this.data.since,
        language: this.data.language,
      })
      const t = new Date(result.updatedAt)
      const pad = n => String(n).padStart(2, '0')
      const timeStr = `${pad(t.getHours())}:${pad(t.getMinutes())}`
      this.setData({
        repos: result.repos,
        updatedAt: `更新于 ${timeStr}`,
        loading: false,
        refreshing: false,
      })
      this._prefetchRelated()
    } catch (err) {
      console.error('加载失败', err)
      this.setData({
        error: '加载失败，请重试',
        loading: false,
        refreshing: false,
      })
    }
  },

  _prefetchRelated() {
    const allSince = ['daily', 'weekly', 'monthly']
    const currentLang = this.data.language

    // 预热当前语言的其他两个时间维度
    allSince.filter(s => s !== this.data.since).forEach(since => {
      cloud.callFunction('getTrending', { since, language: currentLang }).catch(() => {})
    })

    // 预热最近使用语言的全部时间维度
    const recentLangs = (storage.get('recentLanguages') || []).filter(l => l !== currentLang)
    recentLangs.forEach(language => {
      allSince.forEach(since => {
        cloud.callFunction('getTrending', { since, language }).catch(() => {})
      })
    })
  },

  _saveRecentLanguage(lang) {
    if (!lang) return
    const MAX = 4
    const list = (storage.get('recentLanguages') || []).filter(l => l !== lang)
    list.unshift(lang)
    storage.set('recentLanguages', list.slice(0, MAX))
  },

  onRefresh() {
    this.setData({ refreshing: true })
    this.loadTrending()
  },

  onRetry() {
    this.loadTrending()
  },

  onShareAppMessage() {
    return {
      title: 'GitHub Trending — 今日热门项目',
      path: '/pages/index/index',
    }
  },
})
