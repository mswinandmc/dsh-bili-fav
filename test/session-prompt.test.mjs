import test from 'node:test'
import assert from 'node:assert/strict'
import { promptSession } from '../lib/session-prompt.js'

test('prompts an existing session and never creates one', async () => {
  const calls = []
  const sc = {
    async create() {
      calls.push(['create'])
    },
    async prompt(request, signal) {
      calls.push(['prompt', request, Boolean(signal)])
    },
  }
  const ctx = { get: (name) => (name === 'sessionController' ? sc : undefined) }
  const ok = await promptSession({ ctx, sessionId: 'session-qq', text: '刷一轮并推 QQ' })
  assert.equal(ok, true)
  assert.equal(calls.some((call) => call[0] === 'create'), false)
  assert.equal(calls[0][1].sessionId, 'session-qq')
  assert.equal(calls[0][1].content[0].text, '刷一轮并推 QQ')
})

test('returns false without sessionController', async () => {
  assert.equal(await promptSession({ ctx: { get: () => undefined }, sessionId: 's', text: 'x' }), false)
})
