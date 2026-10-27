/**
 * Prompt an existing DSH session to start a real model turn.
 * Used by the autonomous Bilibili task: the model thinks in the session and
 * calls tools (bili_fav_recommend / bili_fav_push) instead of the host pushing
 * the channel directly. No session is created here.
 */
import { randomId } from './util.js'

export async function promptSession({ ctx, sessionId, text, log = () => {} }) {
  const sc = ctx?.get?.('sessionController')
  const id = String(sessionId || '').trim()
  const body = String(text || '').trim()
  if (!sc || typeof sc.prompt !== 'function' || !id || !body) return false
  const request = {
    requestId: randomId('task'),
    sessionId: id,
    mode: 'queue',
    content: [{ type: 'text', text: body }],
  }
  try {
    await sc.prompt(request, new AbortController().signal)
  } catch {
    try {
      await sc.prompt(request)
    } catch (error) {
      log(`向 DSH 会话投递任务失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
  log(`已向 DSH 会话 ${id} 投递任务`)
  return true
}
