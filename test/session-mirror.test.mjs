import test from 'node:test'
import assert from 'node:assert/strict'
import { mirrorToSession } from '../lib/session-mirror.js'

test('injects a user-context message into a live session', async () => {
  const sent = []
  const agents = {
    get(id) {
      assert.equal(id, 'session-main')
      return { inject: async (message) => sent.push(message) }
    },
  }
  const ok = await mirrorToSession({
    agents,
    sessionId: 'session-main',
    text: '【B站插件推荐】\n推荐内容',
  })
  assert.equal(ok, true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].role, 'user')
  assert.equal(sent[0].source.kind, 'user')
  assert.match(sent[0].content[0].text, /B站插件推荐/)
})

test('resumes an inactive session before injecting', async () => {
  const sent = []
  const agents = {
    get: () => null,
    async resume({ resumeSessionId }) {
      assert.equal(resumeSessionId, 'session-cold')
      return { agent: { inject: async (message) => sent.push(message) } }
    },
  }
  const ok = await mirrorToSession({ agents, sessionId: 'session-cold', text: 'hello' })
  assert.equal(ok, true)
  assert.equal(sent[0].content[0].text, 'hello')
})

test('does nothing without a session or agents service', async () => {
  let called = false
  const agents = { get: () => { called = true; return { inject: async () => {} } } }
  assert.equal(await mirrorToSession({ agents, sessionId: '', text: 'x' }), false)
  assert.equal(await mirrorToSession({ agents: null, sessionId: 's', text: 'x' }), false)
  assert.equal(called, false)
})
