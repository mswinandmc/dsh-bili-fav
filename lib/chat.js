import { oneLine } from './util.js'

/**
 * Format a conversational recommendation reply from a dry run's picks.
 * The reply is ready to send by the agent; it is not pushed by the host.
 */
export function formatChatReply(picks) {
  const list = Array.isArray(picks) ? picks : []
  if (list.length === 0) {
    return '我按你说的刷了一圈，这轮没挑到特别想推荐的。要不要换个说法，或者让我按你平时的口味再刷一轮？'
  }
  const lines = [`我按你说的刷了一圈，挑了 ${list.length} 条：`, '']
  list.forEach((pick, index) => {
    lines.push(`${index + 1}. 《${oneLine(pick.title, 100)}》 — ${oneLine(pick.author, 40) || '未知 UP'}`)
    lines.push(`   https://www.bilibili.com/video/${pick.bvid}`)
    if (pick.reason) lines.push(`   为什么：${oneLine(pick.reason, 240)}`)
    lines.push('')
  })
  lines.push('想换一批，或者问某条的理由，直接回我就行。')
  return lines.join('\n').trim()
}
