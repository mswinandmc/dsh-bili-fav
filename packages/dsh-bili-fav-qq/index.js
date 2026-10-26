/**
 * QQ channel adapter for dsh-bili-fav.
 *
 * This package contains no Bilibili logic. It only registers a delivery
 * channel through the core plugin's `biliFavChannels` service, using whichever
 * `qq_send__*` tool the installed QQ Bot plugin exposes.
 */
export const name = 'bili-fav-qq'
export const inject = ['biliFavChannels', 'tools']

const QQ_TOOL = /^qq_send__[A-Za-z0-9_-]+$/

function qqTools(ctx) {
  try {
    return (ctx.tools?.schemas?.() || [])
      .map((schema) => String(schema?.name || ''))
      .filter((toolName) => QQ_TOOL.test(toolName))
  } catch {
    return []
  }
}

function resolveTool(ctx, preferred) {
  const tools = qqTools(ctx)
  if (tools.length === 0) return ''
  const wanted = String(preferred || '').trim()
  if (wanted && tools.includes(wanted)) return wanted
  return tools[0]
}

function toolErrorText(result, name) {
  const content = Array.isArray(result?.content) ? result.content : []
  const text = content
    .filter((item) => item?.type === 'text')
    .map((item) => item.text)
    .join('\n')
  return text || `${name} 执行失败`
}

async function callQQ(ctx, args, { tool, signal } = {}) {
  const toolName = resolveTool(ctx, tool)
  if (!toolName) {
    throw new Error('没有检测到 qq_send 工具；请先在 设置 → QQ Bot 里绑定一个 QQ 人设')
  }
  if (!ctx.tools || typeof ctx.tools.execute !== 'function') {
    throw new Error('宿主没有提供 tools 服务')
  }
  const result = await ctx.tools.execute({
    callId: `bili-fav-qq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: toolName,
    arguments: args,
    signal: signal ?? AbortSignal.timeout(60_000),
  })
  if (result?.isError) throw new Error(toolErrorText(result, toolName))
  const value = result?.value
  if (value && typeof value === 'object' && value.ok === false) {
    throw new Error(value.msg || `${toolName} 返回失败`)
  }
  const message =
    value && typeof value === 'object'
      ? String(value.msg || '')
      : typeof value === 'string'
        ? value
        : ''
  return { ok: true, message: message || '已发送', value, tool: toolName }
}

function scopeOf(options) {
  const scope = String(options?.scope || 'auto')
  return ['group', 'c2c'].includes(scope) ? scope : ''
}

function targetOf(options) {
  return String(options?.target || '').trim()
}

const channel = (ctx) => ({
  id: 'qq',
  label: 'QQ Bot',
  description: '通过当前 QQ Bot 插件注册的 qq_send__* 工具发送推荐。',
  order: 10,
  fields: [
    {
      key: 'target',
      label: '推送到',
      type: 'text',
      required: true,
      placeholder: '群名 / 好友昵称 / 32+ 位 openid',
      help: 'QQ 官方 Bot 的 openid 很长（通常 32 位以上），可直接粘贴；「读取目标」里的短 ID 只是展示用，不要照抄。',
    },
    {
      key: 'scope',
      label: '目标类型',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: '自动识别' },
        { value: 'group', label: '群聊' },
        { value: 'c2c', label: '私聊' },
      ],
      help: '用 openid 发送时建议明确选群聊/私聊；按群名/昵称发送可以留自动。',
    },
    {
      key: 'tool',
      label: 'QQ 发送工具',
      type: 'text',
      placeholder: 'qq_send__standard',
      help: '留空自动选第一个 qq_send__*；有多个 QQ 人设时填完整工具名。',
    },
  ],
  available: () => qqTools(ctx).length > 0,
  async send(payload, options, { signal } = {}) {
    const target = targetOf(options)
    if (!target) throw new Error('QQ 渠道还没有填「推送到」')
    const scope = scopeOf(options)
    const result = await callQQ(
      ctx,
      {
        action: 'send',
        target,
        ...(scope ? { scope } : {}),
        text: String(payload?.text || ''),
      },
      { tool: options?.tool, signal },
    )
    return { ok: true, message: result.message }
  },
  async listTargets(options, { signal } = {}) {
    const result = await callQQ(ctx, { action: 'list' }, { tool: options?.tool, signal })
    return { ok: true, message: result.message }
  },
  async test(options, { signal } = {}) {
    const target = targetOf(options)
    if (!target) throw new Error('请先填 QQ 目标，再测试发送')
    const scope = scopeOf(options)
    const result = await callQQ(
      ctx,
      {
        action: 'send',
        target,
        ...(scope ? { scope } : {}),
        text: [
          '🐟 大肥鱼推荐：QQ 渠道联调成功',
          new Date().toLocaleString('zh-CN'),
          '收到这条消息，就说明「B站自主刷片 → 第三方渠道」链路通了。',
        ].join('\n'),
      },
      { tool: options?.tool, signal },
    )
    return { ok: true, message: result.message }
  },
})

export function apply(ctx) {
  ctx.effect(
    () => ctx.biliFavChannels.register(channel(ctx)),
    'bili-fav-qq: QQ channel',
  )
}
