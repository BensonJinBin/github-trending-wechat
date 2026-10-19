/**
 * 计数板和长图共用的统计口径 —— 两边必须算出同一个数，所以只有这一份
 */

/** 常住人口（万人）。
 *  大陆 31 省取第七次全国人口普查公报（2020-11-01 零时）；
 *  港澳台取七普公报附带公布的同期数字。合计约 14.41 亿 */
const POP = {
  beijing: 2189, tianjin: 1387, hebei: 7461, shanxi: 3492, neimenggu: 2405,
  liaoning: 4259, jilin: 2407, heilongjiang: 3185,
  shanghai: 2487, jiangsu: 8475, zhejiang: 6457, anhui: 6103, fujian: 4154,
  jiangxi: 4519, shandong: 10153,
  henan: 9937, hubei: 5775, hunan: 6644,
  guangdong: 12601, guangxi: 5013, hainan: 1008,
  chongqing: 3205, sichuan: 8367, guizhou: 3856, yunnan: 4721, xizang: 365,
  shaanxi: 3953, gansu: 2502, qinghai: 592, ningxia: 720, xinjiang: 2585,
  taiwan: 2356, xianggang: 747, aomen: 68,
}
const TOTAL_POP = Object.keys(POP).reduce((s, k) => s + POP[k], 0)

/** 按钮分组：七大地理分区，台湾按官方划分归华东，港澳归华南 */
const REGIONS = [
  { name: '华北', ids: ['beijing', 'tianjin', 'hebei', 'shanxi', 'neimenggu'] },
  { name: '东北', ids: ['liaoning', 'jilin', 'heilongjiang'] },
  { name: '华东', ids: ['shanghai', 'jiangsu', 'zhejiang', 'anhui', 'fujian', 'jiangxi', 'shandong', 'taiwan'] },
  { name: '华中', ids: ['henan', 'hubei', 'hunan'] },
  { name: '华南', ids: ['guangdong', 'guangxi', 'hainan', 'xianggang', 'aomen'] },
  { name: '西南', ids: ['chongqing', 'sichuan', 'guizhou', 'yunnan', 'xizang'] },
  { name: '西北', ids: ['shaanxi', 'gansu', 'qinghai', 'ningxia', 'xinjiang'] },
]

/**
 * 面积覆盖率和人口覆盖率放在一起看才有意思：
 * 去过新疆西藏的人面积高、人口低；只在东部转的人反过来。
 * 少于 3 个省时样本太小，硬贴标签只会显得乱说，不给。
 *
 * 阈值按真实数据定：只走东部五个省（京沪苏浙粤），人口占比是面积的 5 倍；
 * 只走新藏青甘，面积是人口的 10 倍；东西各走一半（川渝云粤京陕）约 1.7 倍。
 * 所以 2 倍以内算均衡，免得「东西都去过」的人也被归成人口型。
 */
function persona(n, areaPct, popPct) {
  if (n < 3 || areaPct <= 0 || popPct <= 0) return ''
  const r = popPct / areaPct
  if (r >= 2) return '人口型旅行者 · 专往热闹的地方去'
  if (r <= 0.5) return '面积型旅行者 · 哪里辽阔去哪里'
  return '均衡型旅行者 · 热闹和辽阔都要'
}

/**
 * 一组省份的面积、人口覆盖率。
 * @param shapes  geo.prepare() 的结果（带 area）
 * @param has     id → boolean
 */
function coverage(shapes, has, totalArea) {
  let area = 0
  let pop = 0
  for (let i = 0; i < shapes.length; i++) {
    const p = shapes[i]
    if (!has(p.id)) continue
    area += p.area
    pop += POP[p.id] || 0
  }
  return {
    areaPct: ((area / totalArea) * 100).toFixed(1),
    popPct: ((pop / TOTAL_POP) * 100).toFixed(1),
  }
}

module.exports = { POP, TOTAL_POP, REGIONS, persona, coverage }
