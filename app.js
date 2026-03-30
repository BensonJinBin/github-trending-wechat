const cloud = new wx.cloud.Cloud({
  resourceAppid: 'wx4c4b54bc609bd79e',
  resourceEnv: 'toastmasters-9gbogzjz89b0e835',
})

App({
  onLaunch() {
    console.log('[cloud init] env:', 'toastmasters-9gbogzjz89b0e835')
    this.globalData.cloudReady = cloud.init().then(() => {
      console.log('[cloud init] done')
    })
  },
  globalData: {
    cloud,
  },
})
