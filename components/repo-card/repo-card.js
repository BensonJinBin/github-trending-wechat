const { formatStarsAdded, timeAgo } = require('../../utils/format')

Component({
  properties: {
    repo: { type: Object, value: {} },
    since: { type: String, value: 'daily' },
  },

  data: {
    starsAddedLabel: null,
    pushedLabel: null,
  },

  observers: {
    'repo, since': function (repo, since) {
      this.setData({
        starsAddedLabel: formatStarsAdded(repo.starsAdded, since),
        pushedLabel: timeAgo(repo.pushedAt),
      })
    },
  },

  methods: {
    onTap() {
      const url = this.data.repo.url
      wx.setClipboardData({
        data: url,
        success: () => {
          wx.showToast({ title: '链接已复制', icon: 'success', duration: 2000 })
        },
      })
    },
  },
})
