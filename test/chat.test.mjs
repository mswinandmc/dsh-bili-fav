import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAT_REPLY_LIMIT, formatChatReply } from '../lib/chat.js'

test('conversational reply is one short message about a single pick', () => {
  const text = formatChatReply([
    { bvid: 'BV1xx', title: '一个测试视频', author: 'UP主', reason: '因为讲得清楚，而且有我关心的细节。' },
    { bvid: 'BV2xx', title: '另一个视频', author: '', reason: '' },
  ])
  assert.match(text, /一个测试视频/)
  assert.match(text, /BV1xx/)
  assert.match(text, /讲得清楚/)
  assert.doesNotMatch(text, /另一个视频/)
  assert.doesNotMatch(text, /BV2xx/)
  assert.doesNotMatch(text, /1\.|2\./)
  assert.doesNotMatch(text, /\n/)
  assert.doesNotMatch(text, /主人|本鲸/)
  assert.ok(text.length <= CHAT_REPLY_LIMIT, `reply too long: ${text.length}`)
})

test('long titles and reasons stay inside the character budget', () => {
  const text = formatChatReply([
    {
      bvid: 'BV1abcdefghij',
      title: '视频标题'.repeat(20),
      author: 'UP'.repeat(20),
      reason: '理由'.repeat(100),
    },
  ])
  assert.ok(text.length <= CHAT_REPLY_LIMIT, `reply too long: ${text.length}`)
  assert.match(text, /BV1abcdefghij/)
  assert.equal(text.match(/https:\/\//g)?.length, 1)
  assert.doesNotMatch(text, /\n/)
})

test('empty picks get a short conversational fallback', () => {
  const text = formatChatReply([])
  assert.match(text, /没挑到/)
  assert.match(text, /再刷一轮/)
  assert.doesNotMatch(text, /主人|本鲸/)
  assert.ok(text.length <= CHAT_REPLY_LIMIT)
})
