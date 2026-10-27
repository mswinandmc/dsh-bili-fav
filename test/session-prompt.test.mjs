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

test('creates a new session when the target is archived', async () => {
  const calls = []
  const changed = []
  const sc = {
    async create(options) {
      calls.push(['create', options])
      return { sessionId: 'session-new' }
    },
    async rename(options) {
      calls.push(['rename', options])
    },
    async prompt(request) {
      calls.push(['prompt', request])
    },
  }
  const ctx = {
    get: (name) =>
      name === 'sessionController'
        ? sc
        : name === 'workspaceRegistry'
          ? { archivedSessionIds: ['session-old'] }
          : undefined,
  }
  const ok = await promptSession({
    ctx,
    home: '/tmp/bili-fav',
    sessionId: 'session-old',
    text: 'x',
    onSessionChanged: (id) => changed.push(id),
  })
  assert.equal(ok, true)
  assert.deepEqual(calls[0], ['create', { cwd: '/tmp/bili-fav' }])
  const promptCall = calls.find((call) => call[0] === 'prompt')
  assert.equal(promptCall[1].sessionId, 'session-new')
  assert.deepEqual(changed, ['session-new'])
})

test('creates a new session when the target no longer exists', async () => {
  const calls = []
  const sc = {
    async create() {
      return { sessionId: 'session-new' }
    },
    async rename() {},
    async prompt(request) {
      calls.push(request.sessionId)
      if (request.sessionId === 'session-old') {
        const error = new Error('session not found')
        error.code = 'session/not-found'
        throw error
      }
    },
  }
  const ctx = { get: (name) => (name === 'sessionController' ? sc : undefined) }
  const ok = await promptSession({
    ctx,
    home: '/tmp/bili-fav',
    sessionId: 'session-old',
    text: 'x',
  })
  assert.equal(ok, true)
  assert.deepEqual(calls, ['session-old', 'session-old', 'session-new'])
})

test('returns false without sessionController', async () => {
  assert.equal(await promptSession({ ctx: { get: () => undefined }, sessionId: 's', text: 'x' }), false)
})
