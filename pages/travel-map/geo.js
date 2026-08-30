/**
 * 省界几何 —— 解析 + 命中判断
 *
 * 小程序 canvas 没有 Path2D，SVG 的 `d` 字符串没法直接喂给 ctx，
 * 所以在这里一次性拆成多边形环。好在数据只有 M/L/Z，纯折线，
 * 拆完既能 moveTo/lineTo 重放，也能直接做点在多边形内的判断，
 * 不用再依赖 ctx.isPointInPath（各端实现不一致）。
 */

/**
 * 把 `M12.3 45.6L13.0 46.1...Z` 拆成若干闭合环。
 * 每个环是扁平数组 [x0,y0,x1,y1,...]，比嵌套对象省内存也快得多。
 */
function parsePath(d) {
  const rings = []
  let ring = null
  let i = 0
  const n = d.length

  const readNum = () => {
    while (i < n) {
      const c = d.charCodeAt(i)
      // 跳过空格和逗号
      if (c === 32 || c === 44) i++
      else break
    }
    const start = i
    // 正负号只允许出现在开头，或紧跟指数 e/E 之后 —— 否则 SVG 合法的隐式分隔
    // 写法 `L12.3-45.6` 会被当成一个数吃掉：parseFloat 得 12.3，下一次读到 NaN，
    // 整条环连带整个省一起消失，而且完全静默。现在这份数据没有负数坐标，
    // 但 README 写了可以重新生成，换个序列化方式就会踩上。
    if (i < n && (d.charCodeAt(i) === 45 || d.charCodeAt(i) === 43)) i++
    while (i < n) {
      const c = d.charCodeAt(i)
      if ((c >= 48 && c <= 57) || c === 46) { i++; continue }
      if (c === 101 || c === 69) {                       // e / E
        i++
        if (i < n && (d.charCodeAt(i) === 45 || d.charCodeAt(i) === 43)) i++
        continue
      }
      break
    }
    return parseFloat(d.slice(start, i))
  }

  while (i < n) {
    const cmd = d[i]
    if (cmd === 'M') {
      i++
      if (ring && ring.length >= 6) rings.push(ring)
      ring = []
      ring.push(readNum(), readNum())
    } else if (cmd === 'L') {
      i++
      if (!ring) ring = []
      ring.push(readNum(), readNum())
    } else if (cmd === 'Z' || cmd === 'z') {
      i++
      if (ring && ring.length >= 6) rings.push(ring)
      ring = null
    } else {
      // 数据只可能出现 M/L/Z；真出别的就跳过，不让整页崩掉
      i++
    }
  }
  if (ring && ring.length >= 6) rings.push(ring)
  return rings
}

/** 一组环的外接矩形，命中判断先用它挡掉绝大多数省份 */
function boundsOf(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let r = 0; r < rings.length; r++) {
    const pts = rings[r]
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k], y = pts[k + 1]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return { x0, y0, x1, y1 }
}

/**
 * 射线法，奇偶规则。
 * 一个省的若干环互不嵌套（简化时碎岛已丢弃、湖泊洞已填平），
 * 所以奇偶和非零绕数在这份数据上等价，奇偶更简单。
 */
function hitRings(rings, x, y) {
  let inside = false
  for (let r = 0; r < rings.length; r++) {
    const p = rings[r]
    const len = p.length
    for (let a = 0, b = len - 2; a < len; b = a, a += 2) {
      const ay = p[a + 1], by = p[b + 1]
      if ((ay > y) !== (by > y)) {
        const ax = p[a], bx = p[b]
        if (x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
      }
    }
  }
  return inside
}

/** 把原始数据里的 `d` 展开成可绘制、可命中的形状，只做一次 */
function prepare(raw) {
  return raw.provinces.map((p) => {
    const rings = parsePath(p.d)
    return {
      id: p.id,
      name: p.name,
      area: p.area,
      cx: p.cx,
      cy: p.cy,
      rings,
      bounds: boundsOf(rings),
    }
  })
}

module.exports = { parsePath, boundsOf, hitRings, prepare }
