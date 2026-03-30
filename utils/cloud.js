/**
 * 使用跨账号云环境的 callFunction 封装
 */
const callFunction = async (name, data) => {
  const app = getApp()
  await app.globalData.cloudReady
  const cloud = app.globalData.cloud
  return new Promise((resolve, reject) => {
    cloud.callFunction({
      name,
      data,
      success: res => resolve(res.result),
      fail: err => reject(err),
    })
  })
}

module.exports = { callFunction }
