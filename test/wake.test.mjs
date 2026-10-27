import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWakePlan,
  firstPendingTime,
  fromMinutes,
  nextDueTime,
  normalizeWakeWindows,
  toMinutes,
} from '../lib/wake.js'

test('windows fall back to a single 10-minute window from the legacy time', () => {
  const windows = normalizeWakeWindows([], '07:30')
  assert.deepEqual(windows, [{ start: '07:30', end: '07:40', wakes: 1 }])
})

test('windows are sanitized and sorted', () => {
  const windows = normalizeWakeWindows(
    [
      { start: '22:00', end: '24:00', wakes: 2 },
      { start: 'nope', end: '23:00', wakes: 1 },
      { start: '07:00', end: '08:00', wakes: 3 },
    ],
    '12:30',
  )
  assert.deepEqual(
    windows.map((window) => window.start),
    ['07:00', '22:00'],
  )
  assert.equal(windows[0].wakes, 3)
})

test('plan times stay inside windows, respect the minimum gap and the date', () => {
  const plan = buildWakePlan({
    windows: [
      { start: '07:00', end: '08:00', wakes: 2 },
      { start: '20:00', end: '22:00', wakes: 2 },
    ],
    minGapMin: 120,
    date: '2026-10-27',
    random: () => 0.5,
  })
  assert.equal(plan.date, '2026-10-27')
  assert.ok(plan.times.length >= 1)
  for (const time of plan.times) {
    const minutes = toMinutes(time)
    const inWindow = [
      ['07:00', '08:00'],
      ['20:00', '22:00'],
    ].some(([start, end]) => minutes >= toMinutes(start) && minutes < toMinutes(end))
    assert.equal(inWindow, true, `${time} is outside the windows`)
  }
  const sorted = plan.times.map(toMinutes)
  for (let index = 1; index < sorted.length; index += 1) {
    assert.ok(sorted[index] - sorted[index - 1] >= 120)
  }
})

test('due and pending helpers ignore done wakes', () => {
  const plan = { times: ['07:30', '08:30'], done: { '07:30': true } }
  assert.equal(nextDueTime(plan, 8 * 60 + 35), '08:30')
  assert.equal(nextDueTime(plan, 8 * 60 + 46), '')
  assert.equal(firstPendingTime(plan), '08:30')
  assert.equal(firstPendingTime({ times: ['07:30'], done: { '07:30': true } }), '')
})

test('fromMinutes wraps safely and formats', () => {
  assert.equal(fromMinutes(0), '00:00')
  assert.equal(fromMinutes(1439), '23:59')
})
