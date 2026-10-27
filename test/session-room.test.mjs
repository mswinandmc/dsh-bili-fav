import test from 'node:test'
import assert from 'node:assert/strict'
import { openRecommendationRoom } from '../lib/session-room.js'

test('creates a new session, renames it, and queues the task', async () => {
  const calls = []
  const sc = {
    async create(options) {
      calls.push(['create', options])
      return { sessionId: 'session-new' }
    },
    async rename(options) {
      calls.push(['rename', options])
    },
    async prompt(request, signal) {
      calls.push(['prompt', request, Boolean(signal)])
    },
  }
  const ctx = {
    get(name) {
      if (name === 'sessionController') return sc
      if (name === 'workspaceRegistry') {
        return { list: () => [{ id: 'ws-1', sessionIds: ['session-parent'] }] }
      }
      return undefined
    },
  }
  const result = await openRecommendationRoom({
    ctx,
    parentSessionId: 'session-parent',
    title: 'B站推荐 · 测试',
    task: '聊聊这轮推荐',
  })
  assert.deepEqual(result, { sessionId: 'session-new', prompted: true, title: 'B站推荐 · 测试' })
  assert.deepEqual(calls[0], ['create', { workspaceId: 'ws-1' }])
  assert.deepEqual(calls[1], ['rename', { sessionId: 'session-new', title: 'B站推荐 · 测试' }])
  assert.equal(calls[2][1].requestId.startsWith('room_'), true)
  assert.equal(calls[2][1].sessionId, 'session-new')
  assert.equal(calls[2][1].content[0].text, '聊聊这轮推荐')
})

test('returns null when sessionController is unavailable', async () => {
  const result = await openRecommendationRoom({
    ctx: { get: () => undefined },
    title: 'x',
    task: 'y',
  })
  assert.equal(result, null)
})
