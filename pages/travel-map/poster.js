/**
 * 竖版分享长图 1080×1920（实际 2× 渲染）
 *
 * 图片是这个页面唯一的传播渠道 —— 页面本身没入口、也没开原生转发，
 * 所以底部必须给看到图的人一个钩子：一句「你去过几个省？」加一枚小程序码。
 */

const paint = require('./paint')
const themes = require('./themes')

const EW = 1080
const EH = 1920
const FONT = paint.FONT
const C = paint.C

/** 白卡尺寸。实测微信朋友圈把长边压到 1080 左右，换算过来码宽约 220px，
 *  这个尺寸留足了识别余量；再小就有扫不出来的风险 */
const CODE_SIZE = 222

/** 环境光：整张图的氛围底，一团居中的雾。
 *  y/r 决定它铺多大，alpha 决定多浓；颜色跟着主题走（themes.js 的 ambient）。
 *  铺太小顶部标题和底部二维码会悬在死黑里 */
const AMBIENT = { y: 930, r: 900, alpha: 0.46 }

/** 「超过全国 X% 的人」—— 按去过省份数的估算曲线，照抖音那个梗做的，不是统计数据 */
const PCT = [0, 4, 12, 22, 32, 41, 49, 56, 62, 67, 72, 76, 79.5, 82.5, 85, 87, 89, 90.5, 92, 93,
  94, 94.8, 95.5, 96.1, 96.7, 97.2, 97.7, 98.1, 98.5, 98.9, 99.2, 99.4, 99.6, 99.8, 99.9]

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

/** 省份胶囊，自动折行居中，返回底部 y */
function drawChips(ctx, names, x0, y0, maxW) {
  const padX = 16
  const h = 40
  const gap = 8
  ctx.font = '600 24px ' + FONT
  const items = names.map((n) => ({ n, w: ctx.measureText(n).width + padX * 2 }))

  const rows = []
  let cur = []
  let cw = 0
  items.forEach((it) => {
    if (cur.length && cw + gap + it.w > maxW) {
      rows.push({ items: cur, w: cw })
      cur = []
      cw = 0
    }
    cw += (cur.length ? gap : 0) + it.w
    cur.push(it)
  })
  if (cur.length) rows.push({ items: cur, w: cw })

  rows.forEach((r, ri) => {
    let x = x0 + (maxW - r.w) / 2
    const y = y0 + ri * (h + gap)
    r.items.forEach((it) => {
      paint.roundRect(ctx, x, y, it.w, h, h / 2)
      // 页面上的胶囊（wxss 的 .chip.on）是跟主题的，这里写死蓝就会出现
      // 「屏幕是珊瑚色、导出的胶囊是蓝的」—— 正是 applyTheme 注释里说不能发生的事
      ctx.fillStyle = paint.rgba(C.lit, 0.18)
      ctx.fill()
      ctx.strokeStyle = paint.rgba(C.litHi, 0.5)
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fillStyle = C.ink
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '600 24px ' + FONT
      ctx.fillText(it.n, x + it.w / 2, y + h / 2 + 1)
      x += it.w + gap
    })
  })
  return y0 + rows.length * (h + gap)
}

/** 白卡的形状和亮度。
 *  码本身是圆的，用圆卡能在**不缩小码**的前提下少掉 21% 的白面积（πr² vs 边长²），
 *  这是压住它存在感最划算的一刀 —— 纯白压在纯黑上比点亮的省份还亮，扎眼的是白不是大。
 *  dim 再往上压一点整体亮度：白和绿一起变暗，两者的对比**比值不变**，只损失很小的绝对差。
 *  shape: 'circle' | 'rect'，dim: 0 = 纯白 */
const CARD = { shape: 'circle', dim: 0.06, pad: 8 }

/** 白底不反色：反色码微信在暗背景上识别率明显下降 */
function drawCodeCard(ctx, img, x, y) {
  const r = CODE_SIZE / 2
  ctx.save()
  ctx.beginPath()
  if (CARD.shape === 'circle') ctx.arc(x + r, y + r, r, 0, Math.PI * 2)
  else paint.roundRect(ctx, x, y, CODE_SIZE, CODE_SIZE, 16)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  // 裁进卡形，圆卡才能把源图的白色方角切掉
  ctx.clip()
  ctx.drawImage(img, x + CARD.pad, y + CARD.pad, CODE_SIZE - CARD.pad * 2, CODE_SIZE - CARD.pad * 2)
  if (CARD.dim > 0) {
    ctx.globalAlpha = CARD.dim
    ctx.fillStyle = C.dim
    ctx.fillRect(x, y, CODE_SIZE, CODE_SIZE)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

/**
 * 把整张图画进 ctx（调用方已经把画布缩放到 1080×1920 的逻辑坐标系）。
 *
 * @param opts.shapes    geo.prepare() 的结果
 * @param opts.lit       已点亮省份 id 的 Set
 * @param opts.inset     { viewBox, rings }
 * @param opts.totalArea 全国陆地面积（万 km²）
 * @param opts.codeImage 小程序码 Image，缺失时底部退化成纯文案
 * @param opts.date      Date，由调用方传入便于测试
 */
function draw(ctx, opts) {
  const { shapes, lit, inset, totalArea, codeImage } = opts

  // 出图 canvas 是复用的节点，先把上一次留下的状态清干净
  clearShadow(ctx)
  ctx.globalAlpha = 1

  // 配色由点亮数决定，必须在画任何东西之前定下来
  const n = lit.size
  const theme = themes.tierFor(n)
  paint.applyTheme(theme)

  ctx.fillStyle = C.void
  ctx.fillRect(0, 0, EW, EH)

  const rg = ctx.createRadialGradient(EW / 2, AMBIENT.y, 0, EW / 2, AMBIENT.y, AMBIENT.r)
  rg.addColorStop(0, 'rgba(' + theme.ambient + ',' + AMBIENT.alpha + ')')
  rg.addColorStop(1, 'rgba(' + theme.ambient + ',0)')
  ctx.fillStyle = rg
  ctx.fillRect(0, 0, EW, EH)

  ctx.font = '800 68px ' + FONT
  ctx.fillStyle = C.ink
  fillTracked(ctx, '点亮我的旅行地图', EW / 2, 156, 9)

  let area = 0
  for (let i = 0; i < shapes.length; i++) if (lit.has(shapes[i].id)) area += shapes[i].area
  const pctArea = ((area / totalArea) * 100).toFixed(1)

  row(ctx, [
    { t: '点亮 ', f: '400 38px ' + FONT, c: C.ink2 },
    { t: String(n), f: '800 96px ' + FONT, c: C.litHi, glow: 32 },
    { t: ' 个省', f: '400 38px ' + FONT, c: C.ink2 },
  ], EW / 2, 346)

  row(ctx, [
    { t: '覆盖国土面积 ', f: '400 32px ' + FONT, c: C.ink2 },
    { t: pctArea + '%', f: '700 46px ' + FONT, c: C.ink },
  ], EW / 2, 422)

  ctx.fillStyle = C.edge
  ctx.fillRect(EW / 2 - 110, 466, 220, 1)

  row(ctx, [
    { t: '超过全国 ', f: '400 26px ' + FONT, c: C.ink3 },
    { t: PCT[n] + '%', f: '700 28px ' + FONT, c: C.ink2 },
    { t: ' 的人 ✦', f: '400 26px ' + FONT, c: C.ink3 },
  ], EW / 2, 510)

  paint.drawMap(ctx, shapes, lit, inset, 0, 528, EW)

  // 胶囊起点 1405 压在地图框（528..1395）的下沿里 —— 地图框底部约 45px 是空的，
  // 南海插图的说明文字到 y≈1350 就结束了。改地图尺寸或 INSET 位置时要重算这个值。
  const listed = shapes.filter((p) => lit.has(p.id)).map((p) => p.name)
  let chipsBottom
  if (listed.length) {
    chipsBottom = drawChips(ctx, listed, 50, 1405, 980)
  } else {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '400 30px ' + FONT
    ctx.fillStyle = C.ink3
    ctx.fillText('还没点亮任何省份', EW / 2, 1455)
    chipsBottom = 1485
  }

  // 底部钩子。位置跟着胶囊走：省份少时固定在 1620，多到四行才往下让。
  // 最挤的情况（34 省四行）：chipsBottom 1597 → top 1639 → 卡片底 1861，
  // 日期基线 1893、字高 24 即顶在 1875，还差 14px 才碰上。字号别再往上加了。
  const top = Math.max(1620, chipsBottom + 42)
  let stampY

  if (codeImage) {
    // 左码右字，比上下堆叠省一半竖向空间
    const L1 = '你去过几个省？'
    const L2 = '长按识别小程序码'
    const L3 = '点亮你自己的地图'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.font = '700 40px ' + FONT
    const w1 = ctx.measureText(L1).width
    ctx.font = '400 26px ' + FONT
    const w2 = ctx.measureText(L2).width
    ctx.font = '600 26px ' + FONT
    const w3 = ctx.measureText(L3).width
    const tw = Math.max(w1, w2, w3)
    const x0 = (EW - (CODE_SIZE + 34 + tw)) / 2
    const tx = x0 + CODE_SIZE + 34

    drawCodeCard(ctx, codeImage, x0, top)

    ctx.font = '700 40px ' + FONT
    ctx.fillStyle = C.ink
    ctx.fillText(L1, tx, top + 70)
    ctx.fillStyle = C.edge
    ctx.fillRect(tx, top + 96, 100, 1)
    ctx.font = '400 26px ' + FONT
    ctx.fillStyle = C.ink2
    ctx.fillText(L2, tx, top + 142)
    ctx.font = '600 26px ' + FONT
    ctx.fillStyle = C.litHi
    ctx.fillText(L3, tx, top + 188)

    stampY = Math.min(1896, top + CODE_SIZE + 32)
  } else {
    // 没放小程序码时不留空框，整块退化成居中两行字
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.font = '700 46px ' + FONT
    ctx.fillStyle = C.ink
    ctx.fillText('你去过几个省？', EW / 2, top + 66)
    ctx.fillStyle = C.edge
    ctx.fillRect(EW / 2 - 50, top + 94, 100, 1)
    ctx.font = '400 28px ' + FONT
    ctx.fillStyle = C.ink2
    ctx.fillText('点亮你自己的旅行地图', EW / 2, top + 142)
    stampY = Math.min(1896, top + 206)
  }

  const d = opts.date || new Date()
  const stamp = d.getFullYear() + '.' +
    ('0' + (d.getMonth() + 1)).slice(-2) + '.' +
    ('0' + d.getDate()).slice(-2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '400 24px ' + FONT
  ctx.fillStyle = C.ink3
  ctx.fillText(stamp, EW / 2, stampY)
}

module.exports = { EW, EH, PCT, AMBIENT, CARD, draw }
