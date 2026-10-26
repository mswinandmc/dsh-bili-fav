/**
 * QQ channel adapter for dsh-bili-fav, using Tencent's official QQ Bot API.
 *
 * No dependency on the DSH QQ Bot plugin or its qq_send__* tools:
 *   POST https://api.bot.qq.com/app/getAppAccessToken  { appId, clientSecret }
 *   POST https://api.bot.qq.com/v2/groups/{group_openid}/messages
 *   POST https://api.bot.qq.com/v2/users/{user_openid}/messages
 *   Authorization: QQBot <access_token>
 */
export const name = 'bili-fav-qq'
export const inject = ['biliFavChannels']

const API_BASE = 'https://api.bot.qq.com'
const TOKEN_URL = `${API_BASE}/app/getAppAccessToken`
const CONTENT_LIMIT = 1800

function trimmed(value, max = 500) {
  return String(value || '').trim().slice(0, max)
}

function apiError(label, response, data) {
  const code = data?.err_code ?? data?.code ?? response?.status ?? 'unknown'
  const message = data?.message || data?.msg || ''
  return new Error(`QQ 官方 API ${label}失败：${code}${message ? ` ${message}` : ''}`)
}

export function createQQChannel({ fetchImpl = fetch } = {}) {
  const tokenCache = new Map()
  let sequence = 0

  async function getAccessToken(appId, appSecret, signal) {
    const cacheKey = `${appId}\u0000${appSecret}`
    const cached = tokenCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId, clientSecret: appSecret }),
      signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data?.code || !data?.access_token) {
      throw apiError('获取 access_token ', response, data)
    }
    const expiresIn = Number(data.expires_in) || 7200
    tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    })
    return data.access_token
  }

  async function send(payload, options = {}, { signal } = {}) {
    const appId = trimmed(options.appId, 80)
    const appSecret = trimmed(options.appSecret, 200)
    const target = trimmed(options.target, 200)
    const targetType =
      options.targetType === 'group' || options.scope === 'group'
        ? 'group'
        : options.targetType === 'c2c' || options.scope === 'c2c'
          ? 'c2c'
          : ''
    if (!appId) throw new Error('QQ 官方 API 缺少 AppID')
    if (!appSecret) throw new Error('QQ 官方 API 缺少 ClientSecret')
    if (!target) throw new Error('QQ 官方 API 缺少目标 openid')
    if (!targetType) throw new Error('QQ 官方 API 目标类型必须是 group 或 c2c')

    const content = String(payload?.text || '').trim().slice(0, CONTENT_LIMIT)
    if (!content) throw new Error('QQ 官方 API 没有可发送的文本')
    const token = await getAccessToken(appId, appSecret, signal)
    const path =
      targetType === 'group'
        ? `/v2/groups/${encodeURIComponent(target)}/messages`
        : `/v2/users/${encodeURIComponent(target)}/messages`
    const body = { msg_type: 0, content }
    const msgId = trimmed(options.msgId, 200)
    if (msgId) {
      sequence = (sequence + 1) % 1_000_000_000
      body.msg_id = msgId
      body.msg_seq = sequence || 1
    }

    const response = await fetchImpl(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `QQBot ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data?.err_code || data?.code) {
      throw apiError('发送', response, data)
    }
    return {
      ok: true,
      message: `已发送到${targetType === 'group' ? '群聊' : '私聊'}（QQ 官方 API）`,
    }
  }

  return {
    id: 'qq',
    label: 'QQ Bot（官方 API）',
    description: '直接用腾讯 QQ 官方 Bot API 发送，不依赖 QQ Bot 插件。',
    order: 10,
    fields: [
      {
        key: 'appId',
        label: 'AppID',
        type: 'text',
        required: true,
        placeholder: 'QQ 开放平台机器人的 AppID',
      },
      {
        key: 'appSecret',
        label: 'ClientSecret',
        type: 'text',
        required: true,
        placeholder: 'QQ 开放平台机器人的 ClientSecret',
        help: '只保存在本机 config.json（0600）；不要发到群聊或日志里。',
      },
      {
        key: 'target',
        label: '目标 openid',
        type: 'text',
        required: true,
        placeholder: '群 group_openid 或用户 user_openid',
        help: '官方 Bot 的 openid 很长（32+ 位），可直接粘贴。',
      },
      {
        key: 'targetType',
        label: '目标类型',
        type: 'select',
        required: true,
        default: 'c2c',
        options: [
          { value: 'c2c', label: '单聊（user_openid）' },
          { value: 'group', label: '群聊（group_openid）' },
        ],
      },
      {
        key: 'msgId',
        label: '被动回复 msg_id（可选）',
        type: 'text',
        placeholder: '不填 = 主动消息',
        help: '来自最近一条入站事件的 d.id；群聊 5 分钟、单聊 60 分钟内有效。不填走主动消息，受官方频控/权限限制。',
      },
    ],
    available: () => true,
    send,
    async test(options, { signal } = {}) {
      await send(
        {
          text: [
            '🐟 大肥鱼推荐：QQ 官方 API 联调成功',
            new Date().toLocaleString('zh-CN'),
            '收到这条消息，就说明「B站自主刷片 → 腾讯 QQ 官方 Bot」链路通了。',
          ].join('\n'),
        },
        options,
        { signal },
      )
      return { ok: true, message: 'QQ 官方 API 测试成功' }
    },
  }
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.biliFavChannels.register(createQQChannel()),
    'bili-fav-qq: official QQ channel',
  )
}
