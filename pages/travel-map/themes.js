/**
 * 按点亮省份数自动切换的配色。
 *
 * 不是让用户挑喜好 —— 颜色本身就是「你去过多少地方」的可视化，所以它不稀释
 * 品牌识别：版式、字体、地图全不变，只有色相在动，朋友圈里刷到还是认得出，
 * 但一眼能看出深浅。也没有任何文字说明，颜色变了用户自己会发现，那是个惊喜。
 *
 * 档位按 poster.js 的 PCT 曲线切，让分布落在对的地方：
 *   0–4   垫底 32%          第一次变色在第 5 个省，来得够快，不至于点半天没反应
 *   5–12  32%→76%           大多数人在这一档
 *   13–21 76%→95%
 *   22–33 95%→99.8%
 *   34    满贯
 *
 * 每档必须是**整套**配色 —— 陆地底色、描边、环境光、外发光一起走，
 * 只换主色会出现金色省份配蓝色光晕。避开绿色：小程序码是绿的，撞色。
 *
 * ⚠️ 页面（wxss）那边有一份对应的主题类 `.t1`…`.t5`，改这里记得同步过去。
 *    canvas 的颜色在 JS、页面的颜色在 wxss，没法共用一份，只能靠 key 对齐。
 */

/** void 和 ink 五档都一样：底永远是纯黑，正文永远是纯白 */
const THEMES = [
  {
    key: 't1',
    min: 0,
    name: '靛蓝',
    lit: '#2B6BFF', litHi: '#6C9BFF',
    dim: '#12204A', dimLine: '#2C4079',
    ink2: '#8A99BC', ink3: '#4A5673',
    edge: '#141C33', sea: '#63769F',
    ambient: '22,44,116',
  },
  {
    key: 't2',
    min: 5,
    name: '青',
    lit: '#00C4B4', litHi: '#5FE6D9',
    dim: '#0D3340', dimLine: '#1E5E63',
    ink2: '#7FA6AE', ink3: '#44636B',
    edge: '#10262D', sea: '#5B8891',
    ambient: '8,78,84',
  },
  {
    key: 't3',
    min: 13,
    name: '琥珀',
    lit: '#FFB020', litHi: '#FFD070',
    dim: '#3A2A12', dimLine: '#6B5222',
    ink2: '#B8A183', ink3: '#6E6047',
    edge: '#2A2013', sea: '#9A8A6A',
    ambient: '104,68,12',
  },
  {
    key: 't4',
    min: 22,
    name: '珊瑚',
    lit: '#FF5A4E', litHi: '#FF9187',
    dim: '#3D1B1C', dimLine: '#6E3234',
    ink2: '#C0908E', ink3: '#74504F',
    edge: '#2B1516', sea: '#A0757A',
    ambient: '112,28,26',
  },
  {
    key: 't5',
    min: 34,
    name: '满贯',
    lit: '#A855F7', litHi: '#D8B4FE',
    dim: '#2A1745', dimLine: '#4C2E73',
    ink2: '#A995C4', ink3: '#665578',
    edge: '#1F1533', sea: '#8A76A6',
    ambient: '72,32,124',
  },
]

/** 点亮 n 个省对应哪一档。倒着找，第一个够得着的就是 */
function tierFor(n) {
  for (let i = THEMES.length - 1; i >= 0; i--) {
    if (n >= THEMES[i].min) return THEMES[i]
  }
  return THEMES[0]
}

module.exports = { THEMES, tierFor }
