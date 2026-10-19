/**
 * 云端同步 —— 占位，还没接。
 *
 * 打算：按 openid 在云数据库存一份 travel-map 存档，换手机、删了小程序重装都能找回。
 * 现在只在本机 wx.storage，这里两个函数都是空实现，调用方照常调用，
 * 以后接上云的时候页面不用改。
 *
 * 接的时候要想清楚的两件事：
 *  1. 合并规则：本机和云端都有数据时，省份取并集、日期取较早的那个，别直接覆盖。
 *  2. 云环境：app.js 现在借的是 tmUtils 账号的 toastmasters 环境，
 *     旅行地图的数据最好放本小程序自己的环境里。
 */

/** 把本机存档推上去。占位：直接成功 */
function push(/* state */) {
  return Promise.resolve(false)
}

/** 拉云端存档。占位：永远没有 */
function pull() {
  return Promise.resolve(null)
}

module.exports = { push, pull, enabled: false }
