import { oneLine } from './util.js'

/** A QQ recommendation is two short messages: reason, then link. */
export const CHAT_REPLY_LIMIT = 180

function trimEnd(text) {
  return String(text || '').replace(/[\s。！？!?；;，,、：:]+$/u, '')
}

/**
 * Split a recommendation into the two QQ messages the agent should send
 * separately: one sentence of reason, then the video link. No statistics,
 * numbering or list. The agent may still rewrite the reason with the configured
 * reply prompt before sending.
 */
export function chatReplyParts(picks) {
  const list = Array.isArray(picks) ? picks : []
  const pick = list.find((item) => item && (item.bvid || item.title))
  if (!pick) return []
  const title = oneLine(pick.title, 32) || '一条视频'
  const reason = trimEnd(oneLine(pick.reason || pick.why || '', 70))
  const bvid = oneLine(pick.bvid, 16)
  const url = bvid ? `https://www.bilibili.com/video/${bvid}` : ''
  const line = reason ? `《${title}》${reason}。` : `《${title}》这条挺值得看看。`
  return url ? [line, url] : [line]
}

/** Join the parts for previews/chat; the agent should push them separately. */
export function formatChatReply(picks) {
  const parts = chatReplyParts(picks)
  return parts.length
    ? parts.join('\n').slice(0, CHAT_REPLY_LIMIT)
    : '这轮没挑到想推的。要不要换个方向，再刷一轮？'
}
