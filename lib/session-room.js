/**
 * Create a new DSH session for a recommendation conversation.
 *
 * The recommendation session is intentionally separate from the QQ-bound
 * session: the model thinks and chats there, while QQ only receives the clean
 * channel message. No raw context is injected into the current session.
 */
import { randomId } from './util.js'

export async function openRecommendationRoom({ ctx, parentSessionId, title, task, log = () => {} }) {
  const sc = ctx?.get?.('sessionController')
  if (!sc || typeof sc.create !== 'function') return null
  let workspaceId = ''
  if (parentSessionId) {
    try {
      const registry = ctx.get('workspaceRegistry')
      const list = registry?.list?.() ?? []
      const mine = list.find((workspace) => (workspace.sessionIds ?? []).includes(parentSessionId))
      workspaceId = String(mine?.id ?? '')
    } catch {
      /* workspace is optional */
    }
  }
  let created = null
  try {
    created = await sc.create(workspaceId ? { workspaceId } : {})
  } catch (error) {
    log(`创建 DSH 推荐会话失败：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
  const sessionId = String(created?.sessionId || created?.id || '')
  if (!sessionId) return null
  if (title && typeof sc.rename === 'function') {
    try {
      await sc.rename({ sessionId, title })
    } catch {
      /* title is cosmetic */
    }
  }
  const request = {
    requestId: randomId('room'),
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: String(task || '') }],
  }
  let prompted = false
  try {
    await sc.prompt(request, new AbortController().signal)
    prompted = true
  } catch {
    try {
      await sc.prompt(request)
      prompted = true
    } catch (error) {
      log(`向 DSH 推荐会话发送任务失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  log(`已创建 DSH 推荐会话 ${sessionId}${prompted ? '' : '（任务未送达）'}`)
  return { sessionId, prompted, title: String(title || '') }
}
