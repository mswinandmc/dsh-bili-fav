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

test('available is false without sessionController', async () => {
  const channel = createSessionChannel({ ctx: { get: () => undefined }, home: '/tmp' })
  assert.equal(channel.available(), false)
  await assert.rejects(() => channel.send({ text: 'x' }, {}), /sessionController/)
})
