import test from 'node:test'
import assert from 'node:assert/strict'

import { curate } from '../lib/judge.js'

const videos = [
  {
    bvid: 'BV1TEST00000',
    aid: 1001,
    cid: 2001,
    title: '候选标题A',
    author: 'UP-A',
    duration: 600,
    view: 12345,
    like: 678,
    tags: ['科技', '测试'],
    desc: '这是 A 的简介',
    category: '科技',
    pubdate: 0,
  },
  {
    bvid: 'BV1TEST00001',
    aid: 1002,
    cid: 2002,
    title: '候选标题B',
    author: 'UP-B',
    duration: 300,
    view: 23456,
    like: 789,
    tags: ['历史'],
    desc: '这是 B 的简介',
    category: '历史',
    pubdate: 0,
  },
]

function fakeLlm(handler) {
  const calls = []
  return {
    calls,
    async *stream(options) {
      const prompt = options.messages[0].content[0].text
      calls.push(prompt)
      const text = handler(prompt, calls.length)
      yield { type: 'text-delta', text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

function watched(shortlist) {
  return shortlist.map((entry) => ({
    ...entry.video,
    subtitle: '字幕内容',
    subtitleLines: 1,
    subtitleChars: 4,
    why: entry.why,
  }))
}

test('stage one and two receive the candidate content and return picks', async () => {
  const llm = fakeLlm((prompt) =>
    prompt.includes('你正在刷 B站推荐流')
      ? JSON.stringify({ watch: [{ index: 0, why: '想看看 A' }] })
      : JSON.stringify({ picks: [{ index: 0, reason: '我觉得 A 讲得清楚' }] }),
  )
  const result = await curate({
    basicVideos: videos,
    guidance: '',
    deepRead: 2,
    count: 1,
    llm,
    selection: { provider: 'fake', model: 'fake-model' },
    readContent: async (shortlist) => watched(shortlist),
    log: () => {},
  })
  assert.equal(llm.calls.length, 2)
  assert.ok(llm.calls[0].includes('候选标题A'))
  assert.ok(llm.calls[1].includes('字幕内容'))
  assert.equal(result.shortlist.length, 1)
  assert.equal(result.picks.length, 1)
  assert.equal(result.picks[0].reason, '我觉得 A 讲得清楚')
})

test('an empty first skim is retried before giving up', async () => {
  const llm = fakeLlm((prompt, call) => {
    if (prompt.includes('你正在刷 B站推荐流')) {
      return call === 1
        ? JSON.stringify({ watch: [] })
        : JSON.stringify({ watch: [{ index: 1, why: '重试后想看 B' }] })
    }
    return JSON.stringify({ picks: [] })
  })
  const result = await curate({
    basicVideos: videos,
    guidance: '',
    deepRead: 2,
    count: 2,
    llm,
    selection: { provider: 'fake', model: 'fake-model' },
    readContent: async (shortlist) => watched(shortlist),
    log: () => {},
  })
  assert.equal(llm.calls.length, 3)
  assert.ok(llm.calls[1].includes('上一轮你一条都没有点开'))
  assert.equal(result.shortlist.length, 1)
  assert.equal(result.shortlist[0].video.title, '候选标题B')
  assert.equal(result.picks.length, 0)
})

test('a malformed model reply is retried as strict JSON', async () => {
  let skimAttempts = 0
  const llm = fakeLlm((prompt) => {
    if (prompt.includes('你正在刷 B站推荐流')) {
      skimAttempts += 1
      if (skimAttempts === 1) return '这不是 JSON'
      return JSON.stringify({ watch: [{ index: 0, why: '第二次成功' }] })
    }
    return JSON.stringify({ picks: [{ index: 0, reason: '可以收藏' }] })
  })
  const result = await curate({
    basicVideos: videos,
    guidance: '看看技术内容',
    deepRead: 1,
    count: 1,
    llm,
    selection: { provider: 'fake', model: 'fake-model' },
    readContent: async (shortlist) => watched(shortlist),
    log: () => {},
  })
  assert.equal(skimAttempts, 2)
  assert.equal(result.picks.length, 1)
})
