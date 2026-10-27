import { oneLine } from './util.js'

/** A QQ recommendation is one short two-line message, never a list. */
export const CHAT_REPLY_LIMIT = 180

function trimEnd(text) {
  return String(text || '').replace(/[\s。！？!?；;，,、：:]+$/u, '')
}

/**
 * Format a conversational recommendation reply from a dry run's picks.
 *
 * The host drafts exactly two lines: one sentence of reason, then the video
 * link on its own line. No statistics, numbering or list. The agent may still
 * rewrite the reason with the configured reply prompt before sending.
 */
export function formatChatReply(picks) {
  const list = Array.isArray(picks) ? picks : []
  const pick = list.find((item) => item && (item.bvid || item.title))
  if (!pick) {
    return '这轮没挑到想推的。要不要换个方向，再刷一轮？'
  }
  const title = oneLine(pick.title, 32) || '一条视频'
  const reason = trimEnd(oneLine(pick.reason || pick.why || '', 70))
  const bvid = oneLine(pick.bvid, 16)
  const url = bvid ? `https://www.bilibili.com/video/${bvid}` : ''
  const lines = [reason ? `《${title}》${reason}。` : `《${title}》这条挺值得看看。`]
  if (url) lines.push(url)
  return lines.join('\n').slice(0, CHAT_REPLY_LIMIT)
}
