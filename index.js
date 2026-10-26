/**
 * Host half of dsh-bili-fav.
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
let VERSION = '0.2.0-beta.2'
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
  try {
    ctx.provide('biliFavChannels', channels)
  } catch (error) {
    log(`注册渠道服务失败：${errorMessage(error)}`)
  }

  let config = loadConfig(home)
  let state = loadState(home)
  let credentials = loadCredentials(home)
  let api = new BiliApi({
    cookies: credentials?.cookies ?? {},
    user: credentials?.user ?? null,
    log,
  })

  let current = null
  let currentAbort = null
  let currentPromise = null

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
    if (mode === 'channel') return '只第三方渠道'
    if (mode === 'both') return '收藏 + 渠道'
    return '只收藏'
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
    if (mode !== 'channel' && favoriteLink) lines.push(`收藏夹：${favoriteLink}`)
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
        ? mode === 'channel'
          ? '第三方渠道模式不需要 B站登录：可以用游客推荐流；个性化推荐和字幕仍需要登录。'
          : '未登录时可以「试刷」：用游客推荐流让模型挑一遍，不会写入收藏夹。'
        : mode !== 'favorite' && list.length === 0
          ? '还没有可用的第三方投递渠道；安装 dsh-bili-fav-qq 或其它渠道插件后再刷新。'
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

      const mode = ['favorite', 'channel', 'both'].includes(cfg.deliveryMode)
        ? cfg.deliveryMode
        : 'favorite'
      const doFavorite = mode !== 'channel'
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

      if (mode === 'channel') {
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

  function startRun({ dryRun = false, count = null, trigger = 'manual' } = {}) {
    if (current) {
      return { ok: false, started: false, reason: 'running', message: '已经有一轮在跑了，等它结束。' }
    }
    try {
      config = loadConfig(home)
    } catch (error) {
      log(`开始前读取配置失败：${errorMessage(error)}`)
    }
    const mode = ['favorite', 'channel', 'both'].includes(config.deliveryMode)
      ? config.deliveryMode
      : 'favorite'
    const doFavorite = mode !== 'channel'
    const doChannel = mode !== 'favorite'
    const channelDescriptor = doChannel
      ? channelList().find((item) => item.id === config.channelId) || null
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
        if (!String(config.channelId || '').trim()) {
          return {
            ok: false,
            started: false,
            reason: 'no-channel',
            message: '请先在偏好里选择一个第三方投递渠道。',
          }
        }
        if (!channels.get(config.channelId) || !channelDescriptor) {
          return {
            ok: false,
            started: false,
            reason: 'unknown-channel',
            message: `渠道「${config.channelId}」没有注册；请安装/启用对应的渠道插件后刷新。`,
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
        const options = config.channelOptions?.[config.channelId] || {}
        const missing = (channelDescriptor.fields || [])
          .filter((field) => field.required && !String(options[field.key] ?? '').trim())
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
        sendJson(res, 200, { ok: true, message: result.message, channel: result.channel })
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
        const started = startRun({ dryRun, count, trigger: 'manual' })
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

  const registerTool = (definition) => {
    ctx.effect(() => ctx.tools.register({ ...definition, output: toolOutput }), `bili-fav: ${definition.name}`)
  }

  registerTool({
    name: 'bili_fav_status',
    description:
      '查看「B站自主刷片」的状态：是否已登录 B站、模型是谁、投递方式、目标收藏夹、已注册的第三方渠道、最近一轮它点开了什么、收藏/推送了什么。',
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
        config: status.config,
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
    name: 'bili_fav_run',
    description:
      '让模型自己刷一轮 B站推荐流，按它自己的判断挑片，并按设置页里的投递方式处理：只收藏、只通过第三方渠道推送、或两者都要。收藏需要 B站登录；渠道推送需要安装并启用对应的渠道插件。',
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
      const started = startRun({ dryRun: false, count, trigger: 'tool' })
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
      '查看已注册的第三方投递渠道；action=list 只读列出渠道和配置字段；action=targets 让当前渠道读取可用目标；action=test 让当前渠道发送一条测试消息。',
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
        const mode = ['favorite', 'channel', 'both'].includes(config.deliveryMode)
          ? config.deliveryMode
          : 'favorite'
        if (mode !== 'channel' && !api.loggedIn) return
        if (mode !== 'favorite') {
          const descriptor = channelList().find((item) => item.id === config.channelId)
          if (!descriptor || descriptor.available === false) return
        }
        const [targetHour, targetMinute] = config.autoRun.time.split(':').map(Number)
        if (!Number.isFinite(targetHour) || !Number.isFinite(targetMinute)) return
        const now = new Date()
        const nowMinutes = now.getHours() * 60 + now.getMinutes()
        const targetMinutes = targetHour * 60 + targetMinute
        // A 10-minute catch-up window survives a busy tick or a short sleep
        // without turning a missed day into a surprise run hours later.
        if (nowMinutes < targetMinutes || nowMinutes - targetMinutes > 10) return
        const day = localDayKey(now)
        if (state.autoLastDay === day) return
        state.autoLastDay = day
        saveState(home, state)
        log(`到达定时时间 ${config.autoRun.time}，自动开刷`)
        startRun({ dryRun: false, trigger: 'auto' })
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
