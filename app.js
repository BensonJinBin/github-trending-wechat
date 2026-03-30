App({
  onLaunch() {
    wx.cloud.init({
      env: 'toastmasters-9gbogzjz89b0e835',
      traceUser: true,
    })
  },
  globalData: {},
})
