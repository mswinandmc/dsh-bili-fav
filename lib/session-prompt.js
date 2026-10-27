/**
 * Prompt an existing DSH session to start a real model turn.
 * Used by the autonomous Bilibili task: the model thinks in the session and
 * calls tools (bili_fav_recommend / bili_fav_push) instead of the host pushing
 * the channel directly. If the target session was archived or is gone, create a
 * fresh session under the plugin home and continue there.
 */
import { randomId } from './util.js'

function archivedSessionIds(ctx) {
  try {
    const ids = ctx?.get?.('workspaceRegistry')?.archivedSessionIds
    return Array.isArray(ids) ? ids : []
  } catch {
    return []
  }
}

function createdSessionId(value) {
  if (typeof value === 'string') return value.trim()
  return String(value?.sessionId || '').trim()
}

function isMissingSession(error) {
  const code = String(error?.code || '')
  return code === 'session/not-found' || code === 'SESSION_QUERY_SESSION_NOT_FOUND'
}

function makeRequest(sessionId, text) {
  return {
    requestId: randomId('task'),
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
  }
}

async function sendPrompt(sc, request) {
  try {
    await sc.prompt(request, new AbortController().signal)
    return null
  } catch {
    try {
      await sc.prompt(request)
      return null
    } catch (error) {
      return error
    }
  }
}

async function createReplacement({ sc, home, log, onSessionChanged, reason }) {
  if (typeof sc.create !== 'function') {
    log(`目标会话${reason}，但宿主不支持新建会话`)
    return ''
  }
  if (!home) {
    log(`目标会话${reason}，但没有插件数据目录，无法新建会话`)
    return ''
  }
  let created
  try {
    created = await sc.create({ cwd: home })
  } catch (error) {
    log(`新建 DSH 会话失败：${error instanceof Error ? error.message : String(error)}`)
    return ''
  }
  const id = createdSessionId(created)
  if (!id) {
    log('新建 DSH 会话没有返回 sessionId')
    return ''
  }
  if (typeof sc.rename === 'function') {
    try {
      await sc.rename({ sessionId: id, title: 'B站自主刷片' })
    } catch {
      /* title is cosmetic */
    }
  }
  try {
    await onSessionChanged(id)
  } catch (error) {
    log(`记录新 DSH 会话失败：${error instanceof Error ? error.message : String(error)}`)
  }
  log(`目标会话${reason}，已新建 DSH 会话 ${id}`)
  return id
}

export async function promptSession({
  ctx,
  home = '',
  sessionId,
  text,
  log = () => {},
  onSessionChanged = () => {},
}) {
  const sc = ctx?.get?.('sessionController')
  let id = String(sessionId || '').trim()
  const body = String(text || '').trim()
  if (!sc || typeof sc.prompt !== 'function' || !id || !body) return false

  if (archivedSessionIds(ctx).includes(id)) {
    id = await createReplacement({ sc, home, log, onSessionChanged, reason: '已归档' })
    if (!id) return false
  }

  let error = await sendPrompt(sc, makeRequest(id, body))
  if (error && isMissingSession(error)) {
    const replacement = await createReplacement({ sc, home, log, onSessionChanged, reason: '不存在' })
    if (!replacement) {
      log(`向 DSH 会话投递任务失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    id = replacement
    error = await sendPrompt(sc, makeRequest(id, body))
  }
  if (error) {
    log(`向 DSH 会话投递任务失败：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
  log(`已向 DSH 会话 ${id} 投递任务`)
  return true
}
