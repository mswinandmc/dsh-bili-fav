import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { createWebhookChannel } from '../lib/webhook.js'

async function withServer(handler, run) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

function capture(respond = (res) => res.end('ok')) {
  const result = { headers: null, body: '' }
  let resolve
  const received = new Promise((done) => {
    resolve = done
  })
  return {
    result,
    received,
    handler(req, res) {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        result.headers = req.headers
        result.body = body
        resolve()
        respond(res)
      })
    },
  }
}

test('webhook posts a JSON payload with Authorization', async () => {
  const captureOne = capture((res) => {
    res.writeHead(200)
    res.end('ok')
  })
  await withServer(captureOne.handler, async (base) => {
    const channel = createWebhookChannel()
    const result = await channel.send(
      {
        title: '🐟 大肥鱼推荐',
        text: 'hello webhook',
        picks: [{ bvid: 'BV1xx', title: '测试' }],
        folder: { title: '大肥鱼推荐' },
        mode: 'channel',
      },
      { url: `${base}/hook`, token: 'Bearer secret', format: 'json' },
    )
    await captureOne.received
    assert.equal(result.message, 'Webhook HTTP 200')
    assert.equal(captureOne.result.headers.authorization, 'Bearer secret')
    assert.match(captureOne.result.headers['content-type'], /application\/json/)
    const parsed = JSON.parse(captureOne.result.body)
    assert.equal(parsed.text, 'hello webhook')
    assert.equal(parsed.picks[0].bvid, 'BV1xx')
    assert.equal(parsed.folder.title, '大肥鱼推荐')
    assert.ok(parsed.sentAt)
  })
})

test('webhook can post plain text and run a test send', async () => {
  const captureOne = capture((res) => {
    res.writeHead(204)
    res.end()
  })
  await withServer(captureOne.handler, async (base) => {
    const channel = createWebhookChannel()
    const result = await channel.send(
      { text: 'plain payload' },
      { url: `${base}/hook`, format: 'text' },
    )
    await captureOne.received
    assert.equal(result.message, 'Webhook HTTP 204')
    assert.match(captureOne.result.headers['content-type'], /text\/plain/)
    assert.equal(captureOne.result.body, 'plain payload')

    const captureTwo = capture((res) => {
      res.writeHead(200)
      res.end()
    })
    await withServer(captureTwo.handler, async (baseTwo) => {
      const tested = await channel.test({ url: `${baseTwo}/hook`, format: 'json' })
      await captureTwo.received
      assert.equal(tested.message, 'Webhook 测试成功')
      assert.match(JSON.parse(captureTwo.result.body).text, /Webhook 渠道联调成功/)
    })
  })
})

test('webhook reports HTTP errors and invalid config', async () => {
  await withServer(
    (req, res) => {
      req.resume()
      res.writeHead(502)
      res.end('bad gateway')
    },
    async (base) => {
      const channel = createWebhookChannel()
      await assert.rejects(
        () => channel.send({ text: 'x' }, { url: `${base}/hook` }),
        /Webhook HTTP 502.*bad gateway/,
      )
    },
  )
  const channel = createWebhookChannel()
  await assert.rejects(() => channel.send({ text: 'x' }, {}), /URL/)
  await assert.rejects(
    () => channel.send({ text: 'x' }, { url: 'ftp://example.com' }),
    /http/,
  )
})
