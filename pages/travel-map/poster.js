/**
 * 分享图。三种样式 × 两种版式：
 *
 *   glow    夜光地图（默认）：一个大数字 + 地图 + 七大区进度条。9:16 和 4:5 都有
 *   stamps  集邮册：34 个省排成邮票墙，点亮的盖章、印日期。只有 9:16
 *   paper   明信片：和夜光同一套版式，米白纸、印章红。只有 9:16
 *
 * 图片发到朋友圈后点不了，所以底部必须给看到图的人一个钩子：
 * 一句「你去过几个省？」加一枚小程序码。
 *
 * 「超过全国 X% 的人」只在页面计数板上，图上不放 —— 那个数是编的，
 * 而且图上要的是一个主角数字，多一个百分比就多一个抢眼球的。
 */

const paint = require('./paint')
const themes = require('./themes')
const stats = require('./stats')

const FONT = paint.FONT
const C = paint.C

/** 白卡尺寸。实测微信朋友圈把长边压到 1080 左右，换算过来码宽约 220px，
 *  这个尺寸留足了识别余量；再小就有扫不出来的风险 */
const CODE_SIZE = 222

/** 4:5 图的码。朋友圈把 1350 的长边压到 1080，码约 144px，比长图压完的 125px 还大 */
const FEED_CODE = 180

/** 环境光：整张图的氛围底，一团雾。
 *  y/r 决定它铺多大，alpha 决定多浓；颜色跟着主题走（themes.js 的 ambient）。
 *  铺太小顶部标题和底部二维码会悬在死黑里 */
const AMBIENT = { y: 1000, r: 900, alpha: 0.46 }

/** 「超过全国 X% 的人」—— 按去过省份数的估算曲线，照抖音那个梗做的，不是统计数据。
 *  只给页面计数板用 */
const PCT = [0, 4, 12, 22, 32, 41, 49, 56, 62, 67, 72, 76, 79.5, 82.5, 85, 87, 89, 90.5, 92, 93,
  94, 94.8, 95.5, 96.1, 96.7, 97.2, 97.7, 98.1, 98.5, 98.9, 99.2, 99.4, 99.6, 99.8, 99.9]

const FORMATS = {
  story: { w: 1080, h: 1920 },
  feed: { w: 1080, h: 1350 },
}

/** 样式。feed 为 false 的样式只出 9:16 —— 邮票墙和明信片塞进 4:5 太挤 */
const STYLES = {
  glow: { name: '夜光', feed: true },
  stamps: { name: '集邮册', feed: false },
  paper: { name: '明信片', feed: false },
}

/**
 * 彻底关掉阴影。
 *
 * 只写 `shadowBlur = 0` 在浏览器里等于关闭，但微信的 canvas 不认 —— 之前设过的
 * shadowColor 会一直挂着，往后画的每一样东西都带上那圈蓝光（陆地、胶囊、省名、
 * 二维码全中）。必须把 color 也置成透明才真的断干净。
 *
 * 这个坑浏览器验证抓不到：浏览器是按规范来的。
 */
function clearShadow(ctx) {
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.shadowColor = 'rgba(0,0,0,0)'
}

/** 一行里混排不同字号，整体居中 */
function row(ctx, parts, cx, y) {
  let w = 0
  for (let i = 0; i < parts.length; i++) {
    ctx.font = parts[i].f
    w += ctx.measureText(parts[i].t).width
  }
  let x = cx - w / 2
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (let i = 0; i < parts.length; i++) {
    ctx.font = parts[i].f
    ctx.fillStyle = parts[i].c
    if (parts[i].glow) {
      // 跟着主题走。写死蓝色的话，13 省那档整张图是琥珀色，
      // 只有这个大数字顶着一圈蓝光
      ctx.shadowColor = paint.rgba(C.lit, 0.75)
      ctx.shadowBlur = parts[i].glow
    }
    ctx.fillText(parts[i].t, x, y)
    clearShadow(ctx)
    x += ctx.measureText(parts[i].t).width
  }
}

/** 小程序 canvas 没有 ctx.letterSpacing，标题的字距只能逐字画 */
function fillTracked(ctx, text, cx, y, tracking) {
  const chars = text.split('')
  let w = -tracking
  for (let i = 0; i < chars.length; i++) w += ctx.measureText(chars[i]).width + tracking
  let x = cx - w / 2
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y)
    x += ctx.measureText(chars[i]).width + tracking
  }
}

/** 标题。署名太长就缩字号，别让它顶出画面 */
function drawTitle(ctx, text, cx, y, o) {
  let s = o.size
  for (;;) {
    ctx.font = o.weight + ' ' + s + 'px ' + FONT
    let w = -o.tracking
    for (let i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + o.tracking
    if (w <= o.maxW || s <= 28) break
    s -= 2
  }
  ctx.fillStyle = o.color
  fillTracked(ctx, text, cx, y, o.tracking)
}

function titleText(nick, what) {
  return (nick ? nick + '的' : '我的') + what
}

function stampText(d) {
  return d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + d.getDate()).slice(-2)
}

/** 白卡的形状和亮度。
 *  码本身是圆的，用圆卡能在**不缩小码**的前提下少掉 21% 的白面积（πr² vs 边长²），
 *  这是压住它存在感最划算的一刀 —— 纯白压在纯黑上比点亮的省份还亮，扎眼的是白不是大。
 *  dim 再往上压一点整体亮度：白和绿一起变暗，两者的对比**比值不变**，只损失很小的绝对差。
 *  shape: 'circle' | 'rect'，dim: 0 = 纯白 */
const CARD = { shape: 'circle', dim: 0.06, pad: 8 }

/** 白底不反色：反色码微信在暗背景上识别率明显下降。
 *  浅色底上白卡反而不显，给一圈投影把它托起来 */
function drawCodeCard(ctx, img, x, y, size, shadow) {
  const r = size / 2
  ctx.save()
  ctx.beginPath()
  if (CARD.shape === 'circle') ctx.arc(x + r, y + r, r, 0, Math.PI * 2)
  else paint.roundRect(ctx, x, y, size, size, 16)
  if (shadow) {
    ctx.shadowColor = shadow
    ctx.shadowBlur = 24
    ctx.shadowOffsetY = 6
  }
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  clearShadow(ctx)
  // 裁进卡形，圆卡才能把源图的白色方角切掉
  ctx.clip()
  ctx.drawImage(img, x + CARD.pad, y + CARD.pad, size - CARD.pad * 2, size - CARD.pad * 2)
  if (CARD.dim > 0) {
    ctx.globalAlpha = CARD.dim
    ctx.fillStyle = C.dim
    ctx.fillRect(x, y, size, size)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

/**
 * 底部钩子：左码右字。没有码时整块退化成居中两行字，不留空框。
 * @param f { l1, l2, y: [L1 基线, L2 基线, L3 基线, 日期基线], shadow }
 * @param stamp 日期放进右侧文字的最后一行；不传就由调用方自己画
 */
function drawHook(ctx, o, W, top, size, f, stamp) {
  if (o.codeImage) {
    const L1 = '你去过几个省？'
    const L2 = '长按识别小程序码'
    const L3 = '点亮你自己的地图'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.font = '700 ' + f.l1 + 'px ' + FONT
    const w1 = ctx.measureText(L1).width
    ctx.font = '400 ' + f.l2 + 'px ' + FONT
    const w2 = ctx.measureText(L2).width
    ctx.font = '600 ' + f.l2 + 'px ' + FONT
    const w3 = ctx.measureText(L3).width
    const tw = Math.max(w1, w2, w3)
    const gap = 34
    const x0 = (W - (size + gap + tw)) / 2
    const tx = x0 + size + gap

    drawCodeCard(ctx, o.codeImage, x0, top, size, f.shadow)

    ctx.font = '700 ' + f.l1 + 'px ' + FONT
    ctx.fillStyle = C.ink
    ctx.fillText(L1, tx, top + f.y[0])
    ctx.font = '400 ' + f.l2 + 'px ' + FONT
    ctx.fillStyle = C.ink2
    ctx.fillText(L2, tx, top + f.y[1])
    ctx.font = '600 ' + f.l2 + 'px ' + FONT
    ctx.fillStyle = f.accent || C.litHi
    ctx.fillText(L3, tx, top + f.y[2])
    if (stamp) {
      ctx.font = '400 22px ' + FONT
      ctx.fillStyle = C.ink3
      ctx.fillText(stamp, tx, top + f.y[3])
    }
    return top + size
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '700 46px ' + FONT
  ctx.fillStyle = C.ink
  ctx.fillText('你去过几个省？', W / 2, top + 66)
  ctx.font = '400 28px ' + FONT
  ctx.fillStyle = C.ink2
  ctx.fillText('点亮你自己的旅行地图', W / 2, top + 122)
  if (stamp) {
    ctx.font = '400 22px ' + FONT
    ctx.fillStyle = C.ink3
    ctx.fillText(stamp, W / 2, top + 166)
  }
  return top + 140
}

function drawFooter(ctx, text, cx, y) {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '400 24px ' + FONT
  ctx.fillStyle = C.ink3
  ctx.fillText(text, cx, y)
}

/* ================= 夜光 / 明信片：一个大数字 + 地图 + 大区进度条 ================= */

/** 「6 个省」。数字是整张图唯一的主角 */
function drawHero(ctx, o, cx, y, size, glow) {
  row(ctx, [
    { t: String(o.n), f: '800 ' + size + 'px ' + FONT, c: o.paper ? C.lit : C.litHi, glow: glow },
    { t: ' 个省', f: '700 ' + Math.round(size * 0.235) + 'px ' + FONT, c: C.ink },
  ], cx, y)
}

/** 城市 · 国土 · 人口，一行小字 */
function statsParts(o, small, big) {
  const dot = { t: '   ·   ', f: '400 ' + small + 'px ' + FONT, c: C.ink3 }
  const parts = []
  if (o.cities) parts.push({ t: o.cities + ' 个城市', f: '700 ' + big + 'px ' + FONT, c: C.ink }, dot)
  parts.push(
    { t: '国土 ', f: '400 ' + small + 'px ' + FONT, c: C.ink2 },
    { t: o.areaPct + '%', f: '700 ' + big + 'px ' + FONT, c: C.ink },
    dot,
    { t: '人口 ', f: '400 ' + small + 'px ' + FONT, c: C.ink2 },
    { t: o.popPct + '%', f: '700 ' + big + 'px ' + FONT, c: C.ink },
  )
  return parts
}

/** 旅行者类型做成一枚标签，比混在一行字里醒目 */
function drawPill(ctx, text, cx, y, paper) {
  ctx.font = '600 28px ' + FONT
  const w = ctx.measureText(text).width + 56
  paint.roundRect(ctx, cx - w / 2, y, w, 54, 27)
  ctx.fillStyle = paper ? 'rgba(200,68,47,0.08)' : paint.rgba(C.lit, 0.14)
  ctx.fill()
  ctx.strokeStyle = paper ? C.lit : paint.rgba(C.litHi, 0.6)
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = paper ? C.lit : C.litHi
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, y + 28)
  ctx.textBaseline = 'alphabetic'
}

/**
 * 七大区进度条，4 + 3 两行居中。
 * 只去过几个省的人，地图上亮的就那几块，这里给出「还差多少」，图才不显得空。
 * 集齐的大区数字换主色。
 */
function drawRegionBars(ctx, o, W, y0) {
  const colW = 230
  const gap = 20
  const accent = o.paper ? C.lit : C.litHi
  const track = o.paper ? '#E2D8C6' : C.edge
  stats.REGIONS.forEach((r, i) => {
    const second = i >= 4
    const cols = second ? 3 : 4
    const ci = second ? i - 4 : i
    const x0 = (W - (cols * colW + (cols - 1) * gap)) / 2 + ci * (colW + gap)
    const y = y0 + (second ? 70 : 0)
    let n = 0
    r.ids.forEach((id) => { if (o.lit.has(id)) n++ })

    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.font = '600 26px ' + FONT
    ctx.fillStyle = n ? C.ink : C.ink3
    ctx.fillText(r.name, x0, y)
    ctx.textAlign = 'right'
    ctx.font = '600 24px ' + FONT
    ctx.fillStyle = n === r.ids.length ? accent : C.ink2
    ctx.fillText(n + '/' + r.ids.length, x0 + colW, y)

    paint.roundRect(ctx, x0, y + 14, colW, 8, 4)
    ctx.fillStyle = track
    ctx.fill()
    if (n) {
      paint.roundRect(ctx, x0, y + 14, Math.max(8, (colW * n) / r.ids.length), 8, 4)
      ctx.fillStyle = accent
      ctx.fill()
    }
  })
}

/** 纸纹：稀疏的深浅颗粒，压到几乎看不见，只是让底不那么像屏幕。
 *  固定种子，同一张图每次出来一样 */
function drawPaperGrain(ctx, W, H) {
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(120,90,50,0.05)' : 'rgba(255,255,255,0.35)'
    ctx.fillRect(rnd() * W, rnd() * H, 2, 2)
  }
  // 明信片式的双线边框
  ctx.strokeStyle = C.edge
  ctx.lineWidth = 2
  ctx.strokeRect(36, 36, W - 72, H - 72)
  ctx.strokeRect(46, 46, W - 92, H - 92)
}

/** 夜光 / 明信片 9:16。两者只差配色和几个小数，版式是同一套 */
function drawHeroStory(ctx, o) {
  const W = FORMATS.story.w
  const paper = o.paper
  if (paper) drawPaperGrain(ctx, W, FORMATS.story.h)

  // 标题降成小字，把位置让给大数字
  drawTitle(ctx, titleText(o.nick, '旅行地图'), W / 2, 150, { size: 40, weight: '600', tracking: 10, maxW: 900, color: C.ink2 })
  drawHero(ctx, o, W / 2, 400, 240, paper ? 0 : 60)
  row(ctx, statsParts(o, 30, 32), W / 2, 476)
  if (o.persona) drawPill(ctx, o.persona.split(' · ')[0], W / 2, 516, paper)

  // 明信片有边框，地图往里收一点
  if (paper) paint.drawMap(ctx, o.shapes, o.lit, o.inset, 30, 600, 1020)
  else paint.drawMap(ctx, o.shapes, o.lit, o.inset, 0, 600, W)

  drawRegionBars(ctx, o, W, paper ? 1460 : 1480)

  // 钩子和日期。明信片底部有边框（内框 y=1874），整体上提
  const top = paper ? 1590 : 1626
  drawHook(ctx, o, W, top, CODE_SIZE, {
    l1: 40, l2: 26, y: [70, 128, 174],
    shadow: paper ? 'rgba(80,60,30,0.18)' : null,
    accent: paper ? C.lit : null,
  }, null)
  drawFooter(ctx, stampText(o.date) + (paper ? '  ·  旅行明信片' : ''), W / 2, paper ? 1850 : 1888)
}

/** 夜光 4:5。没地方放进度条和标签，旅行者类型并进数据那一行 */
function drawHeroFeed(ctx, o) {
  const W = FORMATS.feed.w
  drawTitle(ctx, titleText(o.nick, '旅行地图'), W / 2, 84, { size: 34, weight: '600', tracking: 8, maxW: 900, color: C.ink2 })
  drawHero(ctx, o, W / 2, 250, 160, 44)
  const parts = statsParts(o, 26, 28)
  if (o.persona) {
    parts.push({ t: '   ·   ', f: '400 26px ' + FONT, c: C.ink3 },
      { t: o.persona.split(' · ')[0], f: '600 26px ' + FONT, c: C.litHi })
  }
  row(ctx, parts, W / 2, 312)

  // 地图 1000 宽、高 803，落在 340..1143；底下 1156 起放码，卡底 1336
  paint.drawMap(ctx, o.shapes, o.lit, o.inset, 40, 340, 1000)
  drawHook(ctx, o, W, 1156, FEED_CODE, { l1: 36, l2: 24, y: [56, 106, 142, 174] }, stampText(o.date))
}

/* ================= 集邮册 ================= */

/** 按 id 算一个稳定的小角度（±6°），邮票才有手贴的手感；同一个人每次出图一样 */
function tilt(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return ((((h % 13) + 13) % 13) - 6) * Math.PI / 180
}

/** 把一个省的轮廓缩放进以 (cx, cy) 为中心、边长 box 的框里，只描路径 */
function traceFit(ctx, shape, cx, cy, box) {
  const b = shape.bounds
  const s = Math.min(box / (b.x1 - b.x0), box / (b.y1 - b.y0))
  const ox = cx - ((b.x0 + b.x1) / 2) * s
  const oy = cy - ((b.y0 + b.y1) / 2) * s
  ctx.beginPath()
  for (let r = 0; r < shape.rings.length; r++) {
    const p = shape.rings[r]
    ctx.moveTo(ox + p[0] * s, oy + p[1] * s)
    for (let k = 2; k < p.length; k += 2) ctx.lineTo(ox + p[k] * s, oy + p[k + 1] * s)
    ctx.closePath()
  }
}

/** 邮票齿孔边：沿矩形四边一路挖半圆 */
function perforated(ctx, x, y, w, h, r, step) {
  ctx.beginPath()
  ctx.moveTo(x, y)
  for (let i = x; i < x + w; i += step) { ctx.lineTo(i, y); ctx.arc(i + step / 2, y, r, Math.PI, 0, true) }
  ctx.lineTo(x + w, y)
  for (let j = y; j < y + h; j += step) { ctx.lineTo(x + w, j); ctx.arc(x + w, j + step / 2, r, -Math.PI / 2, Math.PI / 2, true) }
  ctx.lineTo(x + w, y + h)
  for (let i = x + w; i > x; i -= step) { ctx.lineTo(i, y + h); ctx.arc(i - step / 2, y + h, r, 0, Math.PI, true) }
  ctx.lineTo(x, y + h)
  for (let j = y + h; j > y; j -= step) { ctx.lineTo(x, j); ctx.arc(x, j - step / 2, r, Math.PI / 2, -Math.PI / 2, true) }
  ctx.closePath()
}

function setDash(ctx, d) {
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash(d)
}

function drawStampsStory(ctx, o) {
  const W = FORMATS.story.w

  drawTitle(ctx, titleText(o.nick, '旅行集邮册'), W / 2, 150, { size: 60, weight: '800', tracking: 8, maxW: 960, color: C.ink })
  row(ctx, [
    { t: '已集 ', f: '400 36px ' + FONT, c: C.ink2 },
    { t: String(o.n), f: '800 92px ' + FONT, c: C.litHi, glow: 30 },
    { t: ' / 34 枚', f: '400 36px ' + FONT, c: C.ink2 },
  ], W / 2, 268)

  // 按七大区排，同一区的章挨在一起；6 列 × 6 行，最后一行剩 2 格放「下一站」
  const ids = []
  stats.REGIONS.forEach((r) => r.ids.forEach((id) => ids.push(id)))
  const cols = 6
  const cw = 160
  const ch = 196
  const gx = (W - cols * cw) / 2
  const gy = 320
  ids.forEach((id, i) => {
    const s = o.byId[id]
    const cx = gx + (i % cols) * cw + cw / 2
    const cy = gy + Math.floor(i / cols) * ch + 88
    const on = o.lit.has(id)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    if (on) {
      ctx.rotate(tilt(id))
      perforated(ctx, -66, -78, 132, 156, 5, 13)
      ctx.fillStyle = paint.rgba(C.lit, 0.16)
      ctx.fill()
      ctx.strokeStyle = paint.rgba(C.litHi, 0.75)
      ctx.lineWidth = 1.5
      ctx.stroke()
      traceFit(ctx, s, 0, -22, 80)
      ctx.fillStyle = C.lit
      ctx.fill()
      ctx.strokeStyle = C.litHi
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = C.ink
      ctx.font = '700 26px ' + FONT
      ctx.fillText(s.name, 0, 44)
      // 从 v1 迁过来的没有日期，就不印
      const d = o.dates[id]
      if (d) {
        ctx.font = '400 17px ' + FONT
        ctx.fillStyle = C.ink2
        ctx.fillText(d.replace(/-/g, '.'), 0, 64)
      }
    } else {
      traceFit(ctx, s, 0, -16, 84)
      ctx.fillStyle = paint.rgba(C.dimLine, 0.25)
      ctx.fill()
      setDash(ctx, [4, 4])
      ctx.strokeStyle = C.dimLine
      ctx.lineWidth = 1.6
      ctx.stroke()
      setDash(ctx, [])
      ctx.fillStyle = C.ink3
      ctx.font = '600 24px ' + FONT
      ctx.fillText(s.name, 0, 52)
    }
    ctx.restore()
  })

  if (o.next.length) {
    const x = gx + 4 * cw + 10
    const top = gy + 5 * ch
    paint.roundRect(ctx, x, top + 10, cw * 2 - 20, 156, 16)
    setDash(ctx, [6, 5])
    ctx.strokeStyle = paint.rgba(C.litHi, 0.6)
    ctx.lineWidth = 1.5
    ctx.stroke()
    setDash(ctx, [])
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.font = '400 24px ' + FONT
    ctx.fillStyle = C.ink2
    ctx.fillText('下一站', x + cw - 10, top + 66)
    ctx.font = '700 32px ' + FONT
    ctx.fillStyle = C.ink
    ctx.fillText(o.next.slice(0, 3).join(' · '), x + cw - 10, top + 116)
  }

  drawHook(ctx, o, W, 1590, CODE_SIZE, { l1: 40, l2: 26, y: [70, 128, 174] }, null)
  drawFooter(ctx, stampText(o.date), W / 2, 1870)
}

/* ================= 入口 ================= */

/**
 * 把整张图画进 ctx（调用方已经把画布缩放到对应版式的逻辑坐标系）。
 * 画完会把 paint 的配色复位成当前档位 —— 屏幕地图和这里共用 paint.C，
 * 不复位的话出完一张明信片，屏幕上的地图就成米色的了。
 *
 * @param opts.style     'glow' | 'stamps' | 'paper'，默认 glow
 * @param opts.format    'story' | 'feed'，默认 story；样式不支持 feed 时按 story 画
 * @param opts.shapes    geo.prepare() 的结果
 * @param opts.byId      省 id → shape（集邮册用）
 * @param opts.lit       已点亮省份 id 的 Set
 * @param opts.dates     省 id → 首次点亮日期 'YYYY-MM-DD'，可空串（集邮册用）
 * @param opts.inset     { viewBox, rings }
 * @param opts.totalArea 全国陆地面积（万 km²）
 * @param opts.codeImage 小程序码 Image，缺失时底部退化成纯文案
 * @param opts.nick      署名，可空
 * @param opts.cities    城市数
 * @param opts.next      想去还没去的省名数组（下一站）
 * @param opts.date      Date，由调用方传入便于测试
 */
function draw(ctx, opts) {
  const style = STYLES[opts.style] ? opts.style : 'glow'
  const format = opts.format === 'feed' && STYLES[style].feed ? 'feed' : 'story'
  const fmt = FORMATS[format]
  const n = opts.lit.size
  const cover = stats.coverage(opts.shapes, (id) => opts.lit.has(id), opts.totalArea)
  const byId = opts.byId || {}
  if (!opts.byId) opts.shapes.forEach((p) => { byId[p.id] = p })
  const o = {
    shapes: opts.shapes,
    byId,
    lit: opts.lit,
    dates: opts.dates || {},
    inset: opts.inset,
    codeImage: opts.codeImage,
    nick: opts.nick || '',
    cities: opts.cities || 0,
    next: opts.next || [],
    date: opts.date || new Date(),
    n,
    areaPct: cover.areaPct,
    popPct: cover.popPct,
    persona: stats.persona(n, +cover.areaPct, +cover.popPct),
    paper: style === 'paper',
  }

  // 出图 canvas 是复用的节点，先把上一次留下的状态清干净
  clearShadow(ctx)
  ctx.globalAlpha = 1
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([])

  // 配色由点亮数决定，必须在画任何东西之前定下来
  const theme = themes.tierFor(n)
  paint.applyTheme(theme)
  if (o.paper) paint.applyPaper()

  try {
    ctx.fillStyle = C.void
    ctx.fillRect(0, 0, fmt.w, fmt.h)

    if (!o.paper) {
      // 环境光：夜光跟着地图走，集邮册压在顶部标题后面
      const ay = style === 'stamps' ? 300 : format === 'feed' ? 700 : AMBIENT.y
      const rg = ctx.createRadialGradient(fmt.w / 2, ay, 0, fmt.w / 2, ay, style === 'stamps' ? 1000 : AMBIENT.r)
      rg.addColorStop(0, 'rgba(' + theme.ambient + ',' + (style === 'stamps' ? 0.4 : AMBIENT.alpha) + ')')
      rg.addColorStop(1, 'rgba(' + theme.ambient + ',0)')
      ctx.fillStyle = rg
      ctx.fillRect(0, 0, fmt.w, fmt.h)
    }

    if (style === 'stamps') drawStampsStory(ctx, o)
    else if (format === 'feed') drawHeroFeed(ctx, o)
    else drawHeroStory(ctx, o)
  } finally {
    paint.applyTheme(theme)
  }
  return format
}

/** 兼容旧调用：EW/EH 是长图的尺寸 */
const EW = FORMATS.story.w
const EH = FORMATS.story.h

module.exports = { EW, EH, FORMATS, STYLES, PCT, AMBIENT, CARD, draw, titleText }
