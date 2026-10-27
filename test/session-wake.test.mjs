import test from 'node:test'
import assert from 'node:assert/strict'
import { wakeSession } from '../lib/session-wake.js'

test('idle agent gets followup with the short prompt', async () => {
  const calls = []
  const agents = {
    get: () => ({
      status: 'idle',
      followup: async (message) => calls.push(['followup', message]),
      inject: async (message) => calls.push(['inject', message]),
    }),
  }
  const ok = await wakeSession({ agents, sessionId: 's1', prompt: '读推荐后聊一两句' })
  assert.equal(ok, true)
  assert.equal(calls[0][0], 'followup')
  assert.equal(calls[0][1].content[0].text, '读推荐后聊一两句')
  assert.equal(calls[0][1].source.kind, 'user')
})

test('busy agent gets inject instead of followup', async () => {
  const calls = []
  const agents = {
    get: () => ({
      status: 'running',
      followup: async (message) => calls.push(['followup', message]),
      inject: async (message) => calls.push(['inject', message]),
    }),
  }
  const ok = await wakeSession({ agents, sessionId: 's1', prompt: 'short' })
  assert.equal(ok, true)
  assert.equal(calls[0][0], 'inject')
})

test('missing session or agents is a no-op', async () => {
  let called = false
  const agents = { get: () => { called = true; return { inject: async () => {} } } }
  assert.equal(await wakeSession({ agents, sessionId: '', prompt: 'x' }), false)
  assert.equal(await wakeSession({ agents: null, sessionId: 's', prompt: 'x' }), false)
  assert.equal(called, false)
})
