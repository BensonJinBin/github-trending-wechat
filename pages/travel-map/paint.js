/**
 * 地图绘制 —— 屏幕预览和导出长图共用同一套
 *
 * 两处画的是同一张图，只是画布尺寸不同，所以逻辑必须只有一份，
 * 否则「屏幕上好看、导出来错位」这种问题永远修不完。
 */

const geo = require('./geo')

/** 数据 viewBox 是 0 0 1000 841.2，四周留边并在右下角腾出南海插图的位置 */
const VB = [-16, -16, 1092, 877]
const INSET = { x: 940, y: 612, w: 120 }

/** canvas 的 font 只写 sans-serif：小程序解析带空格的中文字体名不稳，
 *  而 iOS 的 sans-serif 就是苹方、Android 就是思源黑，正好是想要的 */
const FONT = 'sans-serif'

const C = {
  void: '#000000',
  lit: '#2B6BFF',
  litHi: '#6C9BFF',
  /* 未点亮陆地。不能太接近纯黑 —— 差得太少陆地就浮不起来，
     只点亮两三个省时整张图会读成一片空的 */
  dim: '#12204A',
  dimLine: '#2C4079',
  ink: '#FFFFFF',
  ink2: '#8A99BC',
  ink3: '#4A5673',
  edge: '#141C33',
  sea: '#63769F',
  /* 下面几个只有浅色样式（明信片）会设，深色时都是 null / false，走默认值 */
  labelOn: null,     // 点亮省份的省名
  labelOff: null,    // 未点亮省份的省名
  labelStroke: null, // 省名描边
  labelLead: null,   // 有引线的小省点亮后的省名（浅底上白字看不见，要换成主色）
  noHalo: false,     // 关掉点亮省份的光晕（浅底上光晕会把边缘晕糊）
}

const LAND_GLOW_DEFAULT = [[16, 0.05], [9, 0.08], [4, 0.10]]

/** 地图上塞不下名字的省份，用引线标到旁边的空白处 */
const LEAD = {
  beijing: { x: 676, y: 292 },
  tianjin: { x: 822, y: 352 },
  shanghai: { x: 918, y: 502 },
  xianggang: { x: 806, y: 774 },
  aomen: { x: 808, y: 802 },
}

const BIG = { xinjiang: 1, xizang: 1, neimenggu: 1, qinghai: 1, sichuan: 1, yunnan: 1, heilongjiang: 1, gansu: 1 }
const SMALL = { ningxia: 1, chongqing: 1, hainan: 1, taiwan: 1, beijing: 1, tianjin: 1, shanghai: 1, xianggang: 1, aomen: 1 }

function dist2(x, y, px, py) {
  const dx = x - px
  const dy = y - py
  return dx * dx + dy * dy
}

function fontSize(id) {
  return BIG[id] ? 26 : SMALL[id] ? 16 : 21
}

/** 陆地外发光：给整块陆地（含未点亮的）描一层弱光，把它和纯黑背景分开。
 *  纯黑 + #0A1330 的明度差太小，不加这层，只点亮两三个省时整张图会显得很空。
 *  width 设 0 即关闭。三层递减描边，和点亮省份的光晕同一套做法 */
const LAND_GLOW = { color: '#2B6BFF', steps: LAND_GLOW_DEFAULT }
/* 想去掉就把 steps 置成 []。开着更接近「点亮」的调子，也和修掉阴影泄漏之前
   真机上的观感一致 —— 那圈光本来是 bug 漏出来的，这里把它做成可控的 */

/** 有引线的省太小，套一层看不见的圆形命中区，手指才点得中。
 *  13 是 viewBox 单位，在 375pt 屏上只折合 4.5 CSS px，手指够不着，
 *  所以再给一个 9 CSS px 的下限（见 pickAt） */
const HIT_R = 13
const HIT_R_MIN_CSS = 9

/** '#2B6BFF' + 0.18 → 'rgba(43,107,255,0.18)'。
 *  canvas 的 fillStyle 用 8 位 hex 带透明度在小程序里不保险，老老实实拼 rgba */
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 把一批省的所有环拼进当前路径，一次 fill/stroke 搞定，比逐省快得多 */
function traceMany(ctx, shapes, keep) {
  ctx.beginPath()
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i]
    if (!keep(s)) continue
    const rings = s.rings
    for (let r = 0; r < rings.length; r++) {
      const p = rings[r]
      ctx.moveTo(p[0], p[1])
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1])
      ctx.closePath()
    }
  }
}

/**
 * 画整张地图。
 *
 * @param ctx    2d 上下文
 * @param shapes geo.prepare() 的结果
 * @param lit    已点亮省份 id 的 Set
 * @param inset  原始数据里的 inset（南海诸岛）
 * @param x,y,w  在当前坐标系里的落点与宽度，高度按 viewBox 比例走
 * @param marks  可选，一组「标记但没点亮」的省 id 的 Set（想去 / 好友去过）。
 *               画成虚线描边加一层淡底，和点亮的实心区分开
 */
function drawMap(ctx, shapes, lit, inset, x, y, w, marks) {
  const s = w / VB[2]
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.translate(-VB[0], -VB[1])
  ctx.lineJoin = 'round'
  // 不信任调用方的阴影状态：微信的 canvas 只清 shadowBlur 断不干净，
  // 漏进来会给整块陆地糊上一圈光
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.shadowColor = 'rgba(0,0,0,0)'

  const isOn = (p) => lit.has(p.id)
  const isOff = (p) => !lit.has(p.id)
  const always = () => true

  // 陆地外发光，垫在最底下
  if (LAND_GLOW.steps.length) {
    traceMany(ctx, shapes, always)
    ctx.strokeStyle = LAND_GLOW.color
    for (let i = 0; i < LAND_GLOW.steps.length; i++) {
      ctx.globalAlpha = LAND_GLOW.steps[i][1]
      ctx.lineWidth = LAND_GLOW.steps[i][0]
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // 未点亮
  traceMany(ctx, shapes, isOff)
  ctx.fillStyle = C.dim
  ctx.fill()
  ctx.strokeStyle = C.dimLine
  ctx.lineWidth = 1.1
  ctx.stroke()

  // 标记了但没点亮的：淡底 + 虚线。压在点亮层下面，邻省点亮时光晕盖得住它
  if (marks && marks.size) {
    traceMany(ctx, shapes, (p) => marks.has(p.id) && !lit.has(p.id))
    ctx.fillStyle = rgba(C.lit, 0.22)
    ctx.fill()
    // 个别老基础库没有 setLineDash，退化成实线描边，也认得出
    const dash = typeof ctx.setLineDash === 'function'
    if (dash) ctx.setLineDash([6, 4])
    ctx.strokeStyle = C.litHi
    ctx.lineWidth = 1.6
    ctx.stroke()
    if (dash) ctx.setLineDash([])
  }

  // 点亮省份：先三层递减描边做光晕（比 shadowBlur 跨端可控得多），再填色。
  // 光晕整体压在填色之前画，才不会糊到邻省的亮面上。
  traceMany(ctx, shapes, isOn)
  const halo = C.noHalo ? [] : [[10, 0.1], [6, 0.17], [3, 0.3]]
  ctx.strokeStyle = C.litHi
  for (let i = 0; i < halo.length; i++) {
    ctx.globalAlpha = halo[i][1]
    ctx.lineWidth = halo[i][0]
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = C.lit
  ctx.fill()
  ctx.strokeStyle = C.litHi
  ctx.lineWidth = 1.1
  ctx.stroke()

  // 引线
  ctx.lineWidth = 1
  for (let i = 0; i < shapes.length; i++) {
    const p = shapes[i]
    const L = LEAD[p.id]
    if (!L) continue
    ctx.strokeStyle = lit.has(p.id) ? C.litHi : C.ink3
    ctx.beginPath()
    ctx.moveTo(p.cx, p.cy)
    ctx.lineTo(L.x, L.y)
    ctx.stroke()
  }

  // 省名：描边打底再填字，压在深浅不一的底色上都读得出
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 2.5
  for (let i = 0; i < shapes.length; i++) {
    const p = shapes[i]
    const L = LEAD[p.id]
    const lx = L ? L.x : p.cx
    const ly = L ? L.y : p.cy
    ctx.font = '600 ' + fontSize(p.id) + 'px ' + FONT
    ctx.strokeStyle = C.labelStroke || 'rgba(0,0,0,.55)'
    ctx.strokeText(p.name, lx, ly)
    ctx.fillStyle = lit.has(p.id) ? (L && C.labelLead ? C.labelLead : C.labelOn || C.ink)
      : marks && marks.has(p.id) ? 'rgba(255,255,255,.78)' : C.labelOff || 'rgba(255,255,255,.40)'
    ctx.fillText(p.name, lx, ly)
  }

  // 南海诸岛插图：纬度 18°N 以南的环和十段线单独拎出来，
  // 否则为了塞下曾母暗沙，大陆会被压到只剩一半大
  const iv = inset.viewBox
  const is = INSET.w / iv[2]
  ctx.strokeStyle = C.dimLine
  ctx.lineWidth = 1.2
  roundRect(ctx, INSET.x, INSET.y, INSET.w, iv[3] * is, 4)
  ctx.stroke()

  ctx.save()
  ctx.translate(INSET.x, INSET.y)
  ctx.scale(is, is)
  ctx.beginPath()
  const insetRings = inset.rings
  for (let r = 0; r < insetRings.length; r++) {
    const p = insetRings[r]
    ctx.moveTo(p[0], p[1])
    for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1])
    ctx.closePath()
  }
  ctx.fillStyle = C.sea
  ctx.fill()
  ctx.strokeStyle = C.sea
  ctx.lineWidth = 2.6
  ctx.stroke()
  ctx.restore()

  ctx.font = '14px ' + FONT
  ctx.fillStyle = C.sea
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('南海诸岛', INSET.x + INSET.w / 2, INSET.y + iv[3] * is + 17)

  ctx.restore()
}

/**
 * 屏幕坐标（相对 canvas 左上角的 CSS px）→ 省份 id，点不中返回 null。
 * 先查小省的圆形命中区，再查多边形；否则香港澳门永远会被广东抢走。
 */
function pickAt(shapes, px, py, canvasW) {
  const s = canvasW / VB[2]
  const x = VB[0] + px / s
  const y = VB[1] + py / s

  // 小省的圆形命中区，两个落点都要测：省的质心，和引线末端的省名标签。
  // 这五个省的多边形只有几个像素，**标签才是用户看得见、会去点的东西**。
  // 只测质心的话：点「北京」会命中它底下的内蒙古，另外四个直接没反应。
  //
  // 取最近的那个而不是第一个命中的 —— 香港和澳门的质心只差 13.2 个单位，
  // 两个圆几乎完全重叠，先到先得会让澳门被香港整个吃掉。取最近的，
  // 边界正好落在两者的中垂线上，各分一半。
  const r = Math.max(HIT_R, HIT_R_MIN_CSS / s)
  let best = null
  let bestD = r * r
  for (let i = 0; i < shapes.length; i++) {
    const p = shapes[i]
    const L = LEAD[p.id]
    if (!L) continue
    const d = Math.min(dist2(x, y, p.cx, p.cy), dist2(x, y, L.x, L.y))
    if (d <= bestD) {
      bestD = d
      best = p.id
    }
  }
  if (best) return best

  // 外接矩形先挡掉绝大多数省，再交给 geo 的射线法。射线法只留 geo 一份，
  // 这里不再抄一遍 —— 两份同样的算法迟早走样
  for (let i = 0; i < shapes.length; i++) {
    const p = shapes[i]
    const b = p.bounds
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue
    if (geo.hitRings(p.rings, x, y)) return p.id
  }
  return null
}

/**
 * 换配色。C 和 LAND_GLOW 是模块级的可变对象，屏幕地图和导出长图都读它们，
 * 所以这里一改两边一起变 —— 这正是我们要的：不能出现「屏幕是蓝的、导出是金的」。
 *
 * 浅色样式（applyPaper）会改掉 void/ink 和几个省名颜色，这里**全部复位**，
 * 否则出完一张明信片，屏幕上的地图就变成米色的了。
 */
function applyTheme(t) {
  C.void = '#000000'
  C.ink = '#FFFFFF'
  C.labelOn = null
  C.labelOff = null
  C.labelStroke = null
  C.labelLead = null
  C.noHalo = false
  LAND_GLOW.steps = LAND_GLOW_DEFAULT
  C.lit = t.lit
  C.litHi = t.litHi
  C.dim = t.dim
  C.dimLine = t.dimLine
  C.ink2 = t.ink2
  C.ink3 = t.ink3
  C.edge = t.edge
  C.sea = t.sea
  LAND_GLOW.color = t.lit
}

/** 浅色明信片配色：米白纸、印章红。只给出图用，画完必须 applyTheme 复位 */
const PAPER = {
  void: '#F3EEE4', lit: '#C8442F', litHi: '#E0705C',
  dim: '#E6DDCC', dimLine: '#C7B89E',
  ink: '#2A2420', ink2: '#6E6255', ink3: '#A3967F', edge: '#D8CDB8', sea: '#A3967F',
  labelOn: '#FFFFFF', labelOff: 'rgba(60,48,36,.55)', labelStroke: 'rgba(0,0,0,0)', labelLead: '#C8442F',
  noHalo: true,
}

function applyPaper() {
  Object.keys(PAPER).forEach((k) => { C[k] = PAPER[k] })
  LAND_GLOW.steps = []
}

module.exports = { VB, INSET, FONT, C, LAND_GLOW, PAPER, applyTheme, applyPaper, rgba, LEAD, BIG, SMALL, fontSize, roundRect, drawMap, pickAt }
