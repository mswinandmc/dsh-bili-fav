import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_CONFIG,
  loadConfig,
  loadState,
  markSeen,
  sanitizeConfig,
  saveConfig,
  saveState,
  seenRecently,
} from '../lib/store.js'

test('defaults use 大肥鱼推荐 and safe limits', () => {
  const config = sanitizeConfig({})
  assert.equal(config.folderName, '大肥鱼推荐')
  assert.equal(config.deliveryMode, 'favorite')
  assert.equal(config.channelId, '')
  assert.deepEqual(config.channelOptions, {})
  assert.equal(config.scan, DEFAULT_CONFIG.scan)
  assert.equal(config.deepRead, DEFAULT_CONFIG.deepRead)
  assert.equal(config.count, DEFAULT_CONFIG.count)
  assert.equal(config.readSubtitles, true)
  assert.equal(config.replyPrompt, DEFAULT_CONFIG.replyPrompt)
  assert.equal(config.qqInbound, true)
  assert.equal(config.autoRun.enabled, false)
  assert.equal(config.autoRun.time, '20:00')
  assert.deepEqual(config.autoRun.windows, [{ start: '20:00', end: '20:10', wakes: 1 }])
  assert.equal(config.autoRun.minGapMin, 60)
})

test('clamps user values instead of trusting the form', () => {
  const config = sanitizeConfig({
    scan: 999,
    deepRead: 0,
    count: 99,
    folderName: 'x'.repeat(30),
    deliveryMode: 'nope',
    replyPrompt: 'x'.repeat(5000),
    channelId: 'x'.repeat(50),
    channelOptions: { qq: { target: 'y'.repeat(600), scope: 'group' } },
    autoRun: { enabled: true, time: '25:99' },
  })
  assert.equal(config.scan, 30)
  assert.equal(config.deepRead, 1)
  assert.equal(config.count, 10)
  assert.equal(config.folderName.length, 20)
  assert.equal(config.deliveryMode, 'favorite')
  assert.equal(config.channelId.length, 40)
  assert.equal(config.channelOptions.qq.target.length, 500)
  assert.equal(config.autoRun.enabled, true)
  assert.equal(config.autoRun.time, '20:00')
})

test('config round-trips through the plugin home', () => {
  const home = mkdtempSync(join(tmpdir(), 'bili-fav-store-'))
  try {
    const saved = saveConfig(home, {
      folderName: '测试夹',
      deliveryMode: 'both',
      channelId: 'qq',
      channelOptions: { qq: { target: '测试群', scope: 'group', tool: 'qq_send__test' } },
      scan: 12,
      deepRead: 4,
      count: 2,
      readSubtitles: false,
      autoRun: { enabled: true, time: '23:59' },
    })
    const loaded = loadConfig(home)
    assert.deepEqual(loaded, saved)
    assert.equal(loaded.folderName, '测试夹')
    assert.equal(loaded.deliveryMode, 'both')
    assert.equal(loaded.channelId, 'qq')
    assert.equal(loaded.channelOptions.qq.target, '测试群')
    assert.equal(loaded.channelOptions.qq.scope, 'group')
    assert.equal(loaded.channelOptions.qq.tool, 'qq_send__test')
    assert.equal(loaded.autoRun.time, '23:59')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('legacy QQ config migrates to the generic channel fields', () => {
  const config = sanitizeConfig({
    deliveryMode: 'qq',
    qqTarget: '旧群',
    qqScope: 'group',
    qqTool: 'qq_send__legacy',
  })
  assert.equal(config.deliveryMode, 'channel')
  assert.equal(config.channelId, 'qq')
  assert.equal(config.channelOptions.qq.target, '旧群')
  assert.equal(config.channelOptions.qq.scope, 'group')
  assert.equal(config.channelOptions.qq.tool, 'qq_send__legacy')
})


test('seen map persists and expires by timestamp', () => {
  const home = mkdtempSync(join(tmpdir(), 'bili-fav-seen-'))
  try {
    const state = loadState(home)
    assert.deepEqual(Object.keys(state.seen), [])
    markSeen(state, 'BV1TEST00000')
    assert.equal(seenRecently(state, 'BV1TEST00000'), true)
    assert.equal(seenRecently(state, 'BV1MISSING00'), false)
    saveState(home, state)
    const loaded = loadState(home)
    assert.ok(loaded.seen.BV1TEST00000 > 0)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
