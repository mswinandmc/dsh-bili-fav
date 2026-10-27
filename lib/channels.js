/**
 * Generic delivery-channel registry for dsh-bili-fav.
 *
 * The core plugin only knows how to browse/choose/favorite. Any plugin can
 * register an additional delivery channel through the `biliFavChannels`
 * service, for example QQ, a webhook, Telegram, or e-mail.
 *
 * Channel contract:
 *   {
 *     id: string,                 // unique, [a-z0-9_-]
 *     label: string,              // shown in settings
 *     description?: string,
 *     order?: number,
 *     fields?: Array<{            // rendered by the core settings page
 *       key, label, type: 'text'|'textarea'|'select'|'checkbox',
 *       required?, placeholder?, help?, default?, options?: [{value,label}]
 *     }>,
 *     available?(): boolean,      // false disables the channel in the UI
 *     send(payload, options, { signal }): Promise<{ ok?, message? }>,
 *     listTargets?(options, { signal }): Promise<{ ok?, message? }>,
 *     test?(options, { signal }): Promise<{ ok?, message? }>,
 *   }
 *
 * `payload` is `{ text, title, picks, folder, mode, test? }`; `text` is already
 * formatted by the core, while structured fields let a channel render its own
 * card/attachment.
 */
import { clampText } from './util.js'

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/
const FIELD_KEY_PATTERN = /^[A-Za-z0-9_-]{1,40}$/
const FIELD_TYPES = new Set(['text', 'textarea', 'select', 'checkbox'])

function sanitizeField(field) {
  if (!field || typeof field !== 'object') return null
  const key = String(field.key || '').trim()
  if (!FIELD_KEY_PATTERN.test(key)) return null
  const type = FIELD_TYPES.has(field.type) ? field.type : 'text'
  const options = Array.isArray(field.options)
    ? field.options
        .map((option) => ({
          value: String(option?.value ?? ''),
          label: String(option?.label ?? option?.value ?? ''),
        }))
        .filter((option) => option.value !== '' || !field.required)
        .slice(0, 20)
    : []
  const fallback =
    typeof field.default === 'string' || typeof field.default === 'number' || typeof field.default === 'boolean'
      ? field.default
      : ''
  return {
    key,
    label: clampText(field.label, 80, key),
    type,
    required: Boolean(field.required),
    placeholder: clampText(field.placeholder, 200, ''),
    help: clampText(field.help, 300, ''),
    default: fallback,
    ...(type === 'select' ? { options } : {}),
  }
}

/** Evaluate a channel's optional availability hook without ever throwing. */
export function isChannelAvailable(channel) {
  if (typeof channel?.available !== 'function') return channel?.available !== false
  try {
    return Boolean(channel.available())
  } catch {
    return false
  }
}

/**
 * Resolve the configured channel and check the metadata a push needs.
 * An empty selection is intentionally different from a broken selection:
 * `no-channel` means the user has not configured delivery at all.
 */
export function channelReadiness(registry, config, channelId) {
  const id = String(channelId || '').trim()
  if (!id) return { ok: false, reason: 'no-channel', channel: null, missing: [] }
  const channel = registry.get(id)
  if (!channel) return { ok: false, reason: 'unknown-channel', channel: null, missing: [] }
  if (!isChannelAvailable(channel)) {
    return { ok: false, reason: 'channel-unavailable', channel, missing: [] }
  }
  const options = config?.channelOptions?.[id] || {}
  const missing = (channel.fields || [])
    .filter((field) => field.required && !String(options[field.key] ?? field.default ?? '').trim())
    .map((field) => field.label || field.key)
  if (missing.length > 0) {
    return { ok: false, reason: 'channel-options', channel, missing }
  }
  return { ok: true, reason: '', channel, missing: [] }
}

export function createChannelRegistry() {
  const channels = new Map()
  const listeners = new Set()

  const changed = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        /* a listener must never break a send */
      }
    }
  }

  const requireChannel = (id) => {
    const channel = channels.get(String(id || ''))
    if (!channel) throw new Error(`未注册的投递渠道「${String(id || '')}」`)
    return channel
  }

  const resultMessage = (result, fallback) => {
    if (result && typeof result === 'object' && result.ok === false) {
      throw new Error(result.message || result.msg || fallback)
    }
    return String(result?.message || result?.msg || fallback)
  }

  return {
    /** Register a channel; the returned disposer removes it. */
    register(channel) {
      const id = String(channel?.id || '').trim()
      if (!ID_PATTERN.test(id)) throw new Error(`渠道 id 非法：${id || '(空)'}`)
      if (channels.has(id)) throw new Error(`渠道「${id}」已经注册过了`)
      if (typeof channel.send !== 'function') throw new Error(`渠道「${id}」缺少 send()`)
      const fields = Array.isArray(channel.fields)
        ? channel.fields.map(sanitizeField).filter(Boolean).slice(0, 20)
        : []
      const descriptor = {
        id,
        label: clampText(channel.label, 80, id),
        description: clampText(channel.description, 300, ''),
        order: Number.isFinite(Number(channel.order)) ? Number(channel.order) : 100,
        fields,
        send: channel.send,
        listTargets: typeof channel.listTargets === 'function' ? channel.listTargets : null,
        test: typeof channel.test === 'function' ? channel.test : null,
        available: typeof channel.available === 'function' ? channel.available : null,
      }
      channels.set(id, descriptor)
      changed()
      let active = true
      return () => {
        if (!active) return
        active = false
        if (channels.get(id) === descriptor) {
          channels.delete(id)
          changed()
        }
      }
    },

    get(id) {
      return channels.get(String(id || '')) || null
    },

    /** Replace a channel's form fields (for dynamic dropdowns). */
    updateFields(id, fields) {
      const channel = channels.get(String(id || ''))
      if (!channel) return false
      channel.fields = Array.isArray(fields)
        ? fields.map(sanitizeField).filter(Boolean).slice(0, 20)
        : []
      changed()
      return true
    },

    /** Serialized descriptors for the settings page. */
    list() {
      return [...channels.values()]
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .map((channel) => ({
          id: channel.id,
          label: channel.label,
          description: channel.description,
          order: channel.order,
          fields: channel.fields,
          available: isChannelAvailable(channel),
          hasList: Boolean(channel.listTargets),
          hasTest: Boolean(channel.test),
        }))
    },

    onChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async send(id, payload, options = {}, { signal } = {}) {
      const channel = requireChannel(id)
      if (!isChannelAvailable(channel)) throw new Error(`渠道「${channel.label}」当前不可用`)
      const result = await channel.send(payload, options || {}, { signal })
      return {
        ok: true,
        channel: channel.label,
        message: resultMessage(result, '已发送'),
      }
    },

    async listTargets(id, options = {}, { signal } = {}) {
      const channel = requireChannel(id)
      if (!channel.listTargets) throw new Error(`渠道「${channel.label}」不支持读取目标`)
      const result = await channel.listTargets(options || {}, { signal })
      return {
        ok: true,
        channel: channel.label,
        message: resultMessage(result, ''),
        targets: Array.isArray(result?.targets) ? result.targets : [],
      }
    },

    async test(id, options = {}, { signal } = {}) {
      const channel = requireChannel(id)
      if (!isChannelAvailable(channel)) throw new Error(`渠道「${channel.label}」当前不可用`)
      if (channel.test) {
        const result = await channel.test(options || {}, { signal })
        return {
          ok: true,
          channel: channel.label,
          message: resultMessage(result, '已发送测试消息'),
        }
      }
      const result = await channel.send(
        { text: '🐟 大肥鱼推荐：渠道联调成功', test: true },
        options || {},
        { signal },
      )
      return {
        ok: true,
        channel: channel.label,
        message: resultMessage(result, '已发送测试消息'),
      }
    },
  }
}
