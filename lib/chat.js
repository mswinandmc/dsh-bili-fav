import { oneLine } from './util.js'

/** A QQ recommendation is one short message, never a list. */
export const CHAT_REPLY_LIMIT = 180

function trimEnd(text) {
  return String(text || '').replace(/[\s。！？!?；;，,、：:]+$/u, '')
}

/**
 * Format a conversational recommendation reply from a dry run's picks.
 *
 * The host drafts exactly one short QQ message: one video, 2–3 sentences, no
 * statistics, no numbering and no list. The agent may still rewrite it with the
 * configured reply prompt before calling bili_fav_push.
 */
export function formatChatReply(picks) {
  const list = Array.isArray(picks) ? picks : []
  const pick = list.find((item) => item && (item.bvid || item.title))
  if (!pick) {
    return '这轮没挑到想推的。要不要换个方向，再刷一轮？'
  }
  const title = oneLine(pick.title, 32) || '一条视频'
  const author = oneLine(pick.author, 16)
  const reason = trimEnd(oneLine(pick.reason || pick.why || '', 60))
  const bvid = oneLine(pick.bvid, 16)
  const url = bvid ? `https://www.bilibili.com/video/${bvid}` : ''
  const parts = [`这轮想推一条：《${title}》`]
  if (author) parts.push(`，UP 是${author}`)
  parts.push('。')
  if (reason) parts.push(`${reason}。`)
  if (url) parts.push(` ${url}`)
  return parts.join('').slice(0, CHAT_REPLY_LIMIT)
}
