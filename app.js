const cloud = new wx.cloud.Cloud({
  resourceAppid: 'wx4c4b54bc609bd79e',
  resourceEnv: 'toastmasters-9gbogzjz89b0e835',
})

App({
  /**
   * 云环境按需初始化，不在 onLaunch 里做。
   * 启动页是旅行地图，完全不用云；只有 GitHub Trending 页调云函数时才需要，
   * 冷启动白白去连一个跨账号环境不划算。
   */
  ensureCloud() {
    if (!this.globalData.cloudReady) {
      console.log('[cloud init] env:', 'toastmasters-9gbogzjz89b0e835')
      this.globalData.cloudReady = cloud.init().then(() => {
        console.log('[cloud init] done')
      })
    }
    return this.globalData.cloudReady
  },
  globalData: {
    cloud,
    cloudReady: null,
  },
})
