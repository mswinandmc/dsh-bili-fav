/**
 * Built-in DSH conversation channel.
 *
 * Like dsh-bili-whale's session delivery: keep one fixed session id, create it
 * on first use, and prompt the same session every round so it continues the
 * conversation. This channel never pushes to QQ/Webhook.
 */
import { randomId } from './util.js'

const DEFAULT_SESSION_ID = 'bili-fav-session'
const DEFAULT_TITLE = '大肥鱼推荐'

export function createSessionChannel({ ctx, home, log = () => {} }) {
  const controller = () => {
    try {
      return ctx?.get?.('sessionController')
    } catch {
      return undefined
    }
  }

  async function deliver(options, text, signal) {
    const sc = controller()
    if (!sc || typeof sc.create !== 'function' || typeof sc.prompt !== 'function') {
      throw new Error('宿主没有可用的 sessionController.create/prompt')
    }
    const sessionId = String(options?.sessionId || DEFAULT_SESSION_ID).trim().slice(0, 120) || DEFAULT_SESSION_ID
    const title = String(options?.title || DEFAULT_TITLE).trim().slice(0, 80) || DEFAULT_TITLE
    const body = String(text || '').trim()
    if (!body) throw new Error('DSH 会话没有可发送的内容')
    try {
      await sc.create({ sessionId, cwd: home })
    } catch {
      /* an existing session is fine; prompt below will confirm */
    }
    if (typeof sc.rename === 'function') {
      try {
        await sc.rename({ sessionId, title })
      } catch {
        /* title is cosmetic */
      }
    }
    const request = {
      requestId: randomId('session'),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: body }],
    }
    try {
      await sc.prompt(request, signal)
    } catch {
      await sc.prompt(request)
    }
    log(`已投递到 DSH 会话 ${sessionId}`)
    return sessionId
  }

  return {
    id: 'session',
    label: 'DSH 会话',
    description: '固定一个 DSH 会话，跨轮持续；不推送 QQ。',
    order: 5,
    fields: [
      {
        key: 'title',
        label: '会话标题',
        type: 'text',
        default: DEFAULT_TITLE,
        placeholder: DEFAULT_TITLE,
        help: '同一个 sessionId 会继续同一个会话；改标题只改显示。',
      },
      {
        key: 'sessionId',
        label: '会话 ID',
        type: 'text',
        default: DEFAULT_SESSION_ID,
        placeholder: DEFAULT_SESSION_ID,
        help: '保持不变 = 继续同一会话；换一个 ID = 新会话。',
      },
    ],
    available: () => Boolean(controller()?.create && controller()?.prompt),
    async send(payload, options, { signal } = {}) {
      const sessionId = await deliver(options || {}, payload?.text, signal)
      return {
        ok: true,
        message: `已发送到 DSH 会话「${String(options?.title || DEFAULT_TITLE)}」`,
        sessionId,
      }
    },
    async test(options, { signal } = {}) {
      const sessionId = await deliver(
        options || {},
        '🐟 大肥鱼推荐：DSH 会话联调成功。这是一条测试消息。',
        signal,
      )
      return { ok: true, message: `DSH 会话测试成功（${sessionId}）` }
    },
  }
}
