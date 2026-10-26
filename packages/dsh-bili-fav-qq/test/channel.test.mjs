import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

function fakeContext() {
  let channel = null
  const calls = []
  const ctx = {
    effect(fn) {
      return fn()
    },
    biliFavChannels: {
      register(value) {
        channel = value
        return () => {
          channel = null
        }
      },
    },
    tools: {
      schemas() {
        return [{ name: 'qq_send__standard' }, { name: 'not_qq' }]
      },
      async execute(input) {
        calls.push(input)
        return { value: { ok: true, msg: input.arguments.action === 'list' ? 'targets' : 'sent' } }
      },
    },
  }
  apply(ctx)
  return { channel, calls }
}

test('registers an available qq channel with UI fields', () => {
  const { channel } = fakeContext()
  assert.ok(channel)
  assert.equal(channel.id, 'qq')
  assert.equal(channel.label, 'QQ Bot')
  assert.equal(channel.available(), true)
  assert.ok(Array.isArray(channel.fields))
  assert.deepEqual(channel.fields.map((field) => field.key), ['target', 'scope', 'tool'])
  assert.equal(channel.fields[0].required, true)
})

test('send/list/test go through qq_send with a signal', async () => {
  const { channel, calls } = fakeContext()
  const sent = await channel.send(
    { text: '推荐正文' },
    { target: 'F7064591749C2E1DDDD98D73CC209517', scope: 'c2c', tool: '' },
    { signal: new AbortController().signal },
  )
  assert.equal(sent.message, 'sent')
  assert.equal(calls[0].name, 'qq_send__standard')
  assert.equal(calls[0].arguments.target, 'F7064591749C2E1DDDD98D73CC209517')
  assert.equal(calls[0].arguments.scope, 'c2c')
  assert.equal(calls[0].arguments.text, '推荐正文')
  assert.ok(calls[0].signal)

  const targets = await channel.listTargets({}, {})
  assert.equal(targets.message, 'targets')
  assert.deepEqual(calls[1].arguments, { action: 'list' })

  const tested = await channel.test({ target: 'F7064591749C2E1DDDD98D73CC209517', scope: 'c2c' }, {})
  assert.equal(tested.message, 'sent')
  assert.ok(calls[2].signal)
})

test('send fails clearly without a target or a qq_send tool', async () => {
  const { channel } = fakeContext()
  await assert.rejects(() => channel.send({ text: 'x' }, {}), /推送到/)
  const empty = {
    effect(fn) {
      return fn()
    },
    biliFavChannels: { register() { return () => {} } },
    tools: { schemas: () => [], execute: async () => ({}) },
  }
  apply(empty)
  const noTool = {
    effect(fn) {
      return fn()
    },
    biliFavChannels: {
      register(value) {
        noTool.channel = value
        return () => {}
      },
    },
    tools: { schemas: () => [], execute: async () => ({}) },
  }
  apply(noTool)
  assert.equal(noTool.channel.available(), false)
  await assert.rejects(() => noTool.channel.send({ text: 'x' }, { target: 'abc' }), /qq_send/)
})
