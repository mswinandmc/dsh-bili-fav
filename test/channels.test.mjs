import test from 'node:test'
import assert from 'node:assert/strict'
import { createChannelRegistry } from '../lib/channels.js'

test('channel registry registers, serializes, dispatches, and unregisters', async () => {
  const registry = createChannelRegistry()
  const disposer = registry.register({
    id: 'demo',
    label: 'Demo',
    description: 'demo channel',
    fields: [
      { key: 'target', label: 'Target', type: 'text', required: true },
      { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a', label: 'A' }] },
      { key: '../bad', label: 'Bad' },
    ],
    available: () => true,
    async send(payload, options, { signal }) {
      assert.equal(payload.text, 'hello')
      assert.equal(options.target, 't1')
      assert.ok(signal)
      return { ok: true, message: 'sent' }
    },
    async listTargets() {
      return { ok: true, message: 'targets' }
    },
    async test() {
      return { ok: true, message: 'tested' }
    },
  })

  const listed = registry.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, 'demo')
  assert.equal(listed[0].available, true)
  assert.equal(listed[0].hasList, true)
  assert.equal(listed[0].hasTest, true)
  assert.equal(listed[0].fields.length, 2)
  assert.equal(listed[0].fields[0].required, true)

  const sent = await registry.send('demo', { text: 'hello' }, { target: 't1' }, { signal: new AbortController().signal })
  assert.equal(sent.message, 'sent')
  assert.equal((await registry.listTargets('demo')).message, 'targets')
  assert.equal((await registry.test('demo')).message, 'tested')

  assert.throws(() => registry.register({ id: 'demo', label: 'dup', send() {} }), /已经注册/)
  assert.throws(() => registry.register({ id: 'Bad Id', label: 'bad', send() {} }), /非法/)
  assert.throws(() => registry.register({ id: 'nosend', label: 'no send' }), /send/)

  disposer()
  assert.equal(registry.list().length, 0)
})

test('channel registry rejects an unavailable channel', async () => {
  const registry = createChannelRegistry()
  registry.register({
    id: 'off',
    label: 'Off',
    available: () => false,
    async send() { return { ok: true } },
  })
  await assert.rejects(() => registry.send('off', { text: 'x' }), /不可用/)
})
