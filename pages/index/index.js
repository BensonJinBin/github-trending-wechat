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
    this.setData({ language: e.detail.language })
    storage.set('filters', { since: this.data.since, language: e.detail.language })
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
    } catch (err) {
      console.error('加载失败', err)
      this.setData({
        error: '加载失败，请重试',
        loading: false,
        refreshing: false,
      })
    }
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
