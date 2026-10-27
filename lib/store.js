/**
 * Durable plugin state: preferences, credentials, history and the seen map.
 * Files live in the plugin's own home directory; the credentials file is 0600.
 */
import { join } from 'node:path'
import {
  clampInt,
  clampText,
  ensureDir,
  localDayKey,
  randomId,
  readJson,
  removeFile,
  writeJson,
} from './util.js'

export const DEFAULT_GUIDANCE = ''

export const DEFAULT_CONFIG = Object.freeze({
  /** Optional hint for the model; empty means "your own taste only". */
  guidance: DEFAULT_GUIDANCE,
  /** How many candidates one round pulls from the feed. */
  scan: 20,
  /** How many candidates the model may open and read in depth. */
  deepRead: 8,
  /** How many videos the model may finally favorite. */
  count: 5,
  /** Delivery: favorite / DSH session / external channel / both. */
  deliveryMode: 'session',
  /** Favorite folder name; created as a public folder when missing. */
  folderName: '大肥鱼推荐',
  /** Selected delivery channel id (session by default). */
  channelId: 'session',
  /** Per-channel option objects, keyed by channel id. */
  channelOptions: {},
  /** Read subtitles for the videos the model opens. */
  readSubtitles: true,
  /** Optional daily autonomous run (host local time). */
  autoRun: { enabled: false, time: '12:30' },
})

const CONFIG_FILE = 'config.json'
const CREDENTIALS_FILE = 'credentials.json'
const STATE_FILE = 'state.json'

export function paths(home) {
  return {
    home,
    config: join(home, CONFIG_FILE),
    credentials: join(home, CREDENTIALS_FILE),
    state: join(home, STATE_FILE),
    log: join(home, 'bili-fav.log'),
  }
}

export function sanitizeChannelOptions(input) {
  const output = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return output
  for (const [channelId, rawOptions] of Object.entries(input).slice(0, 20)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(channelId)) continue
    if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) continue
    const clean = {}
    for (const [key, value] of Object.entries(rawOptions).slice(0, 30)) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(key)) continue
      if (typeof value === 'string') clean[key] = value.slice(0, 500)
      else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value
      else if (typeof value === 'boolean') clean[key] = value
    }
    output[channelId] = clean
  }
  return output
}

export function sanitizeConfig(input = {}) {
  const raw = input && typeof input === 'object' ? input : {}
  const time = typeof raw.autoRun?.time === 'string' ? raw.autoRun.time.trim() : ''
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : DEFAULT_CONFIG.autoRun.time
  const channelOptions = sanitizeChannelOptions(raw.channelOptions)
  const legacyQQ = {
    target: clampText(raw.qqTarget, 200, ''),
    scope: ['auto', 'group', 'c2c'].includes(raw.qqScope) ? raw.qqScope : 'auto',
    tool: clampText(raw.qqTool, 80, ''),
  }
  const hasLegacyQQ = Boolean(legacyQQ.target || legacyQQ.tool || raw.deliveryMode === 'qq')
  if (hasLegacyQQ && !channelOptions.qq) channelOptions.qq = legacyQQ
  const deliveryMode =
    raw.deliveryMode === 'qq'
      ? 'channel'
      : ['favorite', 'channel', 'both', 'session'].includes(raw.deliveryMode)
        ? raw.deliveryMode
        : DEFAULT_CONFIG.deliveryMode
  return {
    guidance: clampText(raw.guidance, 4000, DEFAULT_CONFIG.guidance),
    scan: clampInt(raw.scan, 5, 30, DEFAULT_CONFIG.scan),
    deepRead: clampInt(raw.deepRead, 1, 15, DEFAULT_CONFIG.deepRead),
    count: clampInt(raw.count, 1, 10, DEFAULT_CONFIG.count),
    deliveryMode,
    folderName: clampText(raw.folderName, 20, DEFAULT_CONFIG.folderName) || DEFAULT_CONFIG.folderName,
    channelId:
      clampText(raw.channelId, 40, '') ||
      (hasLegacyQQ ? 'qq' : deliveryMode === 'session' ? 'session' : ''),
    channelOptions,
    readSubtitles: raw.readSubtitles === undefined ? DEFAULT_CONFIG.readSubtitles : Boolean(raw.readSubtitles),
    autoRun: {
      enabled: Boolean(raw.autoRun?.enabled),
      time: validTime,
    },
  }
}

export function loadConfig(home) {
  const file = paths(home).config
  const stored = readJson(file, null)
  if (!stored) {
    const initial = sanitizeConfig(DEFAULT_CONFIG)
    saveConfig(home, initial)
    return initial
  }
  return sanitizeConfig(stored)
}

export function saveConfig(home, patch) {
  const file = paths(home).config
  const current = readJson(file, {}) || {}
  const next = sanitizeConfig({
    ...current,
    ...patch,
    channelOptions: { ...(current.channelOptions || {}), ...(patch?.channelOptions || {}) },
    autoRun: { ...current.autoRun, ...patch?.autoRun },
  })
  writeJson(file, next)
  return next
}

export function loadCredentials(home) {
  const file = paths(home).credentials
  const stored = readJson(file, null)
  if (!stored || typeof stored !== 'object') return null
  const cookies = stored.cookies && typeof stored.cookies === 'object' ? stored.cookies : {}
  if (!cookies.SESSDATA || !cookies.bili_jct) return null
  const user =
    stored.user && typeof stored.user === 'object'
      ? {
          mid: Number(stored.user.mid) || 0,
          uname: String(stored.user.uname || ''),
          face: String(stored.user.face || ''),
          level: Number(stored.user.level) || 0,
        }
      : null
  if (!user?.mid) return null
  return {
    cookies,
    user,
    savedAt: String(stored.savedAt || ''),
  }
}

export function saveCredentials(home, credentials) {
  ensureDir(home)
  const payload = {
    cookies: credentials.cookies,
    user: credentials.user,
    savedAt: new Date().toISOString(),
  }
  writeJson(paths(home).credentials, payload, { secret: true })
  return payload
}

export function clearCredentials(home) {
  removeFile(paths(home).credentials)
}

function sanitizePick(pick) {
  if (!pick || typeof pick !== 'object') return null
  const bvid = clampText(pick.bvid, 24, '')
  if (!/^BV[0-9A-Za-z]{8,}$/.test(bvid)) return null
  return {
    bvid,
    title: clampText(pick.title, 200, bvid),
    author: clampText(pick.author, 80, ''),
    cover: clampText(pick.cover, 500, ''),
    duration: clampInt(pick.duration, 0, 24 * 3600, 0),
    view: clampInt(pick.view, 0, 10 ** 12, 0),
    like: clampInt(pick.like, 0, 10 ** 12, 0),
    category: clampText(pick.category, 40, ''),
    reason: clampText(pick.reason, 300, ''),
    why: clampText(pick.why, 300, ''),
    subtitleLines: clampInt(pick.subtitleLines, 0, 10000, 0),
    subtitleChars: clampInt(pick.subtitleChars, 0, 10000, 0),
    status: ['saved', 'pushed', 'failed', 'preview', 'skipped'].includes(pick.status)
      ? pick.status
      : 'preview',
    error: clampText(pick.error, 300, ''),
    folderId: clampInt(pick.folderId, 0, Number.MAX_SAFE_INTEGER, 0),
    addedAt: clampText(pick.addedAt, 40, ''),
  }
}

function sanitizeRun(run) {
  if (!run || typeof run !== 'object') return null
  const picks = Array.isArray(run.picks) ? run.picks.map(sanitizePick).filter(Boolean).slice(0, 20) : []
  const shortlist = Array.isArray(run.shortlist)
    ? run.shortlist
        .map((item) => ({
          bvid: clampText(item?.bvid, 24, ''),
          title: clampText(item?.title, 200, ''),
          why: clampText(item?.why, 300, ''),
          subtitleLines: clampInt(item?.subtitleLines, 0, 10000, 0),
          subtitleChars: clampInt(item?.subtitleChars, 0, 10000, 0),
        }))
        .filter((item) => /^BV[0-9A-Za-z]{8,}$/.test(item.bvid))
        .slice(0, 20)
    : []
  return {
    id: clampText(run.id, 60, randomId()),
    startedAt: clampText(run.startedAt, 40, ''),
    finishedAt: clampText(run.finishedAt, 40, ''),
    trigger: ['manual', 'auto', 'tool'].includes(run.trigger) ? run.trigger : 'manual',
    dryRun: Boolean(run.dryRun),
    status: ['ok', 'partial', 'error', 'cancelled', 'running'].includes(run.status) ? run.status : 'error',
    scanned: clampInt(run.scanned, 0, 1000, 0),
    considered: clampInt(run.considered, 0, 1000, 0),
    watched: clampInt(run.watched, 0, 1000, 0),
    subtitleVideos: clampInt(run.subtitleVideos, 0, 1000, 0),
    model: clampText(run.model, 120, ''),
    folder: clampText(run.folder, 40, ''),
    delivery: run.delivery === 'qq' ? 'channel' : (['favorite', 'channel', 'both', 'session'].includes(run.delivery) ? run.delivery : 'session'),
    channelId: clampText(run.channelId, 40, '') || (run.qqTarget || run.qqSent || run.qqError ? 'qq' : ''),
    channelLabel: clampText(run.channelLabel, 80, '') || (run.qqTarget ? 'QQ Bot' : ''),
    channelSent: clampInt(run.channelSent ?? run.qqSent, 0, 20, 0),
    channelMessage: clampText(run.channelMessage ?? run.qqMessage, 500, ''),
    channelError: clampText(run.channelError ?? run.qqError, 500, ''),
    note: clampText(run.note, 500, ''),
    error: clampText(run.error, 500, ''),
    picks,
    shortlist,
  }
}

export function emptyState() {
  return {
    version: 1,
    seen: {},
    runs: [],
    folder: null,
    autoLastDay: '',
    freshIdx: 1,
  }
}

export function loadState(home) {
  const file = paths(home).state
  const stored = readJson(file, null)
  if (!stored || typeof stored !== 'object') return emptyState()
  const state = emptyState()
  if (stored.seen && typeof stored.seen === 'object') {
    for (const [bvid, timestamp] of Object.entries(stored.seen)) {
      if (/^BV[0-9A-Za-z]{8,}$/.test(bvid) && Number.isFinite(Number(timestamp))) {
        state.seen[bvid] = Number(timestamp)
      }
    }
  }
  if (Array.isArray(stored.runs)) {
    state.runs = stored.runs.map(sanitizeRun).filter(Boolean).slice(0, 30)
    for (const run of state.runs) {
      if (run.status === 'running') {
        run.status = 'error'
        run.finishedAt = run.finishedAt || new Date().toISOString()
        run.error = run.error || '上一次运行被中断（插件或进程重启了）'
        run.note = run.note || '这不一定是 B站 的问题；可以重新试一轮。'
      }
    }
  }
  if (stored.folder && typeof stored.folder === 'object') {
    const fid = Number(stored.folder.id)
    const mid = Number(stored.folder.mid)
    if (fid > 0 && mid > 0) {
      state.folder = {
        id: fid,
        mid,
        title: clampText(stored.folder.title, 40, ''),
        updatedAt: clampText(stored.folder.updatedAt, 40, ''),
      }
    }
  }
  state.autoLastDay = clampText(stored.autoLastDay, 20, '')
  state.freshIdx = clampInt(stored.freshIdx, 1, 10 ** 6, 1)
  return state
}

export function saveState(home, state) {
  const now = Date.now()
  const seen = {}
  for (const [bvid, timestamp] of Object.entries(state.seen || {})) {
    const value = Number(timestamp)
    if (value && now - value < 14 * 24 * 3600 * 1000) seen[bvid] = value
  }
  const entries = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 2000)
  state.seen = Object.fromEntries(entries)
  state.runs = (state.runs || []).slice(0, 30)
  writeJson(paths(home).state, state)
}

export function appendRun(home, state, run) {
  const sanitized = sanitizeRun(run)
  if (!sanitized) return null
  state.runs.unshift(sanitized)
  state.runs = state.runs.slice(0, 30)
  saveState(home, state)
  return sanitized
}

export function rememberFolder(home, state, folder, mid) {
  state.folder = {
    id: Number(folder.id) || 0,
    mid: Number(mid) || 0,
    title: clampText(folder.title, 40, ''),
    updatedAt: new Date().toISOString(),
  }
  saveState(home, state)
}

export function seenRecently(state, bvid, days = 14) {
  const timestamp = Number(state.seen?.[bvid])
  return Boolean(timestamp) && Date.now() - timestamp < days * 24 * 3600 * 1000
}

export function markSeen(state, bvid) {
  state.seen[bvid] = Date.now()
}

export function folderLink(mid, fid) {
  if (!mid || !fid) return ''
  return `https://space.bilibili.com/${mid}/favlist?fid=${fid}`
}

export function todayKey() {
  return localDayKey()
}
