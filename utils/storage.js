/**
 * wx.Storage 同步封装
 */
const get = (key) => {
  try {
    return wx.getStorageSync(key) || null
  } catch (_) {
    return null
  }
}

const set = (key, value) => {
  try {
    wx.setStorageSync(key, value)
  } catch (_) {}
}

module.exports = { get, set }
