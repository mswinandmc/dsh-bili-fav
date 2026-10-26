import test from 'node:test'
import assert from 'node:assert/strict'
import { formatChatReply } from '../lib/chat.js'

test('conversational reply includes title, url, and reason', () => {
  const text = formatChatReply([
    { bvid: 'BV1xx', title: '一个测试视频', author: 'UP主', reason: '因为讲得清楚，而且有我关心的细节。' },
    { bvid: 'BV2xx', title: '另一个视频', author: '', reason: '' },
  ])
  assert.match(text, /挑了 2 条/)
  assert.match(text, /BV1xx/)
  assert.match(text, /为什么：因为讲得清楚/)
  assert.match(text, /BV2xx/)
  assert.match(text, /未知 UP/)
  assert.match(text, /想换一批/)
})

test('empty picks get a conversational fallback', () => {
  const text = formatChatReply([])
  assert.match(text, /没挑到/)
  assert.match(text, /再刷一轮/)
})
