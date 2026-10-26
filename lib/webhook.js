const URL_PATTERN = /^https?:\/\//i

/**
 * Built-in generic Webhook channel.
 *
 * It intentionally has no QQ / Telegram / Discord knowledge: users point it at
 * any HTTP endpoint and receive a JSON object (or plain text). That keeps the
 * core plugin usable without the optional QQ adapter.
 */
export function createWebhookChannel({ fetchImpl = fetch } = {}) {
  async function send(payload, options = {}, { signal } = {}) {
    const url = String(options?.url || '').trim()
    if (!url) throw new Error('Webhook 还没有填 URL')
    if (!URL_PATTERN.test(url)) throw new Error('Webhook URL 必须以 http:// 或 https:// 开头')

    const format = options?.format === 'text' ? 'text' : 'json'
    const body =
      format === 'text'
        ? String(payload?.text || '')
        : JSON.stringify({
            title: payload?.title || '🐟 大肥鱼推荐',
            text: payload?.text || '',
            picks: Array.isArray(payload?.picks) ? payload.picks : [],
            folder: payload?.folder || null,
            mode: payload?.mode || '',
            sentAt: new Date().toISOString(),
          })
    const headers = {
      'content-type': format === 'text' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    }
    const token = String(options?.token || '').trim()
    if (token) headers.authorization = token

    const response = await fetchImpl(url, { method: 'POST', headers, body, signal })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Webhook HTTP ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`)
    }
    return { ok: true, message: `Webhook HTTP ${response.status}` }
  }

  return {
    id: 'webhook',
    label: 'Webhook',
    description: 'POST 推荐到任意 HTTP 地址；不依赖 QQ Bot 或其它渠道插件。',
    order: 50,
    fields: [
      {
        key: 'url',
        label: 'Webhook URL',
        type: 'text',
        required: true,
        placeholder: 'https://example.com/bili-fav',
        help: '必须 http(s)；JSON 模式会 POST { title, text, picks, folder, mode, sentAt }。',
      },
      {
        key: 'token',
        label: 'Authorization（可选）',
        type: 'text',
        placeholder: 'Bearer xxxxx',
        help: '原样放进 Authorization 请求头；不填就不发。',
      },
      {
        key: 'format',
        label: '请求格式',
        type: 'select',
        default: 'json',
        options: [
          { value: 'json', label: 'JSON' },
          { value: 'text', label: '纯文本' },
        ],
      },
    ],
    async send(payload, options, context) {
      return send(payload, options, context)
    },
    async test(options, { signal } = {}) {
      await send(
        {
          title: '🐟 大肥鱼推荐',
          text: '🐟 大肥鱼推荐：Webhook 渠道联调成功',
          picks: [],
          folder: null,
          mode: 'test',
        },
        options,
        { signal },
      )
      return { ok: true, message: 'Webhook 测试成功' }
    },
  }
}
