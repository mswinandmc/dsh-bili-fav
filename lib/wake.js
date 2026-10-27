/**
 * Autonomous wake plans for the B站 agent.
 *
 * The agent does not wake at one fixed clock time. Each day we build a plan
 * from "作息窗口" entries ({ start, end, wakes }): random wake times inside
 * the windows, with a global minimum gap between wakes. The host ticks, and
 * when a planned time arrives it prompts the current DSH session so the agent
 * can do a round on its own.
 */
import { clampInt } from './util.js'

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const END_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/

export function toMinutes(value) {
  const text = String(value || '').trim()
  if (text === '24:00') return 1440
  if (!TIME_RE.test(text)) return NaN
  const [hour, minute] = text.split(':').map(Number)
  return hour * 60 + minute
}

export function fromMinutes(value) {
  const minutes = clampInt(value, 0, 1439, 0)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function normalizeWakeWindows(input, fallbackTime = '12:30') {
  const windows = []
  for (const raw of Array.isArray(input) ? input : []) {
    if (!raw || typeof raw !== 'object') continue
    const start = String(raw.start || '').trim()
    const end = String(raw.end || '').trim()
    if (!TIME_RE.test(start) || !END_RE.test(end)) continue
    const from = toMinutes(start)
    const to = toMinutes(end)
    if (!(to > from)) continue
    windows.push({ start, end, wakes: clampInt(raw.wakes, 1, 10, 1) })
    if (windows.length >= 6) break
  }
  if (windows.length === 0) {
    const start = TIME_RE.test(String(fallbackTime || '')) ? String(fallbackTime) : '12:30'
    windows.push({ start, end: fromMinutes(Math.min(toMinutes(start) + 10, 1439)), wakes: 1 })
  }
  return windows.sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
}

export function planSignature(windows, minGapMin) {
  return JSON.stringify({
    windows: (Array.isArray(windows) ? windows : []).map((window) => ({
      start: window.start,
      end: window.end,
      wakes: Number(window.wakes) || 1,
    })),
    minGapMin: Number(minGapMin) || 0,
  })
}

export function buildWakePlan({ windows, minGapMin = 60, date = '', random = Math.random } = {}) {
  const normalized = normalizeWakeWindows(windows, windows?.[0]?.start || '12:30')
  const gap = clampInt(minGapMin, 10, 360, 60)
  const candidates = []
  for (const window of normalized) {
    const from = toMinutes(window.start)
    const to = toMinutes(window.end)
    const span = Math.max(1, to - from)
    for (let index = 0; index < window.wakes; index += 1) {
      const at = from + Math.floor(random() * span)
      candidates.push({ at, window })
    }
  }
  candidates.sort((a, b) => a.at - b.at)
  const kept = []
  for (const candidate of candidates) {
    const previous = kept[kept.length - 1]
    if (previous !== undefined && candidate.at - previous < gap) continue
    kept.push(candidate.at)
  }
  // If the min gap swallowed everything, keep the earliest wake so a window
  // still wakes at least once.
  const times = (kept.length ? kept : [candidates[0]?.at].filter((value) => Number.isFinite(value)))
    .map((at) => fromMinutes(at))
    .slice(0, 20)
  return {
    date: String(date || ''),
    times,
    signature: planSignature(normalized, gap),
    minGapMin: gap,
  }
}

export function nextDueTime(plan, nowMinutes, graceMinutes = 15) {
  if (!plan || !Array.isArray(plan.times)) return ''
  const done = plan.done && typeof plan.done === 'object' ? plan.done : {}
  const grace = clampInt(graceMinutes, 0, 120, 15)
  for (const time of plan.times) {
    if (done[time]) continue
    const at = toMinutes(time)
    if (!Number.isFinite(at)) continue
    if (nowMinutes >= at && nowMinutes - at <= grace) return time
  }
  return ''
}

export function firstPendingTime(plan) {
  if (!plan || !Array.isArray(plan.times)) return ''
  const done = plan.done && typeof plan.done === 'object' ? plan.done : {}
  return plan.times.find((time) => !done[time]) || ''
}
