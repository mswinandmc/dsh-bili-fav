/**
 * Wake the DSH agent for a real model turn after a push.
 *
 * Unlike a silent context injection, this uses followup (idle) / inject (busy)
 * so the model actually thinks and writes a user-facing reply. The prompt is
 * short and tells the model to read bili_fav_last; it never contains the raw
 * recommendation template that could be echoed to the user.
 */
import { randomId } from './util.js'

function isBusy(agent) {
  try {
    const status = String(agent?.status ?? agent?.phase ?? '')
    return status !== '' && status !== 'idle'
  } catch {
    return false
  }
}

export async function wakeSession({ agents, sessionId, prompt, log = () => {} }) {
  const id = String(sessionId || '').trim()
  const body = String(prompt || '').trim()
  if (!agents || !id || !body) return false
  let agent = null
  try {
    agent = agents.get(id) || null
  } catch {
    agent = null
  }
  if (!agent && typeof agents.resume === 'function') {
    try {
      const resumed = await agents.resume({ resumeSessionId: id })
      agent = resumed?.agent || agents.get?.(id) || null
    } catch {
      agent = null
    }
  }
  if (!agent) return false
  const message = {
    id: randomId('wake'),
    role: 'user',
    content: [{ type: 'text', text: body }],
    source: { kind: 'user' },
  }
  if (!isBusy(agent) && typeof agent.followup === 'function') {
    await agent.followup(message)
    log(`已唤醒 DSH 会话 ${id} 处理推荐`)
    return true
  }
  if (typeof agent.inject === 'function') {
    await agent.inject(message)
    log(`已向 DSH 会话 ${id} 注入推荐回合`)
    return true
  }
  return false
}
