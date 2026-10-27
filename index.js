/**
 * Host half of dsh-bili-qq.
 *
 * Responsibilities:
 *   - own the B站 account cookies (0600 file under <DSH_HOME>/bili-fav)
 *   - expose a small authenticated HTTP API for the settings page
 *   - run the autonomous "skim -> read subtitles -> pick -> favorite" round
 *   - expose the same operations as Agent tools
 *   - optional daily timer
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BiliApi, BiliError } from './lib/bili.js'
import { createChannelRegistry } from './lib/channels.js'
import { createWebhookChannel } from './lib/webhook.js'
import { createQQChannel } from './lib/qq-channel.js'
import { formatChatReply } from './lib/chat.js'
import { createSessionChannel } from './lib/session-channel.js'
import { buildWakePlan, firstPendingTime, nextDueTime, planSignature } from './lib/wake.js'
import { promptSession } from './lib/session-prompt.js'
import { curate } from './lib/judge.js'
import { qrSvg } from './lib/qr.js'
import {
  clearCredentials,
  folderLink,
  loadConfig,
  loadCredentials,
  loadState,
  markSeen,
  paths,
  rememberFolder,
  saveConfig,
  saveCredentials,
  saveState,
  sanitizeChannelOptions,
  seenRecently,
  DEFAULT_REPLY_PROMPT,
} from './lib/store.js'
import {
  abortError,
  clampInt,
  errorMessage,
  isAbortError,
  localDayKey,
  makeLogger,
  oneLine,
  randomId,
  readTail,
  resolveHomeDir,
  sameOriginOk,
  sleep,
} from './lib/util.js'

export const name = 'bili-fav'
export const inject = ['webServer', 'tools']

const here = dirname(fileURLToPath(import.meta.url))
let VERSION = '0.2.0-rc2'
try {
  VERSION = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version || VERSION
} catch {
  /* keep the fallback */
}

const API_PREFIX = '/api/bili-fav'
const MAX_BODY = 1_000_000
const LOGIN_TTL_MS = 180_000

function sendJson(res, status, payload) {
  if (res.writableEnded) return
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(payload))
  } catch {
    /* the socket may be gone */
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    let size = 0
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        finish({})
        try {
          req.destroy()
        } catch {
          /* ignore */
        }
        return
      }
      data += chunk
    })
    req.on('end', () => {
      if (!data.trim()) {
        finish({})
        return
      }
      try {
        finish(JSON.parse(data))
      } catch {
        finish({})
      }
    })
    req.on('error', () => finish({}))
  })
}

function publicPick(pick) {
  return {
    bvid: pick.bvid,
    title: pick.title,
    author: pick.author,
    cover: pick.cover,
    duration: pick.duration,
    view: pick.view,
    like: pick.like,
    category: pick.category,
    reason: pick.reason,
    why: pick.why,
    subtitleLines: pick.subtitleLines,
    subtitleChars: pick.subtitleChars,
    status: pick.status,
    error: pick.error,
    folderId: pick.folderId,
    addedAt: pick.addedAt,
  }
}

function summarizeRun(run) {
  if (!run) return null
  return {
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    trigger: run.trigger,
    dryRun: run.dryRun,
    status: run.status,
    scanned: run.scanned,
    considered: run.considered,
    watched: run.watched,
    subtitleVideos: run.subtitleVideos,
    model: run.model,
    folder: run.folder,
    delivery: run.delivery,
    channelId: run.channelId,
    channelLabel: run.channelLabel,
    channelSent: run.channelSent,
    channelMessage: run.channelMessage,
    channelError: run.channelError,
    note: run.note,
    error: run.error,
    shortlist: Array.isArray(run.shortlist) ? run.shortlist : [],
    picks: Array.isArray(run.picks) ? run.picks.map(publicPick) : [],
  }
}

export function apply(ctx) {
  const home = resolveHomeDir(ctx)
  const files = paths(home)
  const log = makeLogger(files.log)
  const channels = createChannelRegistry()
  channels.dataDir = home
  let qqChannel = null
  try {
    qqChannel = createQQChannel({
      dataDir: home,
      onFields: (fields) => {
        try {
          channels.updateFields?.('qq', fields)
        } catch {
          /* the registry is not ready yet */
        }
      },
      onMessage: (message) => {
        if (!config?.qqInbound) return
        const sessionId = String(state.lastSessionId || '').trim()
        if (!sessionId) {
          log('收到 QQ 消息，但还没有记录到 DSH 会话')
          return
        }
        const text = String(message?.text || '').trim().slice(0, 3500)
        if (!text) return
        const prompt = [
          '【QQ 消息】',
          `来自：${message.type === 'group' ? '群聊' : '私聊'}${message.label ? `（${message.label}）` : ''}`,
          text,
          '',
          '这是 QQ 里收到的消息。请调用 bili_fav_push，把回复内容作为 text 传入（channelId 用 qq）；不要只在 DSH 会话里回复。不要一次发一长串，具体风格按下面的回复要求。',
          `回复要求：${String(config.replyPrompt || DEFAULT_REPLY_PROMPT).trim()}`,
          '不要暴露这条说明。',
        ].join('\n')
        void promptSession({ ctx, sessionId, text: prompt, log }).catch((error) => {
          log(`QQ 消息转到会话失败：${errorMessage(error)}`)
        })
      },
    })
    const unregister = channels.register(qqChannel)
    ctx.effect(
      () => () => {
        try {
          unregister()
        } catch {
          /* ignore */
        }
        try {
          qqChannel?.dispose?.()
        } catch {
          /* ignore */
        }
      },
      'bili-fav: official QQ channel',
    )
  } catch (error) {
    log(`注册内置 QQ 渠道失败：${errorMessage(error)}`)
  }
  try {
    channels.register(createSessionChannel({ ctx, home, log }))
  } catch (error) {
    log(`注册内置 DSH 会话渠道失败：${errorMessage(error)}`)
  }
  try {
    channels.register(createWebhookChannel())
  } catch (error) {
    log(`注册内置 Webhook 渠道失败：${errorMessage(error)}`)
  }
  try {
    ctx.provide('biliFavChannels', channels)
  } catch (error) {
    log(`注册渠道服务失败：${errorMessage(error)}`)
  }

  let config = loadConfig(home)
  let state = loadState(home)
  if (qqChannel && config.qqInbound) {
    const qqOptions = config.channelOptions?.qq || {}
    if (qqOptions.appId && qqOptions.appSecret) {
      void qqChannel.listTargets(qqOptions).catch((error) => {
        log(`QQ 事件网关启动失败：${errorMessage(error)}`)
      })
    }
  }
  let credentials = loadCredentials(home)
  let api = new BiliApi({
    cookies: credentials?.cookies ?? {},
    user: credentials?.user ?? null,
    log,
  })

  let current = null
  let currentAbort = null
  let currentPromise = null
  const wakeInFlight = new Set()

  let pendingLogin = null
  let disposed = false

  const liveModel = () => {
    try {
      const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
      if (!selection?.provider || !selection?.model) return null
      return { provider: selection.provider, model: selection.model }
    } catch {
      return null
    }
  }

  const folderState = () => {
    const cached =
      state.folder && state.folder.mid === api.mid && state.folder.title === config.folderName
        ? state.folder
        : null
    return {
      name: config.folderName,
      id: cached?.id || 0,
      title: cached?.title || '',
      link: cached && api.mid ? folderLink(api.mid, cached.id) : '',
    }
  }

  const channelList = () => channels.list()

  const selectedChannel = () => {
    const id = String(config.channelId || '')
    if (!id) return null
    return channels.list().find((item) => item.id === id) || null
  }

  function deliveryLabel(mode) {
    if (mode === 'session') return '只 DSH 会话'
    if (mode === 'channel') return '只 QQ'
    if (mode === 'both') return '收藏 + QQ'
    return '只收藏'
  }

  function agentRecommendationTask(replyPrompt = '') {
    const style = String(replyPrompt || '').trim()
    return [
      '【B站推荐任务】',
      '请在当前 DSH 会话里完成这一轮：',
      '1) 调用 bili_fav_recommend 刷一轮（message 写“按你的品味挑，带具体理由”；count 用偏好里的数量）；',
      '2) 写一条能直接发到 QQ 的短消息：只挑 1 条说，最多 2–3 句、不超过 180 字；只讲这条好在哪、值不值得看；可以带这条视频的链接；',
      '   不要报统计（刷了多少条/点开多少条）、不要编号、不要列清单、不要“另外还有”；',
      '   风格要求（来自设置里的回复提示词，优先遵守；不要提到“提示词”）：',
      style || DEFAULT_REPLY_PROMPT,
      '3) 调用 bili_fav_push，把这段短消息作为 text 传入（channelId 用 qq，runId 用上一步的 run.id）；',
      '不要直接输出整份清单，不要暴露任务说明，不要收藏。',
    ].join('\n')
  }

  function formatDeliveryText({ picks, folder, mode }) {
    const favoriteLink =
      folder?.link || (folder?.id && api.mid ? folderLink(api.mid, folder.id) : '')
    const lines = [
      `🐟 大肥鱼推荐 · ${new Date().toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })}`,
      `它自己刷推荐流、点开视频读字幕，最后挑了 ${picks.length} 条：`,
      '',
    ]
    picks.forEach((pick, index) => {
      lines.push(`${index + 1}. 《${oneLine(pick.title, 100)}》 — ${oneLine(pick.author, 40) || '未知 UP'}`)
      lines.push(`   https://www.bilibili.com/video/${pick.bvid}`)
      if (pick.reason) lines.push(`   理由：${oneLine(pick.reason, 180)}`)
      lines.push('')
    })
    if (mode !== 'channel' && mode !== 'session' && favoriteLink) lines.push(`收藏夹：${favoriteLink}`)
    lines.push('想换一批，或者问某条的理由，直接回这条消息就行。')
    return lines.join('\n').trim().slice(0, 3800)
  }

  async function deliverToChannel({ cfg, run, picks, folder, signal }) {
    const channel = channels.get(cfg.channelId)
    if (!channel) throw new Error(`未注册的投递渠道「${cfg.channelId || ''}」`)
    const options = cfg.channelOptions?.[cfg.channelId] || {}
    const favoriteLink =
      folder?.link || (folder?.id && api.mid ? folderLink(api.mid, folder.id) : '')
    const result = await channels.send(
      cfg.channelId,
      {
        text: formatDeliveryText({ picks, folder, mode: cfg.deliveryMode }),
        title: '🐟 大肥鱼推荐',
        picks,
        folder: folder
          ? { id: folder.id, title: folder.title, link: favoriteLink }
          : null,
        mode: cfg.deliveryMode,
      },
      options,
      { signal },
    )
    run.channelId = cfg.channelId
    run.channelLabel = result.channel || channel.label
    run.channelSent = picks.length
    run.channelMessage = result.message
    log(`渠道推送成功：${picks.length} 条 → ${run.channelLabel}`)
    return result
  }

  function redactConfig(config) {
    const copy = JSON.parse(JSON.stringify(config || {}))
    for (const options of Object.values(copy.channelOptions || {})) {
      if (!options || typeof options !== 'object') continue
      for (const key of Object.keys(options)) {
        if (/secret|token|password|key/i.test(key) && options[key]) options[key] = '••••••'
      }
    }
    return copy
  }

  const publicStatus = () => {
    try {
      config = loadConfig(home)
    } catch (error) {
      log(`重新读取配置失败：${errorMessage(error)}`)
    }
    const mode = config.deliveryMode
    const list = channelList()
    const channel = selectedChannel()
    return {
      ok: true,
      version: VERSION,
      home,
      config,
      login: {
        state: api.loggedIn ? 'logged-in' : 'logged-out',
        user: api.loggedIn ? api.user : null,
        savedAt: credentials?.savedAt || '',
      },
      folder: folderState(),
      model: liveModel(),
      channels: list,
      channel,
      autoPlan: state.wakePlan
        ? {
            date: state.wakePlan.date,
            times: state.wakePlan.times,
            done: state.wakePlan.done,
            nextAt: firstPendingTime(state.wakePlan),
          }
        : null,
      running: current
        ? {
            id: current.id,
            startedAt: current.startedAt,
            phase: current.phase,
            scanned: current.scanned,
            considered: current.considered,
            total: current.total,
            watched: current.watched,
            dryRun: current.dryRun,
            trigger: current.trigger,
            delivery: current.delivery,
            channelId: current.channelId,
            channelLabel: current.channelLabel,
            shortlist: current.shortlist || [],
            picks: (current.picks || []).map(publicPick),
          }
        : null,
      lastRun: summarizeRun(state.runs[0] || null),
      history: state.runs.slice(0, 8).map(summarizeRun),
      logTail: readTail(files.log, 1400),
      note: !api.loggedIn
        ? mode === 'channel' || mode === 'session'
          ? `${mode === 'session' ? 'DSH 会话' : 'QQ'}模式不需要 B站登录：可以用游客推荐流；个性化推荐和字幕仍需要登录。`
          : '未登录时可以「试刷」：用游客推荐流让模型挑一遍，不会写入收藏夹。'
        : mode !== 'favorite' && list.length === 0
          ? '还没有可用的 QQ 投递渠道；安装 dsh-bili-fav-qq 后再刷新。'
          : mode !== 'favorite' && channel && !channel.available
            ? `渠道「${channel.label}」当前不可用；检查它依赖的工具/服务是否在线。`
            : '',
    }
  }

  function finishRun(run, status, { note = '', error = '' } = {}) {
    if (run.status !== 'running') return run
    run.status = status
    run.phase =
      status === 'cancelled' ? '已停止' : status === 'error' ? '失败' : status === 'partial' ? '部分完成' : '完成'
    run.finishedAt = new Date().toISOString()
    run.note = note
    run.error = error
    try {
      state.runs.unshift(run)
      state.runs = state.runs.slice(0, 30)
      saveState(home, state)
    } catch (saveError) {
      log(`保存这一轮结果失败：${errorMessage(saveError)}`)
    }
    const summary = note || error || `${run.picks?.length || 0} 条`
    log(`这一轮结束：${status}（${summary}）`)
    return run
  }

  function abortRun() {
    if (!current || !currentAbort) return false
    current.phase = '正在停止…'
    try {
      currentAbort.abort(new Error('用户停止了这一轮'))
    } catch {
      /* ignore */
    }
    return true
  }

  async function executeRun({ run, cfg, signal }) {
    try {
      const check = () => {
        if (signal.aborted) throw abortError(signal)
      }

      run.phase = '拉取推荐流'
      // Pull a few extra candidates so ads/live cards and already-seen videos
      // do not leave the round short of the requested count.
      const ps = Math.min(30, Math.max(cfg.scan + 6, 12))
      const feed = await api.withRetry(
        () => api.feed({ ps, freshIdx: state.freshIdx, brush: 0, signal }),
        { signal },
      )
      state.freshIdx = (state.freshIdx + 1) % 1_000_000
      if (!feed.length) throw new Error('推荐流里没有拿到视频，请稍后再试')

      const candidates = []
      for (const item of feed) {
        if (candidates.length >= cfg.scan) break
        if (seenRecently(state, item.bvid)) continue
        candidates.push(item)
      }
      run.total = candidates.length
      if (!candidates.length) {
        return finishRun(run, 'ok', { note: '这一批推荐都刷过了，没有新视频；过一会儿再试。' })
      }

      run.phase = '读取视频信息'
      const basic = []
      const aidByBvid = new Map()
      for (let offset = 0; offset < candidates.length; offset += 4) {
        check()
        const slice = candidates.slice(offset, offset + 4)
        const results = await Promise.all(
          slice.map(async (item) => {
            try {
              const detail = await api.withRetry(() => api.video(item.bvid, { signal }), { signal })
              const tags = await api.tags(item.bvid, { signal }).catch(() => [])
              return {
                ...item,
                ...detail,
                bvid: item.bvid,
                tags: tags.length ? tags : [],
                subtitle: '',
                subtitleLines: 0,
                subtitleChars: 0,
              }
            } catch (error) {
              if (isAbortError(error) || signal.aborted) throw error
              log(`跳过 ${item.bvid}：${errorMessage(error)}`)
              return null
            }
          }),
        )
        for (const item of results) {
          if (!item) continue
          basic.push(item)
          aidByBvid.set(item.bvid, item.aid)
        }
        run.scanned = basic.length
      }
      run.considered = basic.length
      if (!basic.length) throw new Error('候选视频都没能读取成功，请稍后再试')
      check()

      run.phase = '模型自己挑想看的'
      const selection = liveModel()
      if (!selection) {
        throw new Error('宿主还没有配置默认模型，无法让模型自己判断（请先在设置里选一个模型）')
      }
      const watchedByBvid = new Map()
      const result = await curate({
        basicVideos: basic,
        guidance: cfg.guidance,
        deepRead: cfg.deepRead,
        count: cfg.count,
        llm: ctx.get('llm'),
        selection,
        signal,
        log,
        readContent: async (shortlist) => {
          run.phase = '点开视频读字幕'
          run.shortlist = shortlist.map((entry) => ({
            bvid: entry.video.bvid,
            title: entry.video.title,
            why: entry.why,
            subtitleLines: 0,
            subtitleChars: 0,
          }))
          const watched = []
          for (let offset = 0; offset < shortlist.length; offset += 3) {
            check()
            const slice = shortlist.slice(offset, offset + 3)
            const items = await Promise.all(
              slice.map(async (entry) => {
                const video = entry.video
                let subtitle = ''
                let subtitleLines = 0
                if (cfg.readSubtitles && api.loggedIn) {
                  try {
                    const sub = await api.subtitle(
                      { aid: video.aid, cid: video.cid },
                      { signal, maxChars: 2200 },
                    )
                    subtitle = sub.text
                    subtitleLines = sub.lines
                    const meta = run.shortlist.find((item) => item.bvid === video.bvid)
                    if (meta) {
                      meta.subtitleLines = sub.lines
                      meta.subtitleChars = sub.text.length
                    }
                  } catch (error) {
                    if (isAbortError(error) || signal.aborted) throw error
                    log(`读字幕失败 ${video.bvid}：${errorMessage(error)}`)
                  }
                }
                const watchedVideo = {
                  ...video,
                  subtitle,
                  subtitleLines,
                  subtitleChars: subtitle.length,
                  why: entry.why,
                }
                watchedByBvid.set(video.bvid, watchedVideo)
                return watchedVideo
              }),
            )
            watched.push(...items)
            run.watched = watched.length
          }
          return watched
        },
      })
      check()

      run.model = result.model
      run.watched = result.watched.length
      run.subtitleVideos = result.watched.filter((video) => video.subtitle).length
      run.shortlist = result.shortlist.map((entry) => {
        const watched = watchedByBvid.get(entry.video.bvid)
        return {
          bvid: entry.video.bvid,
          title: entry.video.title,
          why: entry.why,
          subtitleLines: watched?.subtitleLines || 0,
          subtitleChars: watched?.subtitleChars || 0,
        }
      })
      run.picks = result.picks.map((entry) => {
        const video = entry.video
        const aid = aidByBvid.get(video.bvid) || video.aid || 0
        return {
          bvid: video.bvid,
          title: video.title,
          author: video.author,
          cover: video.cover,
          duration: video.duration,
          view: video.view,
          like: video.like,
          category: video.category,
          reason: entry.reason,
          why: video.why || '',
          subtitleLines: video.subtitleLines || 0,
          subtitleChars: video.subtitleChars || 0,
          status: 'preview',
          error: '',
          folderId: 0,
          addedAt: '',
          aid,
        }
      })

      const mode = ['favorite', 'channel', 'both', 'session'].includes(cfg.deliveryMode)
        ? cfg.deliveryMode
        : 'session'
      const doFavorite = mode === 'favorite' || mode === 'both'
      const doChannel = mode !== 'favorite'
      run.delivery = mode
      run.channelId = doChannel ? cfg.channelId : ''
      run.channelLabel = doChannel ? channels.get(cfg.channelId)?.label || cfg.channelId : ''

      if (!run.picks.length) {
        return finishRun(run, 'ok', {
          note: `它这一轮没有找到真正想${doFavorite && doChannel ? '收藏/推送' : doFavorite ? '收藏' : '推送'}的视频。`,
        })
      }

      if (run.dryRun) {
        return finishRun(run, 'ok', {
          note: `试刷（${deliveryLabel(mode)}）：模型想挑 ${run.picks.length} 条，这次没有写入收藏夹，也没有发送渠道。`,
        })
      }

      let folder = null
      let saved = 0
      let failed = 0
      let favoriteError = ''
      if (doFavorite) {
        run.phase = `准备收藏夹「${cfg.folderName}」`
        try {
          folder = await api.ensureFolder(cfg.folderName, { signal })
          run.folder = folder.title
          try {
            rememberFolder(home, state, folder, api.mid)
          } catch (error) {
            log(`记录收藏夹失败：${errorMessage(error)}`)
          }
        } catch (error) {
          if (isAbortError(error) || signal.aborted) throw error
          favoriteError = `准备收藏夹失败：${errorMessage(error)}`
          log(favoriteError)
        }

        if (folder) {
          run.phase = `收藏到「${folder.title}」`
          for (const pick of run.picks) {
            check()
            try {
              const aid = pick.aid || aidByBvid.get(pick.bvid) || 0
              if (!aid) throw new Error('没有拿到视频 aid，无法收藏')
              await api.favorite(aid, folder.id, { signal })
              pick.status = 'saved'
              pick.folderId = folder.id
              pick.addedAt = new Date().toISOString()
              markSeen(state, pick.bvid)
              saved += 1
            } catch (error) {
              if (isAbortError(error) || signal.aborted) throw error
              pick.status = 'failed'
              pick.error = errorMessage(error)
              if (!favoriteError) favoriteError = pick.error
              failed += 1
              log(`收藏 ${pick.bvid} 失败：${pick.error}`)
            }
            await sleep(420, signal)
          }
        } else {
          for (const pick of run.picks) {
            pick.status = 'failed'
            pick.error = favoriteError
          }
          failed = run.picks.length
        }
      }

      let channelOk = false
      let channelError = ''
      if (doChannel) {
        const channel = channels.get(cfg.channelId)
        run.phase = `推送到 ${channel?.label || cfg.channelId}`
        try {
          await deliverToChannel({ cfg, run, picks: run.picks, folder, signal })
          channelOk = true
        } catch (error) {
          if (isAbortError(error) || signal.aborted) throw error
          channelError = errorMessage(error)
          run.channelError = channelError
          log(`渠道推送失败：${channelError}`)
        }
      }

      const favoriteOk = saved > 0
      if (mode === 'favorite') {
        if (!favoriteOk) {
          return finishRun(run, 'error', {
            error: `全部收藏失败：${favoriteError || '未知原因'}`,
            note: `模型挑了 ${run.picks.length} 条，但都没能写进收藏夹。`,
          })
        }
        return finishRun(run, failed > 0 ? 'partial' : 'ok', {
          note: `已收藏 ${saved} 条到「${folder.title}」${failed > 0 ? `，${failed} 条失败` : ''}`,
          error: failed > 0 ? favoriteError : '',
        })
      }

      if (mode === 'channel' || mode === 'session') {
        if (!channelOk) {
          for (const pick of run.picks) {
            pick.status = 'failed'
            pick.error = channelError
          }
          return finishRun(run, 'error', {
            error: `渠道推送失败：${channelError}`,
            note: `模型挑了 ${run.picks.length} 条，但没有发到渠道。`,
          })
        }
        for (const pick of run.picks) {
          pick.status = 'pushed'
          pick.error = ''
          markSeen(state, pick.bvid)
        }
        return finishRun(run, 'ok', {
          note: `已推送 ${run.picks.length} 条到 ${run.channelLabel}`,
        })
      }

      // both
      if (channelOk) {
        for (const pick of run.picks) markSeen(state, pick.bvid)
      }
      if (favoriteOk && channelOk) {
        return finishRun(run, failed > 0 ? 'partial' : 'ok', {
          note: `已收藏 ${saved} 条到「${folder.title}」，并推送 ${run.picks.length} 条到 ${run.channelLabel}${
            failed > 0 ? `；${failed} 条收藏失败` : ''
          }`,
          error: failed > 0 ? favoriteError : '',
        })
      }
      if (favoriteOk && !channelOk) {
        return finishRun(run, 'partial', {
          note: `已收藏 ${saved} 条到「${folder.title}」；渠道推送失败。`,
          error: channelError,
        })
      }
      if (!favoriteOk && channelOk) {
        return finishRun(run, 'partial', {
          note: `渠道已推送 ${run.picks.length} 条；收藏失败。`,
          error: favoriteError || '收藏失败',
        })
      }
      return finishRun(run, 'error', {
        error: `收藏和渠道推送都失败：收藏=${favoriteError || '未知'}；渠道=${channelError || '未知'}`,
        note: `模型挑了 ${run.picks.length} 条，但两路都没成功。`,
      })
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        return finishRun(run, 'cancelled', { note: '已停止这一轮。' })
      }
      log(`这一轮失败：${errorMessage(error)}`)
      return finishRun(run, 'error', { error: errorMessage(error) })
    }
  }

  function startRun({ dryRun = false, count = null, trigger = 'manual', guidance = null, mode: modeOverride = null } = {}) {
    if (current) {
      return { ok: false, started: false, reason: 'running', message: '已经有一轮在跑了，等它结束。' }
    }
    try {
      config = loadConfig(home)
    } catch (error) {
      log(`开始前读取配置失败：${errorMessage(error)}`)
    }
    const mode = ['favorite', 'channel', 'both', 'session'].includes(modeOverride)
      ? modeOverride
      : ['favorite', 'channel', 'both', 'session'].includes(config.deliveryMode)
        ? config.deliveryMode
        : 'session'
    const doFavorite = mode === 'favorite' || mode === 'both'
    const doChannel = mode !== 'favorite'
    const effectiveChannelId = doChannel ? (mode === 'session' ? 'session' : config.channelId) : ''
    const channelDescriptor = doChannel
      ? channelList().find((item) => item.id === effectiveChannelId) || null
      : null
    if (!dryRun) {
      if (doFavorite && !api.loggedIn) {
        return {
          ok: false,
          started: false,
          reason: 'not-logged-in',
          message: '请先在设置页扫码登录 B站，再开始收藏。',
        }
      }
      if (doChannel) {
        if (!String(effectiveChannelId || '').trim()) {
          return {
            ok: false,
            started: false,
            reason: 'no-channel',
            message: '请先在偏好里选择一个投递渠道。',
          }
        }
        if (!channels.get(effectiveChannelId) || !channelDescriptor) {
          return {
            ok: false,
            started: false,
            reason: 'unknown-channel',
            message: `渠道「${effectiveChannelId}」没有注册；请刷新或检查插件。`,
          }
        }
        if (channelDescriptor.available === false) {
          return {
            ok: false,
            started: false,
            reason: 'channel-unavailable',
            message: `渠道「${channelDescriptor.label}」当前不可用；检查它依赖的工具/服务是否在线。`,
          }
        }
        const options = config.channelOptions?.[effectiveChannelId] || {}
        const missing = (channelDescriptor.fields || [])
          .filter((field) => field.required && !String(options[field.key] ?? field.default ?? '').trim())
          .map((field) => field.label || field.key)
        if (missing.length > 0) {
          return {
            ok: false,
            started: false,
            reason: 'channel-options',
            message: `渠道「${channelDescriptor.label}」还缺：${missing.join('、')}。`,
          }
        }
      }
    }
    const cfg = {
      ...config,
      deliveryMode: mode,
      channelId: effectiveChannelId,
      guidance:
        guidance === null || guidance === undefined
          ? config.guidance
          : String(guidance).trim().slice(0, 4000) || config.guidance,
      count: count === null || count === undefined ? config.count : clampInt(count, 1, 10, config.count),
    }
    const controller = new AbortController()
    const run = {
      id: randomId('run'),
      startedAt: new Date().toISOString(),
      finishedAt: '',
      trigger,
      dryRun: Boolean(dryRun),
      status: 'running',
      phase: '准备开始',
      scanned: 0,
      considered: 0,
      total: cfg.scan,
      watched: 0,
      subtitleVideos: 0,
      model: '',
      folder: '',
      delivery: mode,
      channelId: doChannel ? cfg.channelId : '',
      channelLabel: doChannel ? channelDescriptor?.label || cfg.channelId : '',
      channelSent: 0,
      channelMessage: '',
      channelError: '',
      note: '',
      error: '',
      shortlist: [],
      picks: [],
    }
    current = run
    currentAbort = controller
    const promise = executeRun({ run, cfg, signal: controller.signal })
    currentPromise = promise
    promise.then(
      () => {
        if (current === run) current = null
        if (currentAbort === controller) currentAbort = null
        if (currentPromise === promise) currentPromise = null
      },
      (error) => {
        log(`运行收尾时出错：${errorMessage(error)}`)
        if (current === run) current = null
        if (currentAbort === controller) currentAbort = null
        if (currentPromise === promise) currentPromise = null
      },
    )
    log(
      `开刷（${trigger}${dryRun ? '，试刷' : ''}，${deliveryLabel(mode)}）：扫 ${cfg.scan} 条，最多挑 ${cfg.count} 条${
        doFavorite ? `，收藏到「${cfg.folderName}」` : ''
      }${doChannel ? `，推送到 ${channelDescriptor?.label || cfg.channelId}` : ''}`,
    )
    return { ok: true, started: true, runId: run.id, dryRun: Boolean(dryRun), promise }
  }

  function fenceReject(req, res) {
    try {
      const connection = ctx.get('connection')
      if (connection && typeof connection.requestRejection === 'function') {
        const rejection = connection.requestRejection({ headers: req.headers })
        if (rejection !== undefined) {
          res.statusCode = rejection
          try {
            res.end()
          } catch {
            /* ignore */
          }
          return true
        }
        return false
      }
    } catch (error) {
      log(`信任栅栏调用失败，退回同源检查：${errorMessage(error)}`)
    }
    if (!sameOriginOk(req)) {
      sendJson(res, 403, { ok: false, error: '只接受本机同源请求' })
      return true
    }
    return false
  }

  function requireLogin() {
    if (!api.loggedIn) {
      const error = new BiliError('请先在设置页扫码登录 B站账号', { code: -101 })
      throw error
    }
  }

  async function handleHttp(req, res) {
    if (fenceReject(req, res)) return
    let url
    try {
      url = new URL(req.url, 'http://127.0.0.1')
    } catch {
      sendJson(res, 400, { ok: false, error: '请求地址无效' })
      return
    }
    const path = url.pathname
    if (!path.startsWith(API_PREFIX)) {
      sendJson(res, 404, { ok: false, error: 'not found' })
      return
    }
    try {
      if (req.method === 'GET' && path === `${API_PREFIX}/status`) {
        sendJson(res, 200, publicStatus())
        return
      }

      if (req.method === 'POST' && path === `${API_PREFIX}/config`) {
        const body = await readBody(req)
        const patch = body?.config && typeof body.config === 'object' ? body.config : body
        config = saveConfig(home, patch)
        if (qqChannel && config.qqInbound) {
          const qqOptions = config.channelOptions?.qq || {}
          if (qqOptions.appId && qqOptions.appSecret) {
            void qqChannel.listTargets(qqOptions).catch((error) => {
              log(`QQ 事件网关启动失败：${errorMessage(error)}`)
            })
          }
        }
        sendJson(res, 200, { ok: true, config })
        return
      }

      if (req.method === 'POST' && path === `${API_PREFIX}/login/start`) {
        const started = await api.qrStart()
        pendingLogin = {
          key: started.key,
          url: started.url,
          createdAt: Date.now(),
          state: 'pending',
          message: '等待扫码',
          inFlight: false,
        }
        sendJson(res, 200, {
          ok: true,
          key: started.key,
          qrSvg: qrSvg(started.url, { cellSize: 7, margin: 3 }),
          expiresIn: Math.floor(LOGIN_TTL_MS / 1000),
        })
        log('已生成登录二维码')
        return
      }

      if (req.method === 'POST' && path === `${API_PREFIX}/login/poll`) {
        const body = await readBody(req)
        const key = String(body?.key || '')
        if (!pendingLogin || pendingLogin.key !== key) {
          sendJson(res, 200, {
            ok: true,
            state: 'expired',
            message: '二维码已失效，请重新生成',
          })
          return
        }
        if (Date.now() - pendingLogin.createdAt > LOGIN_TTL_MS) {
          pendingLogin = null
          sendJson(res, 200, { ok: true, state: 'expired', message: '二维码已过期，请重新生成' })
          return
        }
        if (pendingLogin.inFlight) {
          sendJson(res, 200, {
            ok: true,
            state: pendingLogin.state,
            message: pendingLogin.message,
          })
          return
        }
        pendingLogin.inFlight = true
        try {
          const result = await api.qrPoll(key)
          pendingLogin.state = result.state
          pendingLogin.message = result.message
          if (result.state === 'confirmed') {
            let nav = await api.nav()
            if (!api.loggedIn || nav.code !== 0 || !api.user?.mid) {
              // The passport cookie can take a moment to become valid on the
              // main site; one short retry avoids asking for a fresh QR.
              await sleep(700)
              nav = await api.nav()
            }
            if (!api.loggedIn || nav.code !== 0 || !api.user?.mid) {
              throw new Error('登录成功但读取账号信息失败，请重新生成二维码再试')
            }
            await api.fingerprint()
            credentials = saveCredentials(home, {
              cookies: api.snapshotCookies(),
              user: api.user,
            })
            pendingLogin = null
            log(`已登录：${credentials.user.uname || 'B站用户'}（UID ${credentials.user.mid}）`)
            sendJson(res, 200, {
              ok: true,
              state: 'confirmed',
              message: '登录成功',
              user: credentials.user,
            })
            return
          }
          if (result.state === 'expired' || result.state === 'error') pendingLogin = null
          sendJson(res, 200, { ok: true, state: result.state, message: result.message })
        } finally {
          if (pendingLogin) pendingLogin.inFlight = false
        }
        return
      }

      if (req.method === 'POST' && path === `${API_PREFIX}/logout`) {
        abortRun()
        api = new BiliApi({ log })
        credentials = null
        pendingLogin = null
        state.folder = null
        clearCredentials(home)
        try {
          saveState(home, state)
        } catch (error) {
          log(`清理本地状态失败：${errorMessage(error)}`)
        }
        sendJson(res, 200, { ok: true, ...publicStatus() })
        log('已退出 B站账号，本地凭证已删除')
        return
      }

      if (req.method === 'GET' && path === `${API_PREFIX}/folders`) {
        requireLogin()
        const folders = await api.folders()
        sendJson(res, 200, { ok: true, folders })
        return
      }

      if (req.method === 'POST' && path === `${API_PREFIX}/channel/targets`) {
        const body = await readBody(req)
        const channelId = String(body?.channelId || config.channelId || '').trim()
        if (!channelId) throw new Error('缺少 channelId')
        const options = sanitizeChannelOptions({ [channelId]: body?.options || {} })[channelId] || {}
        const result = await channels.listTargets(channelId, options, {
          signal: AbortSignal.timeout(60_000),
        })
        sendJson(res, 200, { ok: true, message: result.message, channel: result.channel, targets: result.targets || [] })
        return
      }

      if (req.method === 'POST' && path === `${API_PREFIX}/channel/test`) {
        const body = await readBody(req)
        const channelId = String(body?.channelId || config.channelId || '').trim()
        if (!channelId) throw new Error('缺少 channelId')
        const options = sanitizeChannelOptions({ [channelId]: body?.options || {} })[channelId] || {}
        const result = await channels.test(channelId, options, {
          signal: AbortSignal.timeout(60_000),
        })
        sendJson(res, 200, { ok: true, message: result.message, channel: result.channel })
        return
      }

      if (req.method === 'POST' && path === `${API_PREFIX}/run`) {
        const body = await readBody(req)
        const dryRun = Boolean(body?.dryRun)
        const count = body?.count === undefined ? null : body.count
        if (!dryRun) {
          const sessionId = String(state.lastSessionId || '').trim()
          if (!sessionId) {
            sendJson(res, 200, {
              ok: false,
              reason: 'no-session',
              message: '还没有记录到 DSH 会话；先在 QQ 会话里和 agent 交互一次再点。',
            })
            return
          }
          void promptSession({ ctx, sessionId, text: agentRecommendationTask(config.replyPrompt), log }).catch((error) => {
            log(`手动任务投递异常：${errorMessage(error)}`)
          })
          sendJson(res, 200, {
            ok: true,
            task: true,
            sessionId,
            message: '已交给 DSH 会话：agent 会刷一轮、自己写文案并调工具推 QQ。',
          })
          return
        }
        const started = startRun({ dryRun: true, count, trigger: 'manual' })
        const { promise, ...visible } = started
        sendJson(res, 200, visible)
        return
      }

      if (req.method === 'POST' && path === `${API_PREFIX}/cancel`) {
        const stopped = abortRun()
        sendJson(res, 200, { ok: true, stopped })
        return
      }

      sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
    } catch (error) {
      const status = error instanceof BiliError && error.code === -101 ? 401 : 500
      log(`HTTP ${req.method} ${path} 失败：${errorMessage(error)}`)
      sendJson(res, status, { ok: false, error: errorMessage(error) })
    }
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: (req, res) => {
          handleHttp(req, res).catch((error) => {
            log(`HTTP 处理异常：${errorMessage(error)}`)
            sendJson(res, 500, { ok: false, error: '插件内部错误' })
          })
        },
      }),
    'bili-fav: settings API',
  )

  const toolOutput = {
    schema: { type: 'object', additionalProperties: true },
    render(_args, value) {
      return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
  }

  const captureSession = (exec) => {
    const rawId = String(exec?.agent?.id ?? exec?.sessionId ?? '').trim()
    if (!rawId) return
    let targetId = rawId
    try {
      const sessions = ctx.get('sessions')
      const parent = sessions?.get?.(rawId)?.header?.parentSession
      if (parent) targetId = String(parent)
    } catch {
      /* sessions is optional */
    }
    if (!targetId) return
    const next = targetId.slice(0, 120)
    if (state.lastSessionId === next) return
    state.lastSessionId = next
    try {
      saveState(home, state)
    } catch (error) {
      log(`记录 DSH 会话失败：${errorMessage(error)}`)
    }
  }

  const registerTool = (definition) => {
    const execute = definition.execute
    const wrapped = {
      ...definition,
      async execute(args, exec) {
        captureSession(exec)
        return execute.call(definition, args, exec)
      },
    }
    ctx.effect(() => ctx.tools.register({ ...wrapped, output: toolOutput }), `bili-fav: ${definition.name}`)
  }

  registerTool({
    name: 'bili_fav_status',
    description:
      '查看「B站自主刷片」的状态：是否已登录 B站、模型是谁、投递方式、目标收藏夹、已注册的 QQ 渠道、最近一轮它点开了什么、收藏/推送了什么。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const status = publicStatus()
      return {
        ok: true,
        version: status.version,
        login: status.login,
        model: status.model,
        folder: status.folder,
        channels: status.channels,
        channel: status.channel,
        running: status.running,
        lastRun: status.lastRun,
        config: redactConfig(status.config),
        note: status.note,
      }
    },
  })

  registerTool({
    name: 'bili_fav_preview',
    description:
      '让模型自己刷一轮 B站推荐流：凭它自己的品味点开一些视频、读字幕，再决定想推荐哪些；只预览，不写入收藏夹、也不发送渠道。返回它点开了什么、最后想收藏/推送什么以及理由。',
    timeoutMs: 240_000,
    parameters: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: '这一轮最多想收藏几条（1-10，默认用设置里的值）',
        },
      },
    },
    async execute(args) {
      const count = args?.count === undefined ? null : clampInt(args.count, 1, 10, config.count)
      const started = startRun({ dryRun: true, count, trigger: 'tool' })
      if (!started.started) return { ok: false, ...started }
      const run = await started.promise
      return { ok: run.status === 'ok' || run.status === 'partial', run: summarizeRun(run) }
    },
  })

  registerTool({
    name: 'bili_fav_recommend',
    description:
      '当用户在对话里让你推荐 B站视频、换一批，或者问“有什么好看/为什么推这个”时使用：把用户这句话作为一次性偏好，即时刷一轮推荐流，返回一条中性的短推荐草稿（只讲 1 条、2–3 句、≤180 字）和理由，以及配置的 replyPrompt；最终回复要按 replyPrompt 补上称呼/自称和语气。不收藏、不推送，也不修改已保存的偏好。追问上一批某条推荐的理由时，先读 bili_fav_status 的 lastRun，不要重新刷。',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '用户原话或这次想看的方向',
        },
        count: {
          type: 'number',
          description: '最多推几条（1-5，默认 3）',
        },
      },
      required: ['message'],
    },
    timeoutMs: 240_000,
    async execute(args, exec) {
      const message = String(args?.message || '').trim().slice(0, 2000)
      if (!message) return { ok: false, error: '缺少用户这句话' }
      const count = args?.count === undefined ? 3 : clampInt(args.count, 1, 5, 3)
      const started = startRun({ dryRun: true, count, trigger: 'chat', guidance: message })
      if (!started.started) return { ok: false, ...started }
      const onAbort = () => abortRun()
      exec?.signal?.addEventListener?.('abort', onAbort, { once: true })
      try {
        const run = await started.promise
        return {
          ok: run.status === 'ok' || run.status === 'partial',
          reply: formatChatReply(run.picks || []),
          replyPrompt: config.replyPrompt,
          picks: (run.picks || []).map(publicPick),
          run: summarizeRun(run),
          ...(run.status === 'error' ? { error: run.error } : {}),
        }
      } finally {
        exec?.signal?.removeEventListener?.('abort', onAbort)
      }
    },
  })

  registerTool({
    name: 'bili_fav_push',
    description:
      '把你在 DSH 会话里写好的内容通过 QQ 渠道发给用户（只发送，不收藏，不再套模板）。必须传 text；可以是推荐文案，也可以是普通 QQ 回复。runId 可选。到点自动任务、回复 QQ 消息或用户说“推给我/推到QQ”时用。',
    parameters: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          description: 'bili_fav_recommend / bili_fav_run 返回的 run id；不填=最近一轮',
        },
        channelId: {
          type: 'string',
          description: '渠道 id；默认优先 qq',
        },
        text: {
          type: 'string',
          description: '必填：你在 DSH 会话里自己写好的 QQ 消息；推荐时只讲 1 条、2–3 句、≤180 字，不报统计、不列清单',
        },
      },
      required: ['text'],
    },
    timeoutMs: 60_000,
    async execute(args = {}) {
      let configNow = config
      try {
        configNow = loadConfig(home)
      } catch (error) {
        log(`推送前读取配置失败：${errorMessage(error)}`)
      }
      const channelId = String(
        args.channelId || (channels.get('qq') ? 'qq' : configNow.channelId) || '',
      ).trim()
      if (!channelId) return { ok: false, error: '没有配置 QQ 推送渠道' }
      const channel = channels.get(channelId)
      if (!channel) return { ok: false, error: `渠道「${channelId}」没有注册` }
      if (channel.available === false) return { ok: false, error: `渠道「${channel.label}」当前不可用` }
      const options = configNow.channelOptions?.[channelId] || {}
      const missing = (channel.fields || [])
        .filter((field) => field.required && !String(options[field.key] ?? field.default ?? '').trim())
        .map((field) => field.label || field.key)
      if (missing.length > 0) {
        return { ok: false, error: `渠道「${channel.label}」还缺：${missing.join('、')}` }
      }
      const run = args.runId
        ? (state.runs || []).find((item) => item.id === args.runId)
        : (state.runs || [])[0]
      const text = String(args.text || '').trim().slice(0, 4000)
      if (!text) return { ok: false, error: '缺少 text：先在 DSH 会话里写好要发送的内容' }
      const picks = Array.isArray(run?.picks) ? run.picks : []
      try {
        const result = await channels.send(
          channelId,
          {
            text,
            title: '🐟 大肥鱼推荐',
            picks,
            folder: null,
            mode: 'channel',
            runId: run?.id || '',
          },
          options,
        )
        return {
          ok: true,
          message: result?.message || `已推送到 ${channel.label}`,
          channelId,
          channelLabel: result?.channel || channel.label,
          runId: run?.id || '',
          count: picks.length,
        }
      } catch (error) {
        return { ok: false, error: `推送失败：${errorMessage(error)}` }
      }
    },
  })

  registerTool({
    name: 'bili_fav_last',
    description:
      '只读：读取最近一轮推荐（标题、链接、每条理由），用于回答用户“刚才推荐了什么/为什么推这个”。不会收藏、推送，也不会往会话注入消息；用户没问就不要主动调用。',
    parameters: { type: 'object', properties: {} },
    timeoutMs: 15_000,
    async execute() {
      const run = (state.runs || []).find(
        (item) => Array.isArray(item.picks) && item.picks.length > 0,
      )
      if (!run) return { ok: false, error: '最近还没有推荐' }
      return {
        ok: true,
        runId: run.id,
        trigger: run.trigger,
        dryRun: run.dryRun,
        finishedAt: run.finishedAt,
        picks: run.picks.map((pick) => ({
          bvid: pick.bvid,
          title: pick.title,
          author: pick.author,
          url: `https://www.bilibili.com/video/${pick.bvid}`,
          reason: pick.reason || pick.why || '',
        })),
      }
    },
  })

  registerTool({
    name: 'bili_fav_run',
    description:
      '只收藏：让模型自己刷一轮 B站推荐流，按它自己的判断挑片并写进收藏夹；不会推送 QQ。推送 QQ 请另用 bili_fav_push，且文案由你在会话里自己写。收藏需要 B站登录。',
    parameters: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: '这一轮最多挑几条（1-10，默认用设置里的值）',
        },
      },
    },
    timeoutMs: 240_000,
    async execute(args, exec) {
      const count = args?.count === undefined ? null : clampInt(args.count, 1, 10, config.count)
      const started = startRun({ dryRun: false, count, trigger: 'tool', mode: 'favorite' })
      if (!started.started) return { ok: false, ...started }
      const onAbort = () => abortRun()
      exec?.signal?.addEventListener?.('abort', onAbort, { once: true })
      try {
        const run = await started.promise
        return { ok: run.status === 'ok' || run.status === 'partial', run: summarizeRun(run) }
      } finally {
        exec?.signal?.removeEventListener?.('abort', onAbort)
      }
    },
  })

  registerTool({
    name: 'bili_fav_folders',
    description: '列出当前登录的 B站账号里的收藏夹（名称、id、视频数、公开/私密），用来选择要收藏到哪个收藏夹。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      if (!api.loggedIn) return { ok: false, error: '请先在设置页扫码登录 B站账号' }
      const folders = await api.folders()
      return { ok: true, folders, current: config.folderName }
    },
  })

  registerTool({
    name: 'bili_fav_channels',
    description:
      '查看已注册的 QQ 投递渠道；action=list 只读列出渠道和配置字段；action=targets 让当前渠道读取可用目标；action=test 让当前渠道发送一条测试消息。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'targets', 'test'],
          description: 'list=只读列渠道；targets=读取目标；test=发测试消息',
        },
        channelId: {
          type: 'string',
          description: '渠道 id；省略时用设置里选中的渠道',
        },
        options: {
          type: 'object',
          description: '临时覆盖渠道 options（如 target/scope）',
          additionalProperties: true,
        },
      },
    },
    timeoutMs: 60_000,
    async execute(args) {
      const action = args?.action || 'list'
      if (action === 'list') return { ok: true, channels: channelList() }
      const channelId = String(args?.channelId || config.channelId || '').trim()
      if (!channelId) return { ok: false, error: '没有选中的渠道，请指定 channelId' }
      const options =
        sanitizeChannelOptions({
          [channelId]: args?.options || config.channelOptions?.[channelId] || {},
        })[channelId] || {}
      const result =
        action === 'test'
          ? await channels.test(channelId, options, { signal: AbortSignal.timeout(60_000) })
          : await channels.listTargets(channelId, options, { signal: AbortSignal.timeout(60_000) })
      return { ok: true, message: result.message, channel: result.channel }
    },
  })

  ctx.effect(() => {
    const timer = setInterval(() => {
      if (disposed || current) return
      try {
        config = loadConfig(home)
        if (!config.autoRun.enabled) return
        const now = new Date()
        const day = localDayKey(now)
        const nowMinutes = now.getHours() * 60 + now.getMinutes()
        const signature = planSignature(config.autoRun.windows, config.autoRun.minGapMin)
        let plan = state.wakePlan
        if (!plan || plan.date !== day || plan.signature !== signature) {
          plan = buildWakePlan({
            windows: config.autoRun.windows,
            minGapMin: config.autoRun.minGapMin,
            date: day,
          })
          plan.done = {}
          state.wakePlan = plan
          saveState(home, state)
          log(`自主唤醒计划 ${day}：${plan.times.join('、') || '无'}`)
        }
        const due = nextDueTime(plan, nowMinutes, 15)
        if (!due || wakeInFlight.has(due)) return
        const sessionId = String(state.lastSessionId || '').trim()
        if (!sessionId) {
          log(`到自主唤醒点 ${due}，但还没有记录到 DSH 会话`)
          return
        }
        const task = agentRecommendationTask(config.replyPrompt)
        wakeInFlight.add(due)
        void promptSession({ ctx, sessionId, text: task, log })
          .then((ok) => {
            if (!ok) return
            plan.done = { ...(plan.done || {}), [due]: true }
            saveState(home, state)
            log(`自主唤醒 ${due} → ${sessionId}`)
          })
          .catch((error) => {
            log(`自主唤醒投递异常：${errorMessage(error)}`)
          })
          .finally(() => {
            wakeInFlight.delete(due)
          })
        log(`到自主唤醒点 ${due}，已把任务交给 DSH 会话 ${sessionId}`)
      } catch (error) {
        log(`定时检查失败：${errorMessage(error)}`)
      }
    }, 20_000)
    return () => clearInterval(timer)
  }, 'bili-fav: daily auto run')

  ctx.effect(
    () => () => {
      disposed = true
      try {
        currentAbort?.abort(new Error('插件已卸载'))
      } catch {
        /* ignore */
      }
      current = null
      pendingLogin = null
    },
    'bili-fav: lifecycle',
  )

  log(
    `已挂载（v${VERSION}，家=${home}，登录=${api.loggedIn ? '有' : '无'}，模型=${
      liveModel()?.provider || '?'
    }/${liveModel()?.model || '?'}）`,
  )
}
