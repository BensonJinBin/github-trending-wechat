/**
 * 存档：去过 / 想去 / 城市 / 署名，全部在本机 wx.storage。
 *
 * v2 结构（日期都是 'YYYY-MM-DD'，从 v1 迁过来的没有日期，记 ''）：
 *   lit    { 省id: 首次点亮日期 }        —— 年度统计靠这个日期
 *   want   { 省id: 加入想去的日期 }      —— 已经去过的也留着，用来算「目标完成了几个」
 *   cities { 省id: { 城市名: 日期 } }   —— 省没点亮时不该有城市，toggle 里保证
 *   nick   长图署名，可空
 *   style  上次选的分享图样式（poster.STYLES 的 key）
 *
 * v1 只存了点亮的 id 数组，读到就迁移一次，旧 key 留着不删 ——
 * 万一新版有问题回滚，老版本还能读到自己的数据。
 */

const storage = require('../../utils/storage')

const KEY_V1 = 'travel-map/v1'
const KEY = 'travel-map/v2'

/** 和 poster.STYLES 对齐。这里不 require poster，免得存档模块拖进整个绘图代码 */
const STYLE_KEYS = ['glow', 'stamps', 'paper']

/** 本身就是一座城市的省级单位：点亮省就等于点亮了这个城市，没有下钻。
 *  台湾不算 —— 它不是一座城，也没有城市数据 */
const METRO = { beijing: 1, tianjin: 1, shanghai: 1, chongqing: 1, xianggang: 1, aomen: 1 }

function today(d) {
  d = d || new Date()
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
}

function empty() {
  return { v: 2, lit: {}, want: {}, cities: {}, nick: '', style: 'glow' }
}

/**
 * 读存档。存档里可能有已经不存在的省 id、城市名（数据重新生成过），
 * 一律过滤掉，别让老数据把页面搞崩。
 *
 * @param byId    省 id → shape
 * @param cityMap cities.js
 */
function load(byId, cityMap) {
  const st = empty()
  const raw = storage.get(KEY)
  if (raw && typeof raw === 'object' && raw.v === 2) {
    Object.keys(raw.lit || {}).forEach((id) => { if (byId[id]) st.lit[id] = String(raw.lit[id] || '') })
    Object.keys(raw.want || {}).forEach((id) => { if (byId[id]) st.want[id] = String(raw.want[id] || '') })
    Object.keys(raw.cities || {}).forEach((id) => {
      const list = cityMap[id]
      // 从 v1 迁来的省日期是 ''，不能拿真假判断点没点亮
      if (!list || st.lit[id] === undefined) return
      const picked = {}
      Object.keys(raw.cities[id] || {}).forEach((c) => {
        if (list.indexOf(c) >= 0) picked[c] = String(raw.cities[id][c] || '')
      })
      if (Object.keys(picked).length) st.cities[id] = picked
    })
    st.nick = typeof raw.nick === 'string' ? raw.nick : ''
    // 样式表以后可能删掉某个样式，认不出的一律回默认
    if (STYLE_KEYS.indexOf(raw.style) >= 0) st.style = raw.style
    return st
  }
  const old = storage.get(KEY_V1)
  if (Array.isArray(old)) {
    old.forEach((id) => { if (byId[id]) st.lit[id] = '' })
    save(st)
  }
  return st
}

function save(st) {
  storage.set(KEY, st)
}

/** 深拷贝一份，撤销用。结构只有两层对象，JSON 够了 */
function snapshot(st) {
  return JSON.parse(JSON.stringify(st))
}

/** 城市数：下钻选中的城市 + 点亮的直辖市/港澳（它们自己就是一座城） */
function cityCount(st) {
  let n = 0
  Object.keys(st.cities).forEach((id) => { n += Object.keys(st.cities[id]).length })
  Object.keys(st.lit).forEach((id) => { if (METRO[id]) n++ })
  return n
}

/** 今年新点亮的省份数。迁移来的没有日期，不算 */
function litThisYear(st, year) {
  const y = String(year) + '-'
  return Object.keys(st.lit).filter((id) => st.lit[id].indexOf(y) === 0).length
}

module.exports = { KEY, KEY_V1, METRO, today, empty, load, save, snapshot, cityCount, litThisYear }
