/**
 * Minimal Bilibili web API client used by the plugin host.
 *
 * It deliberately depends on nothing but Node's fetch. Only the endpoints the
 * plugin needs are implemented:
 *   - QR login (passport web)
 *   - personalized recommendation feed (WBI signed)
 *   - video detail / tags / subtitles
 *   - favorite folder list, create, and add
 *
 * Cookies never leave this module except through `snapshotCookies()` for the
 * host's 0600 credentials file.
 */
import { createHash } from 'node:crypto'
import {
  abortError,
  cookieHeader,
  mergeSetCookieJar,
  normalizeCover,
  sleep,
} from './util.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const API = 'https://api.bilibili.com'
const PASSPORT = 'https://passport.bilibili.com'
const REFERER = 'https://www.bilibili.com/'

const WBI_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

const SUBTITLE_HOSTS = [/(^|\.)hdslb\.com$/i, /(^|\.)bilibili\.com$/i]

const AUTH_COOKIES = [
  'SESSDATA',
  'bili_jct',
  'DedeUserID',
  'DedeUserID__ckMd5',
  'sid',
]

export class BiliError extends Error {
  constructor(message, { code = -1, status = 0, data = null } = {}) {
    super(message)
    this.name = 'BiliError'
    this.code = code
    this.status = status
    this.data = data
  }
}

function describeCode(code, message) {
  const extra = message && message !== '0' ? `：${message}` : ''
  switch (Number(code)) {
    case -101:
      return 'B站账号未登录或登录已过期，请重新扫码'
    case -111:
      return 'B站 CSRF 校验失败（缺少 bili_jct），请重新扫码登录'
    case -352:
      return 'B站风控校验失败（-352），请稍后再试'
    case -412:
      return '请求被 B站风控拦截（-412），请稍后在浏览器里正常刷一会儿再试'
    case -400:
      return `B站请求参数有误${extra}`
    case -403:
      return `B站拒绝访问（-403）${extra}`
    case 11001:
      return 'B站账号未登录，请先扫码登录'
    case 11201:
      return '这个视频已经在收藏夹里了'
    default:
      return `B站接口返回 ${code}${extra}`
  }
}

function md5(value) {
  return createHash('md5').update(value).digest('hex')
}

function parseJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export class BiliApi {
  constructor({ cookies = {}, user = null, log = () => {} } = {}) {
    this.cookies = { ...cookies }
    this.user = user ?? null
    this.log = log
    this.wbi = null
    this.wbiFetchedAt = 0
  }

  get loggedIn() {
    return Boolean(this.cookies.SESSDATA && this.cookies.bili_jct)
  }

  get mid() {
    const value = Number(this.user?.mid || this.cookies.DedeUserID || 0)
    return Number.isFinite(value) ? value : 0
  }

  get csrf() {
    return typeof this.cookies.bili_jct === 'string' ? this.cookies.bili_jct : ''
  }

  snapshotCookies() {
    return { ...this.cookies }
  }

  setUser(user) {
    this.user = user ?? null
  }

  cookiesFromLoginUrl(loginUrl) {
    try {
      const url = new URL(loginUrl)
      for (const name of AUTH_COOKIES) {
        const value = url.searchParams.get(name)
        if (value) this.cookies[name] = value
      }
    } catch {
      /* a malformed success URL is not fatal when Set-Cookie already arrived */
    }
  }

  async #raw(
    url,
    { method = 'GET', body, headers = {}, signal, timeoutMs = 18000, redirect = 'follow' } = {},
  ) {
    const controller = new AbortController()
    const onAbort = () => controller.abort(signal?.reason)
    if (signal) {
      if (signal.aborted) throw abortError(signal)
      signal.addEventListener('abort', onAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(new Error('请求超时')), timeoutMs)
    const requestHeaders = {
      'User-Agent': UA,
      Referer: REFERER,
      Accept: 'application/json, text/plain, */*',
      ...headers,
    }
    const cookie = cookieHeader(this.cookies)
    if (cookie) requestHeaders.Cookie = cookie
    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body,
        redirect,
        signal: controller.signal,
      })
      mergeSetCookieJar(this.cookies, response.headers)
      const text = await response.text()
      const json = parseJson(text)
      if (response.status >= 300 && response.status < 400) {
        return {
          json: null,
          status: response.status,
          redirect: response.headers.get('location') || '',
        }
      }
      if (!response.ok) {
        const reason =
          response.status === 412
            ? '请求被 B站风控拦截（412），请稍后再试'
            : `B站请求失败（HTTP ${response.status}）`
        throw new BiliError(reason, {
          code: json?.code ?? -1,
          status: response.status,
          data: json,
        })
      }
      if (json === null) {
        throw new BiliError('B站返回了无法解析的内容，请稍后再试', {
          code: -1,
          status: response.status,
        })
      }
      return { json, status: response.status }
    } catch (error) {
      if (error instanceof BiliError) throw error
      if (controller.signal.aborted && signal?.aborted) throw abortError(signal)
      if (controller.signal.aborted) {
        throw new BiliError('连接 B站超时，请检查网络后重试', { code: -1 })
      }
      throw new BiliError(`连接 B站失败：${error?.message ?? error}`, { code: -1 })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }
  }

  expectOk(json, action) {
    if (json?.code === 0) return json.data
    const code = Number(json?.code ?? -1)
    const error = new BiliError(`${action}失败：${describeCode(code, json?.message)}`, {
      code,
      data: json,
    })
    throw error
  }

  async nav({ signal } = {}) {
    const { json } = await this.#raw(`${API}/x/web-interface/nav`, { signal })
    const data = json?.data
    if (data?.wbi_img?.img_url && data?.wbi_img?.sub_url) {
      this.#rememberWbi(data.wbi_img)
    }
    if (json?.code === 0 && data?.isLogin) {
      this.user = {
        mid: Number(data.mid) || 0,
        uname: String(data.uname || ''),
        face: normalizeCover(data.face || ''),
        level: Number(data.level_info?.current_level) || 0,
      }
    } else if (json?.code === -101) {
      this.user = null
    }
    return { code: Number(json?.code), data, json }
  }

  #rememberWbi(img) {
    try {
      const imgKey = String(img.img_url).split('/').pop().split('.')[0]
      const subKey = String(img.sub_url).split('/').pop().split('.')[0]
      if (!imgKey || !subKey) return
      const mixed = WBI_TAB.map((index) => (imgKey + subKey)[index] || '').join('').slice(0, 32)
      if (mixed.length === 32) {
        this.wbi = mixed
        this.wbiFetchedAt = Date.now()
      }
    } catch {
      /* keep the previous key */
    }
  }

  async ensureWbi({ signal, maxAgeMs = 30 * 60 * 1000 } = {}) {
    if (this.wbi && Date.now() - this.wbiFetchedAt < maxAgeMs) return this.wbi
    const { code } = await this.nav({ signal })
    if (this.wbi) return this.wbi
    throw new BiliError(`获取 B站 WBI 签名密钥失败（nav code ${code}）`, { code })
  }

  signedQuery(params, mixinKey) {
    const withTimestamp = {
      ...params,
      wts: Math.floor(Date.now() / 1000),
    }
    const query = Object.keys(withTimestamp)
      .sort()
      .map((key) => {
        const raw = String(withTimestamp[key] ?? '').replace(/[!'()*]/g, '')
        return `${encodeURIComponent(key)}=${encodeURIComponent(raw)}`
      })
      .join('&')
    return `${query}&w_rid=${md5(query + mixinKey)}`
  }

  async #signedGet(path, params, { signal, timeoutMs } = {}) {
    const mixin = await this.ensureWbi({ signal })
    const query = this.signedQuery(params, mixin)
    const { json } = await this.#raw(`${API}${path}?${query}`, { signal, timeoutMs })
    return json
  }

  async #postForm(path, form, { signal, timeoutMs } = {}) {
    const body = new URLSearchParams()
    for (const [key, value] of Object.entries(form)) {
      if (value !== undefined && value !== null) body.set(key, String(value))
    }
    const { json } = await this.#raw(`${API}${path}`, {
      method: 'POST',
      signal,
      timeoutMs,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: REFERER.slice(0, -1),
      },
      body: body.toString(),
    })
    return json
  }

  async feed({ ps = 20, freshIdx = 1, brush = 0, signal } = {}) {
    const json = await this.#signedGet(
      '/x/web-interface/wbi/index/top/feed/rcmd',
      {
        web_location: 1430650,
        feed_version: 'V8',
        fresh_type: 4,
        ps: Math.min(30, Math.max(1, Number(ps) || 20)),
        plat: 0,
        fresh_idx: Math.max(1, Number(freshIdx) || 1),
        brush: Math.max(0, Number(brush) || 0),
        y_num: 5,
        homepage_ver: 1,
        screen: '1920-1080',
      },
      { signal, timeoutMs: 22000 },
    )
    const data = this.expectOk(json, '获取推荐流')
    const items = Array.isArray(data?.item) ? data.item : []
    return items
      .filter((item) => item && item.goto === 'av' && item.bvid && item.cid)
      .map((item) => ({
        bvid: String(item.bvid),
        aid: Number(item.id) || 0,
        cid: Number(item.cid) || 0,
        title: String(item.title || '').trim(),
        cover: normalizeCover(item.pic || ''),
        duration: Number(item.duration) || 0,
        pubdate: Number(item.pubdate) || 0,
        author: String(item.owner?.name || '').trim(),
        authorMid: Number(item.owner?.mid) || 0,
        view: Number(item.stat?.view) || 0,
        like: Number(item.stat?.like) || 0,
        danmaku: Number(item.stat?.danmaku) || 0,
        followed: Number(item.is_followed) === 1,
        rcmdReason: String(item.rcmd_reason || '').trim(),
        trackId: String(item.track_id || ''),
      }))
  }

  async video(bvid, { signal } = {}) {
    const { json } = await this.#raw(
      `${API}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      { signal },
    )
    const data = this.expectOk(json, '读取视频信息')
    return {
      aid: Number(data.aid) || 0,
      cid: Number(data.cid) || 0,
      bvid: String(data.bvid || bvid),
      title: String(data.title || '').trim(),
      desc: String(data.desc || '').trim(),
      cover: normalizeCover(data.pic || ''),
      duration: Number(data.duration) || 0,
      pubdate: Number(data.pubdate) || 0,
      author: String(data.owner?.name || '').trim(),
      authorMid: Number(data.owner?.mid) || 0,
      category: String(data.tname || '').trim(),
      view: Number(data.stat?.view) || 0,
      like: Number(data.stat?.like) || 0,
      danmaku: Number(data.stat?.danmaku) || 0,
      reply: Number(data.stat?.reply) || 0,
    }
  }

  async tags(bvid, { signal } = {}) {
    const { json } = await this.#raw(
      `${API}/x/tag/archive/tags?bvid=${encodeURIComponent(bvid)}`,
      { signal, timeoutMs: 12000 },
    )
    if (json?.code !== 0) return []
    return (Array.isArray(json.data) ? json.data : [])
      .map((tag) => String(tag?.tag_name || '').trim())
      .filter(Boolean)
      .slice(0, 16)
  }

  /**
   * Return the first usable subtitle text for a video. Anonymous requests
   * usually get an empty list, so callers can skip this when logged out.
   */
  async subtitle({ aid, cid }, { signal, maxChars = 2200 } = {}) {
    if (!aid || !cid) return { text: '', lan: '', lines: 0 }
    let data = null
    try {
      const json = await this.#signedGet(
        '/x/player/wbi/v2',
        { aid, cid },
        { signal, timeoutMs: 15000 },
      )
      if (json?.code === 0) data = json.data
    } catch (error) {
      if (error?.name === 'AbortError') throw error
    }
    if (!data) {
      try {
        const { json } = await this.#raw(
          `${API}/x/player/v2?aid=${encodeURIComponent(aid)}&cid=${encodeURIComponent(cid)}`,
          { signal, timeoutMs: 15000 },
        )
        if (json?.code === 0) data = json.data
      } catch (error) {
        if (error?.name === 'AbortError') throw error
      }
    }
    const subtitles = Array.isArray(data?.subtitle?.subtitles) ? data.subtitle.subtitles : []
    if (!subtitles.length) return { text: '', lan: '', lines: 0 }
    const preferred =
      subtitles.find((item) => /^zh/i.test(String(item?.lan || ''))) ||
      subtitles.find((item) => /ai-zh|中文|chinese/i.test(String(item?.lan || ''))) ||
      subtitles[0]
    const rawUrl = String(preferred?.subtitle_url || '')
    if (!rawUrl) return { text: '', lan: String(preferred?.lan || ''), lines: 0 }
    let url
    try {
      url = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl)
    } catch {
      return { text: '', lan: String(preferred?.lan || ''), lines: 0 }
    }
    if (!SUBTITLE_HOSTS.some((pattern) => pattern.test(url.hostname))) {
      this.log(`忽略非 B站域名的字幕地址：${url.hostname}`)
      return { text: '', lan: String(preferred?.lan || ''), lines: 0 }
    }
    try {
      // Never send B站 auth cookies to the subtitle CDN: it is a different
      // registrable domain and the request works without credentials.
      const headers = { 'User-Agent': UA, Referer: REFERER, Accept: '*/*' }
      const response = await fetch(url, {
        headers,
        signal: signal ?? AbortSignal.timeout(15000),
      })
      if (!response.ok) return { text: '', lan: String(preferred?.lan || ''), lines: 0 }
      const body = await response.json()
      const lines = Array.isArray(body?.body) ? body.body : []
      const text = lines
        .map((line) => String(line?.content || '').trim())
        .filter(Boolean)
        .join('\n')
      return {
        text: text.slice(0, maxChars),
        lan: String(preferred?.lan || ''),
        lines: lines.length,
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      this.log(`读取字幕失败（不是致命错误）：${error?.message ?? error}`)
      return { text: '', lan: String(preferred?.lan || ''), lines: 0 }
    }
  }

  async folders({ signal } = {}) {
    if (!this.mid) throw new BiliError('还没有拿到你的 B站 UID，请重新登录', { code: -101 })
    const { json } = await this.#raw(
      `${API}/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(this.mid)}&web_location=333.1387`,
      { signal },
    )
    const data = this.expectOk(json, '读取收藏夹列表')
    const list = Array.isArray(data?.list) ? data.list : []
    return list
      .map((folder) => ({
        id: Number(folder?.id || folder?.fid) || 0,
        title: String(folder?.title || '').trim(),
        mediaCount: Number(folder?.media_count) || 0,
        privacy: Number(folder?.privacy ?? folder?.attr ?? 0) === 1 ? 'private' : 'public',
      }))
      .filter((folder) => folder.id > 0)
  }

  async createFolder(title, { signal } = {}) {
    if (!this.loggedIn) throw new BiliError('请先扫码登录，再创建收藏夹', { code: -101 })
    const json = await this.#postForm(
      '/x/v3/fav/folder/add',
      { title, privacy: 0, csrf: this.csrf, platform: 'web' },
      { signal },
    )
    const data = this.expectOk(json, '创建收藏夹')
    const id = Number(data?.id || data?.fid || 0)
    if (!id) throw new BiliError('收藏夹创建成功但没有返回 id', { code: -1, data })
    return { id, title }
  }

  async ensureFolder(name, { signal } = {}) {
    const folders = await this.folders({ signal })
    const found = folders.find((folder) => folder.title === name)
    if (found) return { ...found, created: false }
    const created = await this.createFolder(name, { signal })
    return {
      id: created.id,
      title: created.title,
      mediaCount: 0,
      privacy: 'public',
      created: true,
    }
  }

  async favorite(aid, folderId, { signal } = {}) {
    if (!this.loggedIn) throw new BiliError('请先扫码登录，再收藏视频', { code: -101 })
    const json = await this.#postForm(
      '/x/v3/fav/resource/deal',
      {
        rid: aid,
        type: 2,
        add_media_ids: folderId,
        del_media_ids: '',
        csrf: this.csrf,
        platform: 'web',
      },
      { signal, timeoutMs: 18000 },
    )
    if (json?.code === 0) return true
    if (Number(json?.code) === 11201) return true
    const code = Number(json?.code ?? -1)
    throw new BiliError(`收藏失败：${describeCode(code, json?.message)}`, { code, data: json })
  }

  async qrStart({ signal } = {}) {
    const { json } = await this.#raw(
      `${PASSPORT}/x/passport-login/web/qrcode/generate?source=main-fe-header`,
      { signal },
    )
    const data = this.expectOk(json, '生成登录二维码')
    if (!data?.qrcode_key || !data?.url) {
      throw new BiliError('生成二维码失败：B站没有返回 qrcode_key', { code: -1, data })
    }
    return { key: String(data.qrcode_key), url: String(data.url) }
  }

  async qrPoll(key, { signal } = {}) {
    const { json, redirect } = await this.#raw(
      `${PASSPORT}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}&source=main-fe-header`,
      { signal, timeoutMs: 12000, redirect: 'manual' },
    )
    if (!json && redirect) {
      // Some passport deployments answer with a redirect after confirmation.
      return this.cookies.SESSDATA
        ? { state: 'confirmed', code: 0, message: '登录成功' }
        : { state: 'error', code: -1, message: '登录跳转异常，请重新生成二维码' }
    }
    if (json?.code !== 0) {
      return {
        state: 'error',
        code: Number(json?.code ?? -1),
        message: describeCode(json?.code, json?.message),
      }
    }
    const data = json.data || {}
    const inner = Number(data.code)
    if (inner === 0) {
      this.cookiesFromLoginUrl(data.url)
      return { state: 'confirmed', code: 0, message: '登录成功' }
    }
    if (inner === 86090) return { state: 'scanned', code: inner, message: '已扫码，请在手机上确认' }
    if (inner === 86038) return { state: 'expired', code: inner, message: '二维码已过期，请重新生成' }
    if (inner === 86101) return { state: 'pending', code: inner, message: '等待扫码' }
    return {
      state: 'pending',
      code: inner,
      message: String(data.message || '等待扫码').slice(0, 120),
    }
  }

  /** Fetch buvid cookies so subsequent API calls look like a normal browser. */
  async fingerprint({ signal } = {}) {
    try {
      const { json } = await this.#raw('https://api.bilibili.com/x/frontend/finger/spi', {
        signal,
        timeoutMs: 10000,
      })
      if (json?.code === 0) {
        if (json.data?.b_3) this.cookies.buvid3 = String(json.data.b_3)
        if (json.data?.b_4) this.cookies.buvid4 = String(json.data.b_4)
        this.cookies.b_nut = String(Math.floor(Date.now() / 1000))
      }
    } catch {
      /* buvid is helpful but optional */
    }
  }

  /** A single retry for transient network failures on read-only calls. */
  async withRetry(operation, { attempts = 2, signal } = {}) {
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        if (error?.name === 'AbortError' || signal?.aborted) throw abortError(signal)
        if (error?.code === -101 || error?.code === -111 || error?.status === 412) throw error
        if (attempt < attempts) await sleep(600, signal)
      }
    }
    throw lastError
  }
}
