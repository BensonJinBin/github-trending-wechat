const RAW = require('./provinces')
const geo = require('./geo')
const paint = require('./paint')
const poster = require('./poster')
const themes = require('./themes')
const storage = require('../../utils/storage')

const STORE_KEY = 'travel-map/v1'

/** 小程序码。公众平台后台「工具 → 生成小程序码」下载后改名放到本目录即可；
 *  文件不在时出图会自动退化成纯文案，不会报错 */
const CODE_PATH = '/pages/travel-map/mpcode.png'

/** 出图倍率。2 即 2160×3840，部分安卓机画布过大会直接失败，失败后降到 1 重试 */
const EXPORT_SCALE = 2

/** 按钮排列顺序：直辖市 → 自治区 → 东北 → 华东 → 华中华南 → 西部 */
const ORDER = [
  'beijing', 'tianjin', 'shanghai', 'chongqing', 'neimenggu', 'guangxi', 'xizang',
  'ningxia', 'xinjiang', 'hebei', 'shanxi', 'liaoning', 'jilin', 'heilongjiang',
  'jiangsu', 'zhejiang', 'anhui', 'fujian', 'jiangxi', 'shandong', 'henan',
  'guangdong', 'guizhou', 'hainan', 'hunan', 'sichuan', 'yunnan', 'hubei',
  'shaanxi', 'gansu', 'qinghai', 'taiwan', 'xianggang', 'aomen',
]

/** 手指在画布上滑动超过这个距离就当成滚动页面，不算点选 */
const TAP_SLOP = 10

Page({
  data: {
    chips: [],
    litMap: {},
    count: 0,
    areaPct: '0.0',
    peoplePct: 0,
    mapW: 0,
    mapH: 0,
    navPad: 0,
    menuTop: 0,
    menuH: 0,
    canBack: false,
    posterW: poster.EW,
    posterH: poster.EH,
    tier: 't1',
    sheetOpen: false,
    posterPath: '',
    toastText: '',
    toastShow: false,
  },

  onLoad() {
    this.shapes = geo.prepare(RAW)
    this.inset = { viewBox: RAW.inset.viewBox, rings: geo.parsePath(RAW.inset.d) }
    this.byId = {}
    this.shapes.forEach((p) => { this.byId[p.id] = p })
    this.lit = new Set()

    const win = wx.getWindowInfo()
    this.dpr = win.pixelRatio || 2

    const saved = storage.get(STORE_KEY)
    if (Array.isArray(saved)) {
      // 存档里可能有已经不存在的 id，过滤掉，别让老数据把页面搞崩
      saved.forEach((id) => { if (this.byId[id]) this.lit.add(id) })
    }

    // 地图左右出血到屏幕边缘，宽度就是窗口宽度；高度按 viewBox 比例锁死，
    // 先算好写进 style，onReady 查到的尺寸才和这里一致
    const winW = win.windowWidth
    const mapH = Math.round((winW * paint.VB[3]) / paint.VB[2])

    // 自绘导航栏：内容整体压到胶囊下面。居中的大标题在 375pt 屏上宽约 240px，
    // 不让位就会被右上角胶囊压住。
    // 少数机型这个接口会返回全零，兜个底，否则标题会缩到状态栏底下
    const menu = wx.getMenuButtonBoundingClientRect() || {}
    const menuTop = menu.top || (win.statusBarHeight || 20) + 6
    const menuH = menu.height || 32

    this.setData({
      chips: ORDER.map((id) => ({ id, name: this.byId[id].name })),
      mapW: winW,
      mapH,
      navPad: Math.round(menuTop + menuH + 12),
      menuTop: Math.round(menuTop),
      menuH: Math.round(menuH),
      // 自定义导航栏微信不给返回键。现在这页没入口，直接启动时不该画；
      // 以后从首页 navigateTo 过来就有栈了，得画
      canBack: getCurrentPages().length > 1,
    })
    this.applyTier()
    this.syncStats()
  },

  onReady() {
    this.initMapCanvas()
  },

  onUnload() {
    if (this.toastTimer) clearTimeout(this.toastTimer)
  },

  /* ---------------- 画布 ---------------- */

  /**
   * 查不到节点、或查到的尺寸是 0（布局还没落定），都会让地图永远空着 ——
   * drawMap 之后每次都被 `if (!ctx) return` 挡掉，点击也被 `!this.mapCssW` 挡掉，
   * 用户看到的是一片空白且毫无反馈。所以失败要出声，并且重试一次。
   */
  initMapCanvas(retried) {
    wx.createSelectorQuery()
      .in(this)
      .select('#map')
      .fields({ node: true, size: true })
      .exec((res) => {
        const info = res && res[0]
        if (!info || !info.node || !info.width) {
          console.warn('[travel-map] 地图画布未就绪', info)
          if (!retried) setTimeout(() => this.initMapCanvas(true), 120)
          return
        }
        const node = info.node
        node.width = info.width * this.dpr
        node.height = info.height * this.dpr
        const ctx = node.getContext('2d')
        // 改 width/height 会重置变换，所以 scale 必须在之后，且只做这一次
        ctx.scale(this.dpr, this.dpr)
        this.mapCtx = ctx
        this.mapCssW = info.width
        this.mapCssH = info.height
        this.drawMap()
      })
  },

  drawMap() {
    const ctx = this.mapCtx
    if (!ctx) return
    ctx.clearRect(0, 0, this.mapCssW, this.mapCssH)
    paint.drawMap(ctx, this.shapes, this.lit, this.inset, 0, 0, this.mapCssW)
  },

  /** 出图画布是屏幕外的固定尺寸节点：离屏 canvas 没法喂给 canvasToTempFilePath */
  getPosterNode() {
    if (this.posterNode) return Promise.resolve(this.posterNode)
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#poster')
        .fields({ node: true })
        .exec((res) => {
          const node = res && res[0] && res[0].node
          if (!node) reject(new Error('poster canvas 未就绪'))
          else {
            this.posterNode = node
            resolve(node)
          }
        })
    })
  },

  /**
   * 小程序码只加载一次。
   *
   * 只缓存两种确定的结果：加载成功，或者 onerror（文件真的不在）。
   * **超时不缓存** —— 低端机冷启动解一张 448×448 的 PNG 慢过 2 秒是可能的，
   * 缓存了就意味着这次会话之后每一次出图都没有码，而码是这个页面唯一的传播入口。
   * 下次导出重试一遍，代价只是再等一下。
   */
  loadCodeImage(node) {
    if (this._codeImage !== undefined) return Promise.resolve(this._codeImage)
    return new Promise((resolve) => {
      let settled = false
      const finish = (v, cache) => {
        if (settled) return
        settled = true
        if (cache) this._codeImage = v
        resolve(v)
      }
      const img = node.createImage()
      img.onload = () => finish(img, true)
      img.onerror = () => finish(null, true)
      // 两个回调都不来的机型是有的，兜一下底别把出图卡死，但不记账
      setTimeout(() => finish(null, false), 2000)
      img.src = CODE_PATH
    })
  },

  /* ---------------- 交互 ---------------- */

  onMapTouchStart(e) {
    const t = e.touches && e.touches[0]
    this.touchStart = t ? { x: t.x, y: t.y } : null
  },

  onMapTouchEnd(e) {
    const start = this.touchStart
    this.touchStart = null
    const t = e.changedTouches && e.changedTouches[0]
    if (!start || !t || !this.mapCssW) return
    if (Math.abs(t.x - start.x) > TAP_SLOP || Math.abs(t.y - start.y) > TAP_SLOP) return

    const id = paint.pickAt(this.shapes, t.x, t.y, this.mapCssW)
    if (id) this.toggle(id)
  },

  onBack() {
    wx.navigateBack()
  },

  onChipTap(e) {
    this.toggle(e.currentTarget.dataset.id)
  },

  /**
   * 配色跟着点亮省份数走（档位见 themes.js）。
   * 必须在 drawMap 之前调 —— paint.C 是模块级的，画之前定不下来就画错色。
   * 页面那边靠根节点的 t1…t5 类换 CSS 变量。
   */
  applyTier() {
    const t = themes.tierFor(this.lit.size)
    paint.applyTheme(t)
    if (this.data.tier !== t.key) this.setData({ tier: t.key })
  },

  toggle(id) {
    if (this.lit.has(id)) this.lit.delete(id)
    else this.lit.add(id)
    this.applyTier()
    this.drawMap()
    this.syncStats()
    storage.set(STORE_KEY, Array.from(this.lit))
  },

  syncStats() {
    let area = 0
    const litMap = {}
    this.shapes.forEach((p) => {
      if (!this.lit.has(p.id)) return
      litMap[p.id] = true
      area += p.area
    })
    const n = this.lit.size
    this.setData({
      litMap,
      count: n,
      areaPct: ((area / RAW.totalArea) * 100).toFixed(1),
      peoplePct: poster.PCT[n],
    })
  },

  onClear() {
    if (!this.lit.size) return
    this.lit.clear()
    this.applyTier()
    this.drawMap()
    this.syncStats()
    storage.set(STORE_KEY, [])
    this.toast('已清空')
  },

  /* ---------------- 出图 ---------------- */

  onExport() {
    if (this.exporting) return
    this.exporting = true
    wx.showLoading({ title: '生成中', mask: true })

    this.getPosterNode()
      .then((node) => this.loadCodeImage(node).then((img) => this.renderPoster(node, img, EXPORT_SCALE)))
      .catch((err) => {
        // 安卓上画布过大会直接生成失败，降一档重试一次
        console.warn('[travel-map] 出图失败，降级重试', err)
        return this.getPosterNode().then((node) => this.renderPoster(node, this._codeImage || null, 1))
      })
      .then((path) => {
        this.setData({ posterPath: path, sheetOpen: true })
      })
      .catch((err) => {
        console.error('[travel-map] 出图失败', err)
        this.toast('生成失败，请重试')
      })
      .then(() => {
        wx.hideLoading()
        this.exporting = false
      })
  },

  renderPoster(node, codeImage, scale) {
    node.width = poster.EW * scale
    node.height = poster.EH * scale
    const ctx = node.getContext('2d')
    ctx.scale(scale, scale)

    poster.draw(ctx, {
      shapes: this.shapes,
      lit: this.lit,
      inset: this.inset,
      totalArea: RAW.totalArea,
      codeImage,
    })

    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: node,
        x: 0,
        y: 0,
        // width/height 是逻辑坐标（ctx 已 scale），destWidth/destHeight 才是出图像素
        width: poster.EW,
        height: poster.EH,
        destWidth: poster.EW * scale,
        destHeight: poster.EH * scale,
        fileType: 'png',
        success: (r) => resolve(r.tempFilePath),
        fail: reject,
      })
    })
  },

  onCloseSheet() {
    this.setData({ sheetOpen: false })
  },

  /** 盖在图和按钮上，阻止点穿到遮罩的关闭手势 */
  onSheetStop() {},

  onSave() {
    const filePath = this.data.posterPath
    if (!filePath) return
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => this.toast('已保存到相册'),
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (msg.indexOf('auth deny') >= 0 || msg.indexOf('authorize no response') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存图片需要你授权访问相册，去设置里打开？',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting() },
          })
        } else if (msg.indexOf('cancel') < 0) {
          this.toast('保存失败，请重试')
        }
      },
    })
  },

  /* ---------------- toast ---------------- */

  toast(text) {
    this.setData({ toastText: text, toastShow: true })
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.setData({ toastShow: false }), 2000)
  },
})
