import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionChannel } from '../lib/session-channel.js'

test('creates/reuses one fixed session and prompts it', async () => {
  const calls = []
  const sc = {
    async create(options) {
      calls.push(['create', options])
    },
    async rename(options) {
      calls.push(['rename', options])
    },
    async prompt(request, signal) {
      calls.push(['prompt', request, Boolean(signal)])
    },
  }
  const ctx = { get: (name) => (name === 'sessionController' ? sc : undefined) }
  const channel = createSessionChannel({ ctx, home: '/tmp/bili-fav' })
  assert.equal(channel.available(), true)
  const first = await channel.send(
    { text: '推荐 1' },
    { sessionId: 'session-fixed', title: '大肥鱼推荐' },
  )
  const second = await channel.send(
    { text: '推荐 2' },
    { sessionId: 'session-fixed', title: '大肥鱼推荐' },
  )
  assert.equal(first.sessionId, 'session-fixed')
  assert.equal(second.sessionId, 'session-fixed')
  assert.deepEqual(calls[0], ['create', { sessionId: 'session-fixed', cwd: '/tmp/bili-fav' }])
  assert.equal(calls[1][0], 'rename')
  assert.equal(calls[2][1].content[0].text, '推荐 1')
  assert.equal(calls[5][1].content[0].text, '推荐 2')
  assert.equal(calls.filter((call) => call[0] === 'create').length, 2)
})

test('a conflicting session id is replaced with a new session under the plugin home', async () => {
  const calls = []
  const changed = []
  const sc = {
    async create(options) {
      calls.push(['create', options])
      if (options.sessionId === 'workspace-session') {
        const error = new Error('session belongs to another directory')
        error.code = 'session/conflict'
        throw error
      }
    },
    async rename(options) {
      calls.push(['rename', options])
    },
    async prompt(request) {
      calls.push(['prompt', request])
    },
  }
  const ctx = { get: (name) => (name === 'sessionController' ? sc : undefined) }
  const channel = createSessionChannel({
    ctx,
    home: '/tmp/bili-fav',
    onSessionChanged: async (sessionId) => changed.push(sessionId),
  })
  const result = await channel.send(
    { text: '推荐' },
    { sessionId: 'workspace-session', title: '大肥鱼推荐' },
  )
  assert.notEqual(result.sessionId, 'workspace-session')
  assert.match(result.sessionId, /^session_/)
  assert.deepEqual(changed, [result.sessionId])
  const creates = calls.filter((call) => call[0] === 'create')
  assert.equal(creates.length, 2)
  assert.deepEqual(creates[0], ['create', { sessionId: 'workspace-session', cwd: '/tmp/bili-fav' }])
  assert.deepEqual(creates[1], ['create', { sessionId: result.sessionId, cwd: '/tmp/bili-fav' }])
  const rename = calls.find((call) => call[0] === 'rename')
  assert.equal(rename[1].sessionId, result.sessionId)
  const prompt = calls.find((call) => call[0] === 'prompt')
  assert.equal(prompt[1].sessionId, result.sessionId)
})

test('available is false without sessionController', async () => {
  const channel = createSessionChannel({ ctx: { get: () => undefined }, home: '/tmp' })
  assert.equal(channel.available(), false)
  await assert.rejects(() => channel.send({ text: 'x' }, {}), /sessionController/)
})
