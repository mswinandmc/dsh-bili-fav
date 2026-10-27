import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAT_REPLY_LIMIT, formatChatReply } from '../lib/chat.js'

test('conversational reply has one reason line and one link line', () => {
  const text = formatChatReply([
    { bvid: 'BV1xx', title: '一个测试视频', author: 'UP主', reason: '因为讲得清楚，而且有我关心的细节。' },
    { bvid: 'BV2xx', title: '另一个视频', author: '', reason: '' },
  ])
  const lines = text.split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /一个测试视频/)
  assert.match(lines[0], /讲得清楚/)
  assert.doesNotMatch(lines[0], /BV1xx/)
  assert.equal(lines[1], 'https://www.bilibili.com/video/BV1xx')
  assert.doesNotMatch(text, /另一个视频|BV2xx/)
  assert.doesNotMatch(text, /1\.|2\./)
  assert.doesNotMatch(text, /主人|本鲸/)
  assert.ok(text.length <= CHAT_REPLY_LIMIT, `reply too long: ${text.length}`)
})

test('long titles and reasons keep the link on its own line within budget', () => {
  const text = formatChatReply([
    {
      bvid: 'BV1abcdefghij',
      title: '视频标题'.repeat(20),
      author: 'UP'.repeat(20),
      reason: '理由'.repeat(100),
    },
  ])
  const lines = text.split('\n')
  assert.equal(lines.length, 2)
  assert.equal(lines[1], 'https://www.bilibili.com/video/BV1abcdefghij')
  assert.ok(text.length <= CHAT_REPLY_LIMIT, `reply too long: ${text.length}`)
  assert.equal(text.match(/https:\/\//g)?.length, 1)
})

test('empty picks get a short conversational fallback', () => {
  const text = formatChatReply([])
  assert.match(text, /没挑到/)
  assert.match(text, /再刷一轮/)
  assert.doesNotMatch(text, /主人|本鲸/)
  assert.doesNotMatch(text, /https:\/\//)
  assert.ok(text.length <= CHAT_REPLY_LIMIT)
})
