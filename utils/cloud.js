/**
 * wx.cloud.callFunction 的 Promise 封装
 */
const callFunction = (name, data) => {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data,
      success: res => resolve(res.result),
      fail: err => reject(err),
    })
  })
}

module.exports = { callFunction }
