/**
 * 分享链接里带的点亮记录：34 个省压成 5 字节，base64url 成 7 个字符。
 *
 * 和网页版（creation/china-travel-map）同一套编码：位序就是 provinces.js 里
 * provinces 数组的顺序，第 i 个省落在第 i>>3 字节的第 i&7 位。
 * **所以 provinces.js 的顺序不能动** —— 动了以后，已经发出去的链接会解成别的省。
 *
 * 小程序没有 btoa/atob，base64url 自己写，反正只有 5 个字节。
 */

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const BYTES = 5

function toB64url(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (b0 << 16) | (b1 << 8) | b2
    s += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63]
    if (i + 1 < bytes.length) s += ALPHA[(n >> 6) & 63]
    if (i + 2 < bytes.length) s += ALPHA[n & 63]
  }
  return s
}

function fromB64url(s) {
  const out = []
  let buf = 0
  let bits = 0
  for (let i = 0; i < s.length; i++) {
    const v = ALPHA.indexOf(s[i])
    if (v < 0) return null
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 255)
    }
  }
  return out
}

/** @param order 省份 id 数组（provinces.js 的顺序）  @param has id → boolean */
function encode(order, has) {
  const bytes = new Array(BYTES).fill(0)
  order.forEach((id, i) => { if (has(id)) bytes[i >> 3] |= 1 << (i & 7) })
  return toB64url(bytes)
}

/** 解不开（被截断、乱改）返回 null，调用方当没带参数处理 */
function decode(order, code) {
  if (typeof code !== 'string' || !code) return null
  const bytes = fromB64url(code)
  if (!bytes || bytes.length < BYTES) return null
  const picked = []
  order.forEach((id, i) => {
    if (bytes[i >> 3] & (1 << (i & 7))) picked.push(id)
  })
  return picked
}

module.exports = { encode, decode }
