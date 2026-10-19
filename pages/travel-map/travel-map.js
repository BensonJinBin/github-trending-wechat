const RAW = require('./provinces')
const CITIES = require('./cities')
const geo = require('./geo')
const paint = require('./paint')
const poster = require('./poster')
const themes = require('./themes')
const stats = require('./stats')
const share = require('./share')
const store = require('./store')
const sync = require('../../utils/sync')

/** 小程序码。公众平台后台「工具 → 生成小程序码」下载后改名放到本目录即可；
 *  文件不在时出图会自动退化成纯文案，不会报错 */
const CODE_PATH = '/pages/travel-map/mpcode.png'

/** 出图倍率。2 即 2160×3840，部分安卓机画布过大会直接失败，失败后降到 1 重试 */
const EXPORT_SCALE = 2

/** 手指在画布上滑动超过这个距离就当成滚动页面，不算点选 */
const TAP_SLOP = 10

/** 撤销条停留多久 */
const UNDO_MS = 5000

/** 署名最长几个字。长图标题是「xx的旅行地图」，再长就要缩字号了 */
const NICK_MAX = 8

/** 分享编码的位序，就是 provinces.js 的顺序。见 share.js：这个顺序不能动 */
const ORDER = RAW.provinces.map((p) => p.id)

Page({
  data: {
    regions: [],
    litMap: {},
    wantMap: {},
    cityNum: {},
    drill: [],
    mode: 'lit',
    count: 0,
    cities: 0,
    areaPct: '0.0',
    popPct: '0.0',
    peoplePct: 0,
    persona: '',
    year: new Date().getFullYear(),
    yearNew: 0,
    wantCount: 0,
    wantDone: 0,
    friend: null,
    mapW: 0,
    mapH: 0,
    navPad: 0,
    menuTop: 0,
    menuH: 0,
    canBack: false,
    posterW: poster.FORMATS.story.w,
    posterH: poster.FORMATS.story.h,
    tier: 't1',
    sheetOpen: false,
    posterPath: '',
    format: 'story',
    style: 'glow',
    styles: Object.keys(poster.STYLES).map((k) => ({ key: k, name: poster.STYLES[k].name })),
    feedOk: true,
    nick: '',
    nickMax: NICK_MAX,
    city: null,
    undoShow: false,
    undoText: '',
    toastText: '',
    toastShow: false,
  },

  onLoad(query) {
    this.shapes = geo.prepare(RAW)
    this.inset = { viewBox: RAW.inset.viewBox, rings: geo.parsePath(RAW.inset.d) }
    this.byId = {}
    this.shapes.forEach((p) => { this.byId[p.id] = p })
    this.st = store.load(this.byId, CITIES)

    const win = wx.getWindowInfo()
    this.dpr = win.pixelRatio || 2

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
      regions: stats.REGIONS.map((r) => ({
        name: r.name,
        chips: r.ids.map((id) => ({ id, name: this.byId[id].name, drill: !!CITIES[id] })),
      })),
      mapW: winW,
      mapH,
      navPad: Math.round(menuTop + menuH + 12),
      menuTop: Math.round(menuTop),
      menuH: Math.round(menuH),
      // 自定义导航栏微信不给返回键。现在这页没入口，直接启动时不该画；
      // 以后从首页 navigateTo 过来就有栈了，得画
      canBack: getCurrentPages().length > 1,
      nick: this.st.nick,
      style: this.st.style,
      feedOk: poster.STYLES[this.st.style].feed,
    })

    // 右上角「…」默认只有转发给朋友，朋友圈要显式打开
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })

    this.loadFriend(query && query.v)
    this.refresh(false)
    // 云同步还没接，sync.pull 永远返回 null；接上以后在这里合并
    sync.pull()
  },

  onReady() {
    this.initMapCanvas()
  },

  onUnload() {
    if (this.toastTimer) clearTimeout(this.toastTimer)
    if (this.undoTimer) clearTimeout(this.undoTimer)
  },

  /* ---------------- 分享 ---------------- */

  /** 链接里带上自己的点亮记录，好友打开就能对比。只带省，不带城市和想去 */
  shareCode() {
    return share.encode(ORDER, (id) => this.st.lit[id] !== undefined)
  },

  shareTitle() {
    const n = Object.keys(this.st.lit).length
    return n ? '我点亮了 ' + n + ' 个省，你去过几个？' : '点亮你去过的省份，看看超过全国多少人'
  },

  onShareAppMessage() {
    return {
      title: this.shareTitle(),
      path: '/pages/travel-map/travel-map?v=' + this.shareCode(),
    }
  },

  /** 朋友圈打开的是「单页模式」，页面照常渲染，只是不能跳转、存储不落到用户自己的存档里 */
  onShareTimeline() {
    return {
      title: this.shareTitle(),
      query: 'v=' + this.shareCode(),
    }
  },

  /** 好友分享来的记录。解不开就当没带，不报错 */
  loadFriend(code) {
    const ids = share.decode(ORDER, code)
    this.friendSet = ids && ids.length ? new Set(ids) : null
    this.friendShowing = false
  },

  syncFriend() {
    const f = this.friendSet
    if (!f) {
      if (this.data.friend) this.setData({ friend: null })
      return
    }
    let both = 0
    let onlyThem = 0
    f.forEach((id) => { if (this.st.lit[id] !== undefined) both++; else onlyThem++ })
    this.setData({
      friend: { n: f.size, both, onlyThem, showing: this.friendShowing },
    })
  },

  onFriendToggle() {
    this.friendShowing = !this.friendShowing
    this.syncFriend()
    this.drawMap()
  },

  onFriendClose() {
    this.friendSet = null
    this.friendShowing = false
    this.syncFriend()
    this.drawMap()
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

  litSet() {
    return new Set(Object.keys(this.st.lit))
  },

  /** 虚线标记：在看好友对比时是「TA 去过」，否则是「想去」。两者不同时出现，免得分不清 */
  markSet() {
    if (this.friendSet && this.friendShowing) return this.friendSet
    return new Set(Object.keys(this.st.want))
  },

  drawMap() {
    const ctx = this.mapCtx
    if (!ctx) return
    ctx.clearRect(0, 0, this.mapCssW, this.mapCssH)
    paint.drawMap(ctx, this.shapes, this.litSet(), this.inset, 0, 0, this.mapCssW, this.markSet())
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

  /** 长按有城市数据的省份按钮，直接进城市选择 */
  onChipLongPress(e) {
    const id = e.currentTarget.dataset.id
    if (CITIES[id]) this.openCity(id)
  },

  onModeTap(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.mode) return
    this.setData({ mode })
    if (mode === 'want') this.toast('点省份标记想去的地方')
  },

  toggle(id) {
    const st = this.st
    const name = this.byId[id].name

    if (this.data.mode === 'want') {
      if (st.lit[id] !== undefined) {
        this.toast(name + ' 已经去过了')
        return
      }
      if (st.want[id] !== undefined) delete st.want[id]
      else st.want[id] = store.today()
      this.commit()
      return
    }

    if (st.lit[id] !== undefined) {
      // 取消点亮会连带清掉这个省的城市，城市是一个个点出来的，误触代价大，给撤销
      const n = st.cities[id] ? Object.keys(st.cities[id]).length : 0
      if (n) this.armUndo('已取消' + name + '，连同 ' + n + ' 个城市')
      delete st.lit[id]
      delete st.cities[id]
    } else {
      st.lit[id] = store.today()
      if (st.want[id] !== undefined) this.toast('目标达成：' + name + ' ✓')
    }
    this.commit()
  },

  /** 改完存档后统一走这里：存盘、换配色、重画、刷新数字 */
  commit() {
    // 撤销快照只对应 armUndo 之后紧跟的这一次改动。再往后又改了别的，
    // 快照就旧了 —— 这时候撤销会把后面的改动一起抹掉，所以直接收起撤销条
    if (this.undoArmed) this.undoArmed = false
    else if (this.undoSnap) this.dropUndo()
    store.save(this.st)
    sync.push(this.st)
    this.refresh(true)
  },

  /**
   * 配色跟着点亮省份数走（档位见 themes.js）。
   * applyTheme 必须在 drawMap 之前 —— paint.C 是模块级的，画之前定不下来就画错色。
   * 页面那边靠根节点的 t1…t5 类换 CSS 变量。
   */
  refresh(redraw) {
    const st = this.st
    const n = Object.keys(st.lit).length
    const t = themes.tierFor(n)
    paint.applyTheme(t)
    if (redraw) this.drawMap()

    const cover = stats.coverage(this.shapes, (id) => st.lit[id] !== undefined, RAW.totalArea)
    const litMap = {}
    Object.keys(st.lit).forEach((id) => { litMap[id] = true })
    const wantMap = {}
    let wantDone = 0
    Object.keys(st.want).forEach((id) => {
      wantMap[id] = true
      if (st.lit[id] !== undefined) wantDone++
    })
    const cityNum = {}
    Object.keys(st.cities).forEach((id) => { cityNum[id] = Object.keys(st.cities[id]).length })

    // 「细到城市」列表：点亮了、并且有城市数据的省
    const drill = this.shapes
      .filter((p) => st.lit[p.id] !== undefined && CITIES[p.id])
      .map((p) => ({ id: p.id, name: p.name, n: cityNum[p.id] || 0, total: CITIES[p.id].length }))

    this.setData({
      tier: t.key,
      litMap,
      wantMap,
      cityNum,
      drill,
      count: n,
      cities: store.cityCount(st),
      areaPct: cover.areaPct,
      popPct: cover.popPct,
      peoplePct: poster.PCT[n],
      persona: stats.persona(n, +cover.areaPct, +cover.popPct),
      yearNew: store.litThisYear(st, this.data.year),
      wantCount: Object.keys(st.want).length,
      wantDone,
    })
    this.syncFriend()
  },

  onClear() {
    const st = this.st
    if (!Object.keys(st.lit).length && !Object.keys(st.want).length) return
    wx.showModal({
      title: '清空全部记录？',
      content: '去过、想去和城市记录都会清掉。清空后 5 秒内可以撤销。',
      confirmText: '清空',
      confirmColor: '#FF5A4E',
      success: (r) => {
        if (!r.confirm) return
        this.armUndo('已清空')
        st.lit = {}
        st.want = {}
        st.cities = {}
        this.commit()
      },
    })
  },

  /* ---------------- 撤销 ---------------- */

  /** 在改动之前调：存一份快照，弹撤销条 */
  armUndo(text) {
    this.undoSnap = store.snapshot(this.st)
    this.undoArmed = true
    this.setData({ undoShow: true, undoText: text })
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.undoTimer = setTimeout(() => this.dropUndo(), UNDO_MS)
  },

  dropUndo() {
    this.undoSnap = null
    this.undoArmed = false
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.undoTimer = null
    if (this.data.undoShow) this.setData({ undoShow: false })
  },

  onUndo() {
    if (!this.undoSnap) return
    const snap = this.undoSnap
    this.dropUndo()
    this.st = snap
    this.commit()
    this.toast('已撤销')
  },

  /* ---------------- 城市 ---------------- */

  onDrillTap(e) {
    this.openCity(e.currentTarget.dataset.id)
  },

  openCity(id) {
    const list = CITIES[id]
    if (!list) return
    const picked = this.st.cities[id] || {}
    this.setData({
      city: {
        id,
        name: this.byId[id].name,
        list: list.map((n) => ({ n, on: picked[n] !== undefined })),
        count: Object.keys(picked).length,
      },
    })
  },

  /** 选城市会顺带点亮所在的省 —— 去过这个城市就一定去过这个省 */
  onCityTap(e) {
    const c = this.data.city
    if (!c) return
    const name = e.currentTarget.dataset.n
    const st = this.st
    const picked = st.cities[c.id] || (st.cities[c.id] = {})
    if (picked[name] !== undefined) {
      delete picked[name]
      if (!Object.keys(picked).length) delete st.cities[c.id]
    } else {
      picked[name] = store.today()
      if (st.lit[c.id] === undefined) {
        st.lit[c.id] = store.today()
        this.toast('已同时点亮' + c.name)
      }
    }
    const now = st.cities[c.id] || {}
    this.setData({
      'city.list': c.list.map((it) => ({ n: it.n, on: now[it.n] !== undefined })),
      'city.count': Object.keys(now).length,
    })
    this.commit()
  },

  onCityAll() {
    const c = this.data.city
    if (!c) return
    const st = this.st
    const all = c.count < c.list.length
    if (all) {
      const picked = st.cities[c.id] || (st.cities[c.id] = {})
      c.list.forEach((it) => { if (picked[it.n] === undefined) picked[it.n] = store.today() })
      if (st.lit[c.id] === undefined) st.lit[c.id] = store.today()
    } else {
      delete st.cities[c.id]
    }
    const now = st.cities[c.id] || {}
    this.setData({
      'city.list': c.list.map((it) => ({ n: it.n, on: now[it.n] !== undefined })),
      'city.count': Object.keys(now).length,
    })
    this.commit()
  },

  onCityClose() {
    this.setData({ city: null })
  },

  /* ---------------- 出图 ---------------- */

  onExport() {
    this.setData({ sheetOpen: true, posterPath: '' })
    this.render()
  },

  onFormatTap(e) {
    const format = e.currentTarget.dataset.f
    if (format === this.data.format) return
    if (format === 'feed' && !this.data.feedOk) {
      this.toast(poster.STYLES[this.data.style].name + '只有长图')
      return
    }
    this.setData({ format, posterPath: '' })
    this.render()
  },

  /** 换样式。不支持 4:5 的样式会把版式拨回长图，记住选择下次直接用。
   *  出图中途切换也不丢：render 会在当前这张出完后按最新的选择再出一张 */
  onStyleTap(e) {
    const style = e.currentTarget.dataset.s
    if (style === this.data.style) return
    const feedOk = poster.STYLES[style].feed
    this.setData({
      style,
      feedOk,
      format: feedOk ? this.data.format : 'story',
      posterPath: '',
    })
    this.st.style = style
    store.save(this.st)
    this.render()
  },

  onNickInput(e) {
    this.setData({ nick: String(e.detail.value || '').slice(0, NICK_MAX) })
  },

  /** 失焦或回车才重出图，边打字边出图太卡 */
  onNickDone() {
    const nick = this.data.nick.trim()
    if (nick === this.st.nick) return
    this.st.nick = nick
    this.setData({ nick, posterPath: '' })
    store.save(this.st)
    this.render()
  },

  /** 出图画布的尺寸跟着版式变，必须等 setData 落到节点上再画，否则比例是错的 */
  render() {
    if (this.exporting) {
      this.renderAgain = true
      return
    }
    this.exporting = true
    this.renderAgain = false
    // 样式不支持 4:5 时按长图出，和 poster.draw 的兜底保持一致
    const format = this.data.feedOk ? this.data.format : 'story'
    const size = poster.FORMATS[format]
    wx.showLoading({ title: '生成中', mask: true })

    new Promise((resolve) => this.setData({ posterW: size.w, posterH: size.h }, resolve))
      .then(() => this.getPosterNode())
      .then((node) => this.loadCodeImage(node).then((img) => this.renderPoster(node, img, EXPORT_SCALE, format)))
      .catch((err) => {
        // 安卓上画布过大会直接生成失败，降一档重试一次
        console.warn('[travel-map] 出图失败，降级重试', err)
        return this.getPosterNode().then((node) => this.renderPoster(node, this._codeImage || null, 1, format))
      })
      .then((path) => {
        this.setData({ posterPath: path })
      })
      .catch((err) => {
        console.error('[travel-map] 出图失败', err)
        this.toast('生成失败，请重试')
      })
      .then(() => {
        wx.hideLoading()
        this.exporting = false
        // 出图过程中又改了版式或署名，补出一张最新的
        if (this.renderAgain && this.data.sheetOpen) this.render()
      })
  },

  renderPoster(node, codeImage, scale, format) {
    const size = poster.FORMATS[format]
    node.width = size.w * scale
    node.height = size.h * scale
    const ctx = node.getContext('2d')
    ctx.scale(scale, scale)

    const st = this.st
    poster.draw(ctx, {
      style: this.data.style,
      format,
      shapes: this.shapes,
      byId: this.byId,
      lit: this.litSet(),
      dates: st.lit,
      inset: this.inset,
      totalArea: RAW.totalArea,
      codeImage,
      nick: st.nick,
      cities: store.cityCount(st),
      next: this.shapes.filter((p) => st.want[p.id] !== undefined && st.lit[p.id] === undefined).map((p) => p.name),
    })

    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: node,
        x: 0,
        y: 0,
        // width/height 是逻辑坐标（ctx 已 scale），destWidth/destHeight 才是出图像素
        width: size.w,
        height: size.h,
        destWidth: size.w * scale,
        destHeight: size.h * scale,
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
