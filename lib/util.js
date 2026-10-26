/**
 * Small, dependency-free helpers shared by the host half of dsh-bili-fav.
 *
 * Everything the plugin owns lives under `<DSH_HOME>/bili-fav/`:
 *   config.json       user preferences (not secrets)
 *   credentials.json  B站 cookies (0600)
 *   state.json        seen videos, run history, folder cache
 *   bili-fav.log      human-readable diagnostics (no cookies)
 */
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PLUGIN_DIR_NAME = 'bili-fav'

/** Resolve the plugin's own home directory, preferring the host's dshHomePath service. */
export function resolveHomeDir(ctx) {
  let base = ''
  try {
    const value = typeof ctx?.get === 'function' ? ctx.get('dshHomePath') : undefined
    if (typeof value === 'function') {
      const resolved = value(PLUGIN_DIR_NAME)
      if (resolved) base = String(resolved)
    } else if (typeof value === 'string' && value) {
      base = join(value, PLUGIN_DIR_NAME)
    }
  } catch {
    /* fall back to the environment below */
  }
  if (!base) base = join(process.env.DSH_HOME || join(homedir(), '.dsh'), PLUGIN_DIR_NAME)
  ensureDir(base)
  return base
}

export function ensureDir(dir, mode = 0o700) {
  try {
    mkdirSync(dir, { recursive: true, mode })
    try {
      chmodSync(dir, mode)
    } catch {
      /* best effort on filesystems without POSIX modes */
    }
  } catch (error) {
    throw new Error(`无法创建插件目录 ${dir}：${error?.message ?? error}`)
  }
  return dir
}

export function readJson(file, fallback) {
  try {
    const raw = readFileSync(file, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

/** Write JSON through a temp file so a crash cannot leave a half-written file. */
export function writeJson(file, value, { secret = false } = {}) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  const mode = secret ? 0o600 : 0o600
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode })
  try {
    renameSync(temp, file)
  } catch (error) {
    try {
      unlinkSync(temp)
    } catch {
      /* ignore cleanup failure */
    }
    throw error
  }
  try {
    chmodSync(file, mode)
  } catch {
    /* best effort */
  }
}

export function removeFile(file) {
  try {
    if (existsSync(file)) unlinkSync(file)
  } catch {
    /* best effort */
  }
}

export function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

export function clampText(value, maxLength, fallback = '') {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.slice(0, maxLength)
}

export function oneLine(value, maxLength = 200) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

export function sleep(ms, signal) {
  if (!(ms > 0)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

export function abortError(signal) {
  const reason = signal?.reason
  const error = new Error('已停止')
  error.name = 'AbortError'
  if (reason instanceof Error && reason.message) error.cause = reason
  return error
}

export function isAbortError(error) {
  return error?.name === 'AbortError'
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** Append one timestamped line to the plugin log, rotating once at ~1 MiB. */
export function makeLogger(logFile) {
  let writes = 0
  return function log(message) {
    const line = `[${new Date().toISOString()}] ${oneLine(message, 2000)}\n`
    try {
      if (writes === 0) {
        try {
          if (statSync(logFile).size > 1024 * 1024) renameSync(logFile, `${logFile}.1`)
        } catch {
          /* no log yet */
        }
      }
      writes += 1
      appendFileSync(logFile, line, { encoding: 'utf8', mode: 0o600 })
    } catch {
      /* logging must never break a run */
    }
    if (writes % 20 === 1) console.log(`[bili-fav] ${oneLine(message, 500)}`)
  }
}

export function readTail(file, maxChars = 1600) {
  try {
    const raw = readFileSync(file, 'utf8')
    return raw.length > maxChars ? raw.slice(-maxChars) : raw
  } catch {
    return ''
  }
}

/** Read every Set-Cookie header from a fetch Response (Node 20+ and fallback). */
export function readSetCookies(headers) {
  try {
    if (typeof headers?.getSetCookie === 'function') return headers.getSetCookie()
  } catch {
    /* fall through */
  }
  const merged = headers?.get?.('set-cookie')
  if (!merged) return []
  // Fallback splitter: cookies contain Expires=<date with comma>, so split on
  // the comma before a new cookie name rather than every comma.
  return String(merged).split(/,(?=\s*[^;,=\s]+=)/)
}

/** Parse `name=value; Path=/; ...` into the cookie map, keeping names we care about. */
export function mergeSetCookieJar(jar, headers) {
  for (const header of readSetCookies(headers)) {
    const first = String(header).split(';')[0]
    const index = first.indexOf('=')
    if (index <= 0) continue
    const name = first.slice(0, index).trim()
    const value = first.slice(index + 1).trim()
    if (!name || /^(path|domain|expires|max-age|samesite|secure|httponly)$/i.test(name)) continue
    if (value === '' || /^(deleted|delete me)$/i.test(value)) {
      delete jar[name]
      continue
    }
    jar[name] = value
  }
  return jar
}

export function cookieHeader(jar) {
  return Object.entries(jar)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

export function normalizeCover(url) {
  if (typeof url !== 'string' || !url) return ''
  if (url.startsWith('//')) return `https:${url}`
  return url.replace(/^http:\/\//i, 'https://')
}

export function isLoopbackAuthority(value) {
  const authority = String(value || '').toLowerCase()
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(authority)
}

/** Keep the HTTP API callable only by the same loopback origin as a fallback. */
export function sameOriginOk(req) {
  try {
    const host = String(req.headers.host || '')
    if (!host) return true
    if (!isLoopbackAuthority(host)) return false
    const source = String(req.headers.origin || req.headers.referer || '')
    if (!source) return true
    const url = new URL(source)
    if (String(url.host || '').toLowerCase() === host.toLowerCase()) return true
    const defaultPort = url.protocol === 'https:' ? '443' : '80'
    return `${url.hostname}:${url.port || defaultPort}`.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

export function localDayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function localHhMm(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function randomId(prefix = 'run') {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}
