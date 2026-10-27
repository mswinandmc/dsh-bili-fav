/**
 * Mirror a recommendation into a DSH session as a silent user-context message.
 *
 * This intentionally follows the session_send plugin's proven inbound pattern:
 * role=user + source.kind=user + agent.inject (no followup / no wake). The agent
 * sees the recommendation on its next turn; the Web conversation shows it.
 */
import { randomId } from './util.js'

export async function mirrorToSession({ agents, sessionId, text, log = () => {} }) {
  const id = String(sessionId || '').trim()
  const body = String(text || '').trim()
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
  if (!agent || typeof agent.inject !== 'function') return false
  await agent.inject({
    id: randomId('mirror'),
    role: 'user',
    content: [{ type: 'text', text: body }],
    source: { kind: 'user' },
  })
  log(`已把推荐同步到 DSH 会话 ${id}`)
  return true
}
