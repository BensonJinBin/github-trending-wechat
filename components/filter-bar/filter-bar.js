const { LANGUAGES } = require('../../utils/languages')

Component({
  properties: {
    since: { type: String, value: 'daily' },
    language: { type: String, value: '' },
  },

  data: {
    periods: [
      { value: 'daily', label: '今日' },
      { value: 'weekly', label: '本周' },
      { value: 'monthly', label: '本月' },
    ],
    languages: LANGUAGES,
    languageLabels: LANGUAGES.map(l => l.label),
    languageIndex: 0,
    currentLanguageLabel: LANGUAGES[0].label,
  },

  observers: {
    language: function (lang) {
      const idx = this.data.languages.findIndex(l => l.value === lang)
      const safeIdx = idx >= 0 ? idx : 0
      this.setData({
        languageIndex: safeIdx,
        currentLanguageLabel: this.data.languages[safeIdx].label,
      })
    },
  },

  methods: {
    onPeriodTap(e) {
      const value = e.currentTarget.dataset.value
      if (value === this.data.since) return
      this.triggerEvent('sinceChange', { since: value })
    },

    onLanguagePick(e) {
      const idx = parseInt(e.detail.value)
      const lang = this.data.languages[idx]
      if (lang.value === this.data.language) return
      this.setData({
        languageIndex: idx,
        currentLanguageLabel: lang.label,
      })
      this.triggerEvent('languageChange', { language: lang.value })
    },
  },
})
