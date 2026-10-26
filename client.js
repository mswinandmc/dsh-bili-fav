/**
 * Browser half of dsh-bili-fav: one page under Settings.
 *
 * The page talks to the host through the authenticated `/api/bili-fav` routes.
 * It renders with the host's theme tokens and registers into `settings.section`
 * so it looks like a normal settings page rather than an overlay.
 */
window.__ModuleLoader__.load({
  id: 'dsh-bili-fav',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const API = '/api/bili-fav'
    const TABS = [
      ['run', '运行'],
      ['prefs', '偏好'],
      ['history', '记录'],
    ]

    const CSS = `
[data-bf-page]{display:flex;flex-direction:column;gap:18px;max-width:720px;padding:2px 2px 28px;
  color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;}
[data-bf-head]{display:flex;flex-direction:column;gap:5px;}
[data-bf-title]{display:flex;align-items:center;gap:8px;font-size:17px;line-height:24px;font-weight:600;}
[data-bf-badge]{font-size:10px;line-height:16px;font-weight:500;padding:1px 6px;border-radius:5px;
  color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);}
[data-bf-sub]{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}
[data-bf-section]{display:flex;flex-direction:column;gap:12px;padding:15px 16px;border-radius:12px;
  background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2));}
[data-bf-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-bf-col]{display:flex;flex-direction:column;gap:4px;min-width:0;}
[data-bf-grow]{flex:1;min-width:0;}
[data-bf-label]{font-size:13px;font-weight:500;}
[data-bf-note]{font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary);}
[data-bf-note][data-bf-warn]{color:var(--dsw-alias-state-warn-primary);}
[data-bf-hint]{font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary);}
[data-bf-field]{display:flex;flex-direction:column;gap:5px;min-width:0;}
[data-bf-field][data-bf-inline]{flex-direction:row;align-items:center;justify-content:space-between;gap:14px;}
[data-bf-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font:inherit;font-size:12px;
  color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);}
[data-bf-input]:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}
textarea[data-bf-input]{resize:vertical;min-height:92px;line-height:19px;}
[data-bf-num]{width:96px;text-align:center;}
[data-bf-btn]{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;
  border-radius:8px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;text-decoration:none;
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);}
[data-bf-btn]:not([disabled]):hover{background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-1));}
[data-bf-btn]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
[data-bf-btn][data-bf-primary]{color:var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base));
  background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}
[data-bf-btn][data-bf-primary]:not([disabled]):hover{
  background:var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary));
  border-color:var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary));filter:none;}
[data-bf-btn][data-bf-danger]{color:var(--dsw-alias-state-error-primary);}
[data-bf-btn][data-bf-danger]:not([disabled]):hover{
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 32%, transparent);}
[data-bf-btn][disabled]{opacity:.45;cursor:default;filter:none;}
[data-bf-btn][data-bf-primary][disabled]{opacity:1;color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);}
[data-bf-switch]{flex:none;position:relative;width:36px;height:20px;padding:0;border:0;border-radius:10px;cursor:pointer;
  background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);transition:background .15s;}
[data-bf-switch]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
[data-bf-switch][aria-checked=true]{background:var(--dsw-alias-brand-primary);box-shadow:none;}
[data-bf-switch] i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
  background:var(--dsw-alias-switch-thumb, var(--dsw-alias-bg-base));
  box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s;display:block;}
[data-bf-switch][aria-checked=true] i{left:18px;}
[data-bf-switch][disabled]{opacity:.45;cursor:default;}
[data-bf-tabs]{display:flex;gap:3px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);
  box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1);}
[data-bf-tab]{flex:1;height:28px;border:0;border-radius:7px;background:transparent;font:inherit;font-size:12px;
  color:var(--dsw-alias-label-secondary);cursor:pointer;}
[data-bf-tab]:hover{color:var(--dsw-alias-label-primary);}
[data-bf-tab]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}
[data-bf-tab][aria-selected=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  font-weight:600;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2),0 1px 2px rgba(0,0,0,.12);}
[data-bf-avatar]{width:38px;height:38px;border-radius:50%;object-fit:cover;background:var(--dsw-alias-bg-layer-2);flex:none;}
[data-bf-qr]{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;}
[data-bf-qr] img{width:168px;height:168px;border-radius:10px;background:#fff;padding:8px;box-sizing:content-box;}
[data-bf-qr] img[data-bf-loading]{opacity:.5;}
[data-bf-chiprow]{display:flex;flex-wrap:wrap;gap:6px;}
[data-bf-chip]{height:26px;padding:0 10px;border-radius:999px;font:inherit;font-size:11px;cursor:pointer;
  color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);}
[data-bf-chip]:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);}
[data-bf-chip]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
[data-bf-chip][aria-pressed=true]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);}
[data-bf-msg]{font-size:11px;line-height:17px;padding:7px 10px;border-radius:8px;word-break:break-word;
  color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l1);}
[data-bf-msg][data-bf-tone=ok]{color:var(--dsw-alias-state-success-primary);}
[data-bf-msg][data-bf-tone=warn]{color:var(--dsw-alias-state-warn-primary);}
[data-bf-msg][data-bf-tone=error]{color:var(--dsw-alias-state-error-primary);}
[data-bf-pre]{margin:0;padding:9px 10px;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:17px;
  color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;}
[data-bf-pre][data-bf-tone=error]{color:var(--dsw-alias-state-error-primary);}
[data-bf-progress]{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:10px;
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);}
[data-bf-bar]{height:4px;border-radius:2px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);}
[data-bf-bar] i{display:block;height:100%;width:40%;border-radius:2px;background:var(--dsw-alias-brand-primary);
  animation:bf-slide 1.4s ease-in-out infinite;}
@keyframes bf-slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
[data-bf-counters]{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);}
[data-bf-counters] b{font-weight:600;color:var(--dsw-alias-label-primary);}
[data-bf-runhead]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
[data-bf-runhead] time{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);}
[data-bf-state]{font-size:11px;line-height:17px;padding:1px 7px;border-radius:5px;font-weight:500;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);
  border:1px solid var(--dsw-alias-border-l1);}
[data-bf-state][data-bf-tone=ok]{color:var(--dsw-alias-state-success-primary);}
[data-bf-state][data-bf-tone=warn]{color:var(--dsw-alias-state-warn-primary);}
[data-bf-state][data-bf-tone=error]{color:var(--dsw-alias-state-error-primary);}
[data-bf-meta]{font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;}
[data-bf-meta][data-bf-tone=error]{color:var(--dsw-alias-state-error-primary);}
[data-bf-grid]{display:grid;grid-template-columns:repeat(auto-fill,minmax(214px,1fr));gap:10px;}
[data-bf-card]{display:flex;flex-direction:column;overflow:hidden;border-radius:10px;text-decoration:none;
  color:inherit;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);}
[data-bf-card]:hover{border-color:var(--dsw-alias-brand-primary);}
[data-bf-card] img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--dsw-alias-bg-layer-1);}
[data-bf-cardbody]{display:flex;flex-direction:column;gap:4px;padding:8px 10px 10px;min-width:0;}
[data-bf-cardtitle]{font-size:12px;line-height:17px;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}
[data-bf-cardmeta]{font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
[data-bf-reason]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);margin:2px 0 0;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
[data-bf-reason][data-bf-tone=error]{color:var(--dsw-alias-state-error-primary);}
[data-bf-reason][data-bf-tone=ok]{color:var(--dsw-alias-state-success-primary);}
[data-bf-cards]{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;}
[data-bf-details]{font-size:12px;}
[data-bf-details] summary{cursor:pointer;color:var(--dsw-alias-label-secondary);user-select:none;}
[data-bf-details] summary:hover{color:var(--dsw-alias-label-primary);}
[data-bf-details] ul{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px;}
[data-bf-details] li{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;
  padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l1);}
[data-bf-details] a{color:var(--dsw-alias-label-primary);text-decoration:none;}
[data-bf-details] a:hover{text-decoration:underline;}
[data-bf-details] .why{color:var(--dsw-alias-label-secondary);font-size:11px;}
[data-bf-details] .tag{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-secondary);}
[data-bf-empty]{padding:18px 0;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary);}
[data-bf-code]{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;word-break:break-all;
  color:var(--dsw-alias-label-secondary);}
[data-bf-footer]{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:10px;
  color:var(--dsw-alias-label-secondary);}
[data-bf-sep]{height:1px;background:var(--dsw-alias-border-l1);}
@media (max-width:560px){
  [data-bf-grid],[data-bf-cards]{grid-template-columns:1fr;}
  [data-bf-page]{max-width:none;}
}
`

    const asJson = async (response) => {
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        throw new Error((data && data.error) || `HTTP ${response.status}`)
      }
      return data
    }

    const jget = (path) => fetch(API + path, { credentials: 'same-origin' }).then(asJson)
    const jpost = (path, body) =>
      fetch(API + path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }).then(asJson)

    function normalizeCover(url) {
      if (!url) return ''
      return String(url).replace(/^http:\/\//i, 'https://')
    }

    function videoUrl(bvid) {
      return `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`
    }

    function durationText(seconds) {
      const total = Math.max(0, Number(seconds) || 0)
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const secs = total % 60
      if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      }
      return `${minutes}:${String(secs).padStart(2, '0')}`
    }

    function viewsText(value) {
      const number = Number(value) || 0
      if (number >= 100_000_000) return `${(number / 100_000_000).toFixed(1)}亿`
      if (number >= 10_000) return `${(number / 10_000).toFixed(1)}万`
      return String(number)
    }

    function formatDate(value) {
      if (!value) return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '—'
      return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    }

    function runTone(status) {
      if (status === 'ok') return 'ok'
      if (status === 'partial') return 'warn'
      if (status === 'error') return 'error'
      return ''
    }

    function runLabel(status) {
      if (status === 'ok') return '完成'
      if (status === 'partial') return '部分完成'
      if (status === 'error') return '失败'
      if (status === 'cancelled') return '已停止'
      if (status === 'running') return '进行中'
      return status || '未知'
    }

    function deliveryLabel(mode) {
      if (mode === 'channel') return '只 QQ'
      if (mode === 'both') return '收藏 + QQ'
      return '只收藏'
    }

    function toForm(configuration) {
      const config = configuration || {}
      return {
        guidance: String(config.guidance || ''),
        scan: Number(config.scan) || 20,
        deepRead: Number(config.deepRead) || 8,
        count: Number(config.count) || 5,
        deliveryMode: ['favorite', 'channel', 'both'].includes(config.deliveryMode)
          ? config.deliveryMode
          : 'favorite',
        channelId: String(config.channelId || ''),
        channelOptions:
          config.channelOptions && typeof config.channelOptions === 'object'
            ? config.channelOptions
            : {},
        folderName: String(config.folderName || '大肥鱼推荐'),
        readSubtitles: config.readSubtitles !== false,
        autoEnabled: Boolean(config.autoRun && config.autoRun.enabled),
        autoTime: String((config.autoRun && config.autoRun.time) || '12:30'),
      }
    }

    function payloadOf(form) {
      return {
        guidance: form.guidance,
        scan: form.scan,
        deepRead: form.deepRead,
        count: form.count,
        deliveryMode: form.deliveryMode,
        channelId: form.channelId,
        channelOptions: form.channelOptions,
        folderName: form.folderName,
        readSubtitles: form.readSubtitles,
        autoRun: { enabled: form.autoEnabled, time: form.autoTime },
      }
    }

    function Switch({ checked, onChange, disabled, label }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          'data-bf-switch': '',
          disabled: Boolean(disabled),
          onClick: () => {
            if (!disabled) onChange(!checked)
          },
        },
        h('i'),
      )
    }

    function Notice({ notice }) {
      if (!notice) return null
      return h('div', { 'data-bf-msg': '', 'data-bf-tone': notice.tone || '' }, notice.text)
    }

    function PickCard({ pick }) {
      const failed = pick.status === 'failed'
      return h(
        'a',
        {
          'data-bf-card': '',
          href: videoUrl(pick.bvid),
          target: '_blank',
          rel: 'noreferrer noopener',
          title: pick.title,
        },
        pick.cover
          ? h('img', {
              src: normalizeCover(pick.cover),
              alt: '',
              loading: 'lazy',
              referrerPolicy: 'no-referrer',
            })
          : null,
        h(
          'div',
          { 'data-bf-cardbody': '' },
          h('div', { 'data-bf-cardtitle': '' }, pick.title || pick.bvid),
          h(
            'div',
            { 'data-bf-cardmeta': '' },
            `${pick.author || '未知 UP'} · ${durationText(pick.duration)} · ${viewsText(pick.view)} 播放`,
          ),
          pick.reason
            ? h('p', { 'data-bf-reason': '' }, pick.reason)
            : null,
          failed
            ? h('p', { 'data-bf-reason': '', 'data-bf-tone': 'error' }, `收藏/推送失败：${pick.error || '未知原因'}`)
            : pick.status === 'saved'
              ? h('p', { 'data-bf-reason': '', 'data-bf-tone': 'ok' }, '已收藏')
              : pick.status === 'pushed'
                ? h('p', { 'data-bf-reason': '', 'data-bf-tone': 'ok' }, '已推送渠道')
                : null,
        ),
      )
    }

    function Shortlist({ run }) {
      const shortlist = Array.isArray(run.shortlist) ? run.shortlist : []
      if (!shortlist.length) return null
      return h(
        'details',
        { 'data-bf-details': '' },
        h('summary', null, `它这一轮点开了哪些（${shortlist.length} 条）`),
        h(
          'ul',
          null,
          shortlist.map((item) =>
            h(
              'li',
              { key: item.bvid },
              h(
                'a',
                { href: videoUrl(item.bvid), target: '_blank', rel: 'noreferrer noopener' },
                item.title || item.bvid,
              ),
              item.why ? h('span', { className: 'why' }, item.why) : null,
              h(
                'span',
                { className: 'tag' },
                item.subtitleChars
                  ? `读了 ${item.subtitleChars} 字字幕`
                  : '没读到字幕（只看简介/标签）',
              ),
            ),
          ),
        ),
      )
    }

    function RunView({ run, expanded, onToggle, onCopy, copyBusy }) {
      if (!run) return null
      const picks = Array.isArray(run.picks) ? run.picks : []
      const isExpanded = expanded === undefined ? true : expanded
      return h(
        'div',
        { 'data-bf-col': '' },
        h(
          'div',
          { 'data-bf-runhead': '' },
          h('span', { 'data-bf-state': '', 'data-bf-tone': runTone(run.status) }, runLabel(run.status)),
          h(
            'span',
            { 'data-bf-meta': '' },
            `${run.dryRun ? '试刷' : run.trigger === 'auto' ? '自动' : run.trigger === 'tool' ? '对话' : '手动'} · ${deliveryLabel(
              run.delivery,
            )} · ${run.model || '模型未知'}`,
          ),
          h('time', null, formatDate(run.finishedAt || run.startedAt)),
          onCopy
            ? h(
                'button',
                {
                  type: 'button',
                  'data-bf-btn': '',
                  disabled: Boolean(copyBusy) || picks.length === 0,
                  onClick: () => onCopy(run),
                },
                copyBusy ? '复制中…' : '复制清单',
              )
            : null,
          onToggle
            ? h(
                'button',
                { type: 'button', 'data-bf-btn': '', onClick: onToggle },
                isExpanded ? '收起' : '展开',
              )
            : null,
        ),
        h(
          'div',
          { 'data-bf-meta': '' },
          `扫了 ${run.scanned || 0} 条 · 点开 ${run.watched || 0} 条${
            run.subtitleVideos ? `（${run.subtitleVideos} 条有字幕）` : ''
          } · ${run.dryRun ? '想挑' : '挑了'} ${picks.length} 条${
            run.folder ? ` · 「${run.folder}」` : ''
          }`,
        ),
        run.delivery !== 'favorite' && !run.dryRun
          ? h(
              'div',
              { 'data-bf-meta': '', 'data-bf-tone': run.channelError ? 'error' : '' },
              run.channelError
                ? `渠道推送失败：${run.channelError}`
                : run.channelSent
                  ? `渠道已推送 ${run.channelSent} 条${run.channelLabel ? ` → ${run.channelLabel}` : ''}`
                  : '渠道未推送',
            )
          : null,
        run.note ? h('div', { 'data-bf-msg': '', 'data-bf-tone': run.status === 'error' ? 'error' : '' }, run.note) : null,
        run.error ? h('div', { 'data-bf-msg': '', 'data-bf-tone': 'error' }, run.error) : null,
        isExpanded
          ? picks.length
            ? h('div', { 'data-bf-cards': '' }, picks.map((pick) => h(PickCard, { key: pick.bvid, pick })))
            : h('div', { 'data-bf-empty': '' }, '这一轮没有挑中视频。')
          : null,
        isExpanded ? h(Shortlist, { run }) : null,
      )
    }

    function Progress({ running }) {
      if (!running) return null
      const labels = {
        准备开始: '准备中',
        拉取推荐流: '正在拉取推荐流',
        读取视频信息: '正在读取视频信息',
        模型自己挑想看的: '模型正在凭自己的品味挑选',
        点开视频读字幕: '正在点开视频读字幕',
        整理收藏结果: '正在整理结果',
        准备收藏夹: '正在准备收藏夹',
        收藏到: '正在收藏',
        '推送到': '正在推送到渠道',
      }
      let phase = running.phase || '准备中'
      for (const key of Object.keys(labels)) {
        if (phase.startsWith(key)) phase = labels[key]
      }
      if (phase.startsWith('准备收藏夹')) phase = '正在准备收藏夹'
      if (phase.startsWith('收藏到')) phase = '正在写入收藏夹'
      if (phase === '正在停止…') phase = '正在停止'
      return h(
        'div',
        { 'data-bf-progress': '' },
        h('div', { 'data-bf-label': '' }, phase),
        h('div', { 'data-bf-bar': '' }, h('i')),
        h(
          'div',
          { 'data-bf-counters': '' },
          h('span', null, '候选 ', h('b', null, String(running.total || 0))),
          h('span', null, '已读 ', h('b', null, String(running.scanned || 0))),
          h('span', null, '点开 ', h('b', null, String(running.watched || 0))),
          h('span', null, running.dryRun ? '想收藏 ' : '已挑 ', h('b', null, String((running.picks || []).length))),
        ),
      )
    }

    function Account({
      status,
      qr,
      busy,
      startLogin,
      cancelLogin,
      logout,
      requestLogout,
      confirmLogout,
      refresh,
    }) {
      const loggedIn = status?.login?.state === 'logged-in'
      const user = status?.login?.user
      const folder = status?.folder
      if (!loggedIn) {
        return h(
          'div',
          { 'data-bf-section': '' },
          h(
            'div',
            { 'data-bf-row': '' },
            h(
              'div',
              { 'data-bf-col': '', 'data-bf-grow': '' },
              h('div', { 'data-bf-label': '' }, 'B站账号'),
              h('div', { 'data-bf-note': '' }, '还没有登录。登录后，推荐流才会是「你的」推荐流，也才能写入收藏夹。'),
            ),
            h(
              'button',
              {
                type: 'button',
                'data-bf-btn': '',
                'data-bf-primary': '',
                disabled: Boolean(busy) || Boolean(qr),
                onClick: startLogin,
              },
              busy === 'login' ? '生成中…' : qr ? '等待扫码' : '扫码登录',
            ),
          ),
          qr
            ? h(
                'div',
                { 'data-bf-qr': '' },
                h('img', {
                  src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg || '')}`,
                  alt: 'B站登录二维码',
                  width: 168,
                  height: 168,
                }),
                h(
                  'div',
                  { 'data-bf-col': '', 'data-bf-grow': '' },
                  h(
                    'div',
                    { 'data-bf-label': '' },
                    qr.state === 'scanned'
                      ? '已扫码，请在手机上确认'
                      : qr.state === 'expired'
                        ? '二维码已过期'
                        : qr.state === 'error'
                          ? '登录失败'
                          : '用手机 B站 扫一扫',
                  ),
                  h(
                    'div',
                    { 'data-bf-note': '' },
                    qr.state === 'scanned'
                      ? '在手机上点「确认登录」。建议选「记住我 / 长期」。'
                      : qr.message || '手机 B站 → 我的 → 扫一扫。确认时选「记住我 / 长期」。',
                  ),
                  qr.state === 'expired' || qr.state === 'error'
                    ? h(
                        'div',
                        { 'data-bf-row': '' },
                        h(
                          'button',
                          { type: 'button', 'data-bf-btn': '', onClick: startLogin },
                          '重新生成',
                        ),
                        h('button', { type: 'button', 'data-bf-btn': '', onClick: cancelLogin }, '关闭'),
                      )
                    : h(
                        'div',
                        { 'data-bf-row': '' },
                        h('button', { type: 'button', 'data-bf-btn': '', onClick: cancelLogin }, '取消'),
                      ),
                ),
              )
            : null,
        )
      }
      return h(
        'div',
        { 'data-bf-section': '' },
        h(
          'div',
          { 'data-bf-row': '' },
          user && user.face
            ? h('img', {
                'data-bf-avatar': '',
                src: normalizeCover(user.face),
                alt: '',
                referrerPolicy: 'no-referrer',
              })
            : null,
          h(
            'div',
            { 'data-bf-col': '', 'data-bf-grow': '' },
            h('div', { 'data-bf-label': '' }, user?.uname || '已登录 B站'),
            h(
              'div',
              { 'data-bf-note': '' },
              [user?.mid ? `UID ${user.mid}` : '', status?.login?.savedAt ? `凭证保存于 ${formatDate(status.login.savedAt)}` : '']
                .filter(Boolean)
                .join(' · '),
            ),
          ),
          h('button', { type: 'button', 'data-bf-btn': '', disabled: Boolean(busy), onClick: refresh }, '刷新状态'),
          h(
            'button',
            {
              type: 'button',
              'data-bf-btn': '',
              'data-bf-danger': '',
              disabled: Boolean(busy),
              onClick: confirmLogout ? logout : requestLogout,
            },
            confirmLogout ? '再点一次确认退出' : '退出登录',
          ),
        ),
        h(
          'div',
          { 'data-bf-row': '' },
          h('div', { 'data-bf-note': '', 'data-bf-grow': '' }, `目标收藏夹：${folder?.name || '未设置'}`),
          folder?.link
            ? h(
                'a',
                { href: folder.link, target: '_blank', rel: 'noreferrer noopener', 'data-bf-btn': '' },
                '打开收藏夹',
              )
            : null,
          h('div', { 'data-bf-hint': '' }, folder?.id ? '已就绪' : '第一次刷时会自动创建（公开）'),
        ),
      )
    }

    function Preferences({
      status,
      form,
      setForm,
      folders,
      busy,
      save,
      loadFolders,
      notice,
      channelMessage,
      listChannelTargets,
      testChannel,
    }) {
      if (!form) return null
      const update = (patch) => setForm((current) => ({ ...current, ...patch }))
      const folderNames = Array.isArray(folders) ? folders.map((item) => item.title) : []
      const channels = Array.isArray(status?.channels) ? status.channels : []
      const selectedChannel = channels.find((item) => item.id === form.channelId) || null
      const channelOptions = (form.channelOptions && form.channelOptions[form.channelId]) || {}
      const setChannelOption = (key, value) => {
        const channelId = form.channelId
        if (!channelId) return
        const currentOptions = form.channelOptions || {}
        update({
          channelOptions: {
            ...currentOptions,
            [channelId]: { ...(currentOptions[channelId] || {}), [key]: value },
          },
        })
      }
      const modeNeedsFavorite = form.deliveryMode !== 'channel'
      const modeNeedsChannel = form.deliveryMode !== 'favorite'
      const MODES = [
        ['favorite', '只收藏', '挑中的视频写进 B站收藏夹；不使用 QQ。'],
        ['channel', '只 QQ', '把推荐清单交给 QQ 渠道；不写收藏夹。B站未登录也能用游客推荐流。'],
        ['both', '两者都要', '收藏夹和 QQ 都走；任意一路失败会标在记录里。'],
      ]
      const modeDescription = (MODES.find(([value]) => value === form.deliveryMode) || MODES[0])[2]
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { 'data-bf-section': '' },
          h(
            'div',
            { 'data-bf-row': '' },
            h(
              'div',
              { 'data-bf-col': '' },
              h('div', { 'data-bf-label': '' }, '偏好'),
              h('div', { 'data-bf-note': '' }, '改完点保存；直接开始刷也会自动保存。'),
            ),
            h('div', { 'data-bf-grow': '' }),
            h(
              'button',
              {
                type: 'button',
                'data-bf-btn': '',
                'data-bf-primary': '',
                disabled: Boolean(busy),
                onClick: save,
              },
              busy === 'save' ? '保存中…' : '保存偏好',
            ),
          ),
          h(Notice, { notice }),
        ),
        h(
          'div',
          { 'data-bf-section': '' },
          h('div', { 'data-bf-label': '' }, '它怎么挑'),
          h(
            'div',
            { 'data-bf-note': '' },
            '模型先自己挑想看的，再读字幕，最后按它自己的判断收藏。这里留空就是完全按它自己的品味；写一句也只是参考，不是关键词过滤。',
          ),
          h(
            'div',
            { 'data-bf-field': '' },
            h('label', { 'data-bf-note': '' }, '给模型的一句参考（可选）'),
            h('textarea', {
              'data-bf-input': '',
              value: form.guidance,
              maxLength: 4000,
              placeholder: '例：最近对 AI 工程、科学史和长纪录片感兴趣。留空 = 完全按你自己的判断。',
              onChange: (event) => update({ guidance: event.target.value }),
            }),
          ),
          h(
            'div',
            { 'data-bf-row': '' },
            h(
              'div',
              { 'data-bf-field': '' },
              h('label', { 'data-bf-note': '' }, '这一轮刷多少条候选'),
              h('input', {
                'data-bf-input': '',
                'data-bf-num': '',
                type: 'number',
                min: 5,
                max: 30,
                value: form.scan,
                onChange: (event) => update({ scan: Number(event.target.value) || 20 }),
              }),
            ),
            h(
              'div',
              { 'data-bf-field': '' },
              h('label', { 'data-bf-note': '' }, '最多点开几条读内容'),
              h('input', {
                'data-bf-input': '',
                'data-bf-num': '',
                type: 'number',
                min: 1,
                max: 15,
                value: form.deepRead,
                onChange: (event) => update({ deepRead: Number(event.target.value) || 8 }),
              }),
            ),
            h(
              'div',
              { 'data-bf-field': '' },
              h('label', { 'data-bf-note': '' }, '最后最多挑几条'),
              h('input', {
                'data-bf-input': '',
                'data-bf-num': '',
                type: 'number',
                min: 1,
                max: 10,
                value: form.count,
                onChange: (event) => update({ count: Number(event.target.value) || 5 }),
              }),
            ),
          ),
        ),
        h(
          'div',
          { 'data-bf-section': '' },
          h('div', { 'data-bf-label': '' }, '投递方式'),
          h(
            'div',
            { 'data-bf-note': '' },
            '挑完视频后怎么处理：只写 B站收藏夹、只交给 QQ，或者两边都做。QQ 渠道由独立适配器注册。',
          ),
          h(
            'div',
            { 'data-bf-chiprow': '', role: 'group', 'aria-label': '投递方式' },
            MODES.map(([value, label]) =>
              h(
                'button',
                {
                  key: value,
                  type: 'button',
                  'data-bf-chip': '',
                  'aria-pressed': form.deliveryMode === value ? 'true' : 'false',
                  onClick: () => update({ deliveryMode: value }),
                },
                label,
              ),
            ),
          ),
          h('div', { 'data-bf-note': '' }, modeDescription),
        ),
        h(
          'div',
          { 'data-bf-section': '' },
          h('div', { 'data-bf-label': '' }, '收藏到哪个收藏夹'),
          !modeNeedsFavorite
            ? h('div', { 'data-bf-note': '', 'data-bf-warn': '' }, '当前是「只 QQ」，下面的收藏夹设置不会使用。')
            : null,
          h('input', {
            'data-bf-input': '',
            value: form.folderName,
            maxLength: 20,
            placeholder: '大肥鱼推荐',
            onChange: (event) => update({ folderName: event.target.value }),
          }),
          h(
            'div',
            { 'data-bf-note': '' },
            '填写收藏夹名字：已有同名收藏夹就放进去；没有就自动创建一个公开收藏夹（可以在 B站里改成私密）。最多 20 个字。',
          ),
          status?.login?.state === 'logged-in'
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { 'data-bf-row': '' },
                  h('div', { 'data-bf-hint': '', 'data-bf-grow': '' }, '从我的收藏夹里选：'),
                  h(
                    'button',
                    { type: 'button', 'data-bf-btn': '', disabled: Boolean(busy), onClick: loadFolders },
                    busy === 'folders' ? '读取中…' : '重新读取',
                  ),
                ),
                folderNames.length
                  ? h(
                      'div',
                      { 'data-bf-chiprow': '' },
                      folderNames.slice(0, 16).map((name) =>
                        h(
                          'button',
                          {
                            key: name,
                            type: 'button',
                            'data-bf-chip': '',
                            'aria-pressed': form.folderName === name ? 'true' : 'false',
                            onClick: () => update({ folderName: name }),
                          },
                          name,
                        ),
                      ),
                    )
                  : h('div', { 'data-bf-note': '' }, '还没有读到收藏夹，点「重新读取」试试。'),
              )
            : h('div', { 'data-bf-note': '' }, '登录后才能读取已有收藏夹；现在也可以直接填名字。'),
        ),
        modeNeedsChannel
          ? h(
              'div',
              { 'data-bf-section': '' },
              h('div', { 'data-bf-label': '' }, 'QQ 渠道'),
              channels.length === 0
                ? h(
                    'div',
                    { 'data-bf-note': '', 'data-bf-warn': '' },
                    '还没有注册 QQ 渠道。安装 dsh-bili-fav-qq，然后刷新本页。',
                  )
                : h(
                    React.Fragment,
                    null,
                    h(
                      'div',
                      { 'data-bf-field': '' },
                      h('label', { 'data-bf-note': '' }, '选择渠道'),
                      h(
                        'select',
                        {
                          'data-bf-input': '',
                          value: form.channelId,
                          onChange: (event) => update({ channelId: event.target.value }),
                        },
                        h('option', { value: '' }, '未选择'),
                        channels.map((item) =>
                          h(
                            'option',
                            { key: item.id, value: item.id },
                            `${item.label}${item.available ? '' : '（不可用）'}`,
                          ),
                        ),
                      ),
                    ),
                    form.channelId && !selectedChannel
                      ? h(
                          'div',
                          { 'data-bf-note': '', 'data-bf-warn': '' },
                          `渠道「${form.channelId}」没有注册；安装/启用对应插件后刷新。`,
                        )
                      : null,
                    selectedChannel
                      ? h(
                          React.Fragment,
                          null,
                          selectedChannel.description
                            ? h('div', { 'data-bf-note': '' }, selectedChannel.description)
                            : null,
                          selectedChannel.available === false
                            ? h(
                                'div',
                                { 'data-bf-note': '', 'data-bf-warn': '' },
                                '这个渠道当前不可用；检查它依赖的工具/服务是否在线。',
                              )
                            : null,
                          (selectedChannel.fields || []).map((field) => {
                            const value = channelOptions[field.key] ?? field.default ?? ''
                            const label = `${field.label || field.key}${field.required ? ' *' : ''}`
                            if (field.type === 'select') {
                              const normalizedValue = String(value ?? '')
                              const options = Array.isArray(field.options) ? field.options : []
                              const optionValues = new Set(options.map((option) => option.value))
                              const extraOptions =
                                normalizedValue && !optionValues.has(normalizedValue)
                                  ? [{ value: normalizedValue, label: `当前值：${normalizedValue}` }]
                                  : []
                              return h(
                                'div',
                                { key: field.key, 'data-bf-field': '' },
                                h('label', { 'data-bf-note': '' }, label),
                                h(
                                  'select',
                                  {
                                    'data-bf-input': '',
                                    value,
                                    onChange: (event) => setChannelOption(field.key, event.target.value),
                                  },
                                  [...extraOptions, ...options].map((option) =>
                                    h('option', { key: option.value, value: option.value }, option.label),
                                  ),
                                ),
                                field.help ? h('div', { 'data-bf-note': '' }, field.help) : null,
                              )
                            }
                            if (field.type === 'checkbox') {
                              return h(
                                'div',
                                { key: field.key, 'data-bf-field': '', 'data-bf-inline': '' },
                                h(
                                  'div',
                                  { 'data-bf-col': '' },
                                  h('div', { 'data-bf-label': '' }, label),
                                  field.help ? h('div', { 'data-bf-note': '' }, field.help) : null,
                                ),
                                h(Switch, {
                                  checked: Boolean(value),
                                  label: field.label || field.key,
                                  onChange: (next) => setChannelOption(field.key, next),
                                }),
                              )
                            }
                            const multiline = field.type === 'textarea'
                            return h(
                              'div',
                              { key: field.key, 'data-bf-field': '' },
                              h('label', { 'data-bf-note': '' }, label),
                              h(multiline ? 'textarea' : 'input', {
                                'data-bf-input': '',
                                ...(multiline ? {} : { type: 'text' }),
                                value: String(value ?? ''),
                                placeholder: field.placeholder || '',
                                onChange: (event) => setChannelOption(field.key, event.target.value),
                              }),
                              field.help ? h('div', { 'data-bf-note': '' }, field.help) : null,
                            )
                          }),
                          h(
                            'div',
                            { 'data-bf-row': '' },
                            selectedChannel.hasList
                              ? h(
                                  'button',
                                  {
                                    type: 'button',
                                    'data-bf-btn': '',
                                    disabled: Boolean(busy),
                                    onClick: listChannelTargets,
                                  },
                                  busy === 'channel-list' ? '读取中…' : '读取目标',
                                )
                              : null,
                            selectedChannel.hasTest
                              ? h(
                                  'button',
                                  {
                                    type: 'button',
                                    'data-bf-btn': '',
                                    disabled: Boolean(busy) || selectedChannel.available === false,
                                    onClick: testChannel,
                                  },
                                  busy === 'channel-test' ? '发送中…' : '测试发送',
                                )
                              : null,
                          ),
                          channelMessage
                            ? h(
                                'pre',
                                { 'data-bf-pre': '', 'data-bf-tone': channelMessage.tone || '' },
                                channelMessage.text,
                              )
                            : null,
                        )
                      : null,
                  ),
              h(
                'div',
                { 'data-bf-note': '' },
                'QQ 渠道由独立适配器 dsh-bili-fav-qq 注册；Webhook 是核心内置渠道。',
              ),
            )
          : null,
        h(
          'div',
          { 'data-bf-section': '' },
          h(
            'div',
            { 'data-bf-field': '', 'data-bf-inline': '' },
            h(
              'div',
              { 'data-bf-col': '' },
              h('div', { 'data-bf-label': '' }, '读字幕'),
              h(
                'div',
                { 'data-bf-note': '' },
                '点开的视频会尽量读 AI 字幕再判断。关掉就只看标题、简介、标签。只有登录后字幕接口才可用。',
              ),
            ),
            h(Switch, {
              checked: form.readSubtitles,
              label: '读字幕',
              onChange: (value) => update({ readSubtitles: value }),
            }),
          ),
          h('div', { 'data-bf-sep': '' }),
          h(
            'div',
            { 'data-bf-field': '', 'data-bf-inline': '' },
            h(
              'div',
              { 'data-bf-col': '' },
              h('div', { 'data-bf-label': '' }, '每天自动刷一轮'),
              h(
                'div',
                { 'data-bf-note': '' },
                '按本机时间运行；DSH 开着才会跑。默认关，先手动试一次再开。',
              ),
            ),
            h(Switch, {
              checked: form.autoEnabled,
              label: '每天自动刷一轮',
              onChange: (value) => update({ autoEnabled: value }),
            }),
          ),
          form.autoEnabled
            ? h(
                'div',
                { 'data-bf-row': '' },
                h('div', { 'data-bf-note': '' }, '每天这个时间：'),
                h('input', {
                  'data-bf-input': '',
                  'data-bf-num': '',
                  type: 'time',
                  value: form.autoTime,
                  onChange: (event) => update({ autoTime: event.target.value || '12:30' }),
                }),
              )
            : null,
          h('div', { 'data-bf-note': '' }, '收藏夹不会公开你的账号信息；视频是否可见由收藏夹的公开/私密设置决定。'),
        ),
        h(
          'div',
          { 'data-bf-section': '' },
          h('div', { 'data-bf-label': '' }, '工作方式'),
          h(
            'div',
            { 'data-bf-note': '' },
            '判断使用 DSH 当前默认模型：',
            status?.model ? `${status.model.provider}/${status.model.model}` : '尚未配置',
            '。每一轮大约调用模型 2 次（先挑想看的，再读完后决定收藏），会消耗 token。',
          ),
          h('div', { 'data-bf-hint': '' }, '数据目录：'),
          h('div', { 'data-bf-code': '' }, status?.home || ''),
        ),
      )
    }

    function History({ status, expandedRun, setExpandedRun, copyRun, copyBusy }) {
      const runs = Array.isArray(status?.history) ? status.history : []
      if (!runs.length) {
        return h('div', { 'data-bf-section': '' }, h('div', { 'data-bf-empty': '' }, '还没有记录。先点「试刷」或「开始刷一轮」。'))
      }
      return h(
        'div',
        { 'data-bf-col': '' },
        runs.map((run) =>
          h(
            'div',
            { 'data-bf-section': '', key: run.id },
            h(RunView, {
              run,
              expanded: expandedRun === run.id,
              onToggle: () => setExpandedRun(expandedRun === run.id ? null : run.id),
              onCopy: copyRun,
              copyBusy: copyBusy === run.id,
            }),
          ),
        ),
      )
    }

    function Panel() {
      const [status, setStatus] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState(null)
      const [qr, setQr] = useState(null)
      const [folders, setFolders] = useState(null)
      const [form, setForm] = useState(null)
      const [tab, setTab] = useState('run')
      const [expandedRun, setExpandedRun] = useState(null)
      const [copyBusy, setCopyBusy] = useState('')
      const [confirmLogout, setConfirmLogout] = useState(false)
      const [channelMessage, setChannelMessage] = useState(null)
      const aliveRef = useRef(true)
      const formTouched = useRef(false)

      const applyStatus = useCallback(
        (data) => {
          if (!data) return
          setStatus(data)
          setForm((current) => (current === null || !formTouched.current ? toForm(data.config) : current))
        },
        [],
      )

      const refresh = useCallback(async () => {
        try {
          const data = await jget('/status')
          if (aliveRef.current) {
            applyStatus(data)
            setError('')
          }
        } catch (fetchError) {
          if (aliveRef.current) setError(fetchError.message || '读取状态失败')
        }
      }, [applyStatus])

      useEffect(() => {
        aliveRef.current = true
        refresh()
        const timer = setInterval(refresh, 2500)
        return () => {
          aliveRef.current = false
          clearInterval(timer)
        }
      }, [refresh])

      useEffect(() => {
        if (!qr || !qr.key) return undefined
        if (qr.state === 'expired' || qr.state === 'error') return undefined
        let alive = true
        const timer = setInterval(async () => {
          try {
            const result = await jpost('/login/poll', { key: qr.key })
            if (!alive) return
            if (result.state === 'confirmed') {
              setQr(null)
              setNotice({ tone: 'ok', text: `登录成功：${result.user?.uname || 'B站账号'}` })
              refresh()
            } else if (result.state === 'expired' || result.state === 'error') {
              setQr((current) =>
                current
                  ? { ...current, state: result.state, message: result.message || '' }
                  : current,
              )
            } else {
              setQr((current) =>
                current
                  ? { ...current, state: result.state || current.state, message: result.message || current.message }
                  : current,
              )
            }
          } catch (pollError) {
            if (alive) {
              setQr((current) =>
                current ? { ...current, state: 'error', message: pollError.message } : current,
              )
            }
          }
        }, 2000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [qr?.key, qr?.state, refresh])

      useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(null), 6000)
        return () => clearTimeout(timer)
      }, [notice])

      useEffect(() => {
        if (!confirmLogout) return undefined
        const timer = setTimeout(() => setConfirmLogout(false), 4000)
        return () => clearTimeout(timer)
      }, [confirmLogout])

      useEffect(() => {
        if (status?.login?.state !== 'logged-in' || folders !== null) return
        loadFolders()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [status?.login?.state])

      async function startLogin() {
        setBusy('login')
        setNotice(null)
        try {
          const result = await jpost('/login/start')
          if (result.ok === false) throw new Error(result.error || '生成二维码失败')
          setQr({ key: result.key, svg: result.qrSvg, state: 'pending', message: '等待扫码' })
        } catch (loginError) {
          setNotice({ tone: 'error', text: loginError.message || '生成二维码失败' })
        } finally {
          setBusy('')
        }
      }

      function cancelLogin() {
        setQr(null)
      }

      async function logout() {
        setBusy('logout')
        setConfirmLogout(false)
        try {
          await jpost('/logout')
          setFolders(null)
          setQr(null)
          setNotice({ tone: 'ok', text: '已退出登录，本地凭证已删除' })
          await refresh()
        } catch (logoutError) {
          setNotice({ tone: 'error', text: logoutError.message || '退出失败' })
        } finally {
          setBusy('')
        }
      }

      async function loadFolders() {
        if (status?.login?.state !== 'logged-in') return
        setBusy('folders')
        try {
          const result = await jget('/folders')
          setFolders(Array.isArray(result.folders) ? result.folders : [])
        } catch (folderError) {
          setNotice({ tone: 'error', text: folderError.message || '读取收藏夹失败' })
          setFolders([])
        } finally {
          setBusy('')
        }
      }

      async function listChannelTargets() {
        if (!form?.channelId) {
          setChannelMessage({ tone: 'warn', text: '先在偏好里选一个渠道，再读取目标。' })
          return
        }
        setBusy('channel-list')
        setChannelMessage(null)
        try {
          const result = await jpost('/channel/targets', {
            channelId: form.channelId,
            options: form.channelOptions?.[form.channelId] || {},
          })
          setChannelMessage({ tone: 'ok', text: result.message || '（没有返回目标列表）' })
          await refresh()
        } catch (channelError) {
          setChannelMessage({ tone: 'error', text: channelError.message || '读取渠道目标失败' })
        } finally {
          setBusy('')
        }
      }

      async function testChannel() {
        if (!form?.channelId) {
          setChannelMessage({ tone: 'warn', text: '先在偏好里选一个渠道，再测试发送。' })
          return
        }
        setBusy('channel-test')
        setChannelMessage(null)
        try {
          const result = await jpost('/channel/test', {
            channelId: form.channelId,
            options: form.channelOptions?.[form.channelId] || {},
          })
          setChannelMessage({ tone: 'ok', text: result.message || '测试消息已发送' })
        } catch (channelError) {
          setChannelMessage({ tone: 'error', text: channelError.message || '测试发送失败' })
        } finally {
          setBusy('')
        }
      }

      async function savePreferences() {
        if (!form) return
        setBusy('save')
        setNotice(null)
        try {
          const result = await jpost('/config', { config: payloadOf(form) })
          formTouched.current = false
          setForm(toForm(result.config))
          setNotice({ tone: 'ok', text: '已保存' })
          await refresh()
        } catch (saveError) {
          setNotice({ tone: 'error', text: saveError.message || '保存失败' })
        } finally {
          setBusy('')
        }
      }

      async function startRun(dryRun) {
        if (!form) return
        setBusy(dryRun ? 'preview' : 'run')
        setNotice(null)
        try {
          // Save the visible preferences first so mode/target edits take effect
          // even if the user did not press 保存 explicitly.
          const saved = await jpost('/config', { config: payloadOf(form) })
          formTouched.current = false
          setForm(toForm(saved.config))
          const result = await jpost('/run', { dryRun })
          if (!result.ok) {
            setNotice({ tone: 'warn', text: result.message || result.reason || '暂时不能开始' })
            return
          }
          setNotice({
            tone: 'ok',
            text: dryRun ? '开始试刷：只预览，不收藏、不推送' : '开始刷一轮，它正在自己挑',
          })
          await refresh()
        } catch (runError) {
          setNotice({ tone: 'error', text: runError.message || '开始失败' })
        } finally {
          setBusy('')
        }
      }

      async function cancelRun() {
        try {
          await jpost('/cancel')
          setNotice({ tone: 'warn', text: '已请求停止' })
          await refresh()
        } catch (cancelError) {
          setNotice({ tone: 'error', text: cancelError.message || '停止失败' })
        }
      }

      async function copyRun(run) {
        if (!run) return
        const lines = [
          `【B站自主刷片 · ${formatDate(run.finishedAt || run.startedAt)}】`,
          ...((run.picks || []).map(
            (pick, index) =>
              `${index + 1}. ${pick.title}\n${videoUrl(pick.bvid)}\n   ${pick.reason || ''}`,
          )),
        ]
        setCopyBusy(run.id)
        try {
          await copyText(lines.join('\n\n'))
          setNotice({ tone: 'ok', text: '清单已复制' })
        } catch (copyError) {
          setNotice({ tone: 'error', text: copyError.message || '复制失败' })
        } finally {
          setCopyBusy('')
        }
      }

      const running = status?.running || null
      const latestRun = status?.lastRun || null
      const loggedIn = status?.login?.state === 'logged-in'
      const qrVisible = Boolean(qr)
      const deliveryMode = form?.deliveryMode || status?.config?.deliveryMode || 'favorite'
      const needsLogin = deliveryMode !== 'channel'
      const needsChannel = deliveryMode !== 'favorite'
      const channels = Array.isArray(status?.channels) ? status.channels : []
      const selectedChannel = channels.find((item) => item.id === form?.channelId) || null
      const channelOptions = form?.channelOptions?.[form?.channelId] || {}
      const channelReady =
        !needsChannel ||
        Boolean(
          selectedChannel &&
            selectedChannel.available !== false &&
            (selectedChannel.fields || []).every(
              (field) =>
                !field.required ||
                String(channelOptions[field.key] ?? field.default ?? '').trim() !== '',
            ),
        )

      if (error && !status) {
        return h(
          'div',
          { 'data-bf-page': '' },
          h('style', null, CSS),
          h(
            'div',
            { 'data-bf-section': '' },
            h('div', { 'data-bf-label': '' }, '读不到插件状态'),
            h('div', { 'data-bf-msg': '', 'data-bf-tone': 'error' }, error),
            h(
              'button',
              { type: 'button', 'data-bf-btn': '', onClick: refresh },
              '重试',
            ),
          ),
        )
      }

      return h(
        'div',
        { 'data-bf-page': '' },
        h('style', null, CSS),
        h(
          'div',
          { 'data-bf-head': '' },
          h(
            'div',
            { 'data-bf-title': '' },
            'B站自主刷片',
            status ? h('span', { 'data-bf-badge': '' }, `v${status.version}`) : null,
          ),
          h(
            'div',
            { 'data-bf-sub': '' },
            '用你的 B站账号刷推荐流：模型自己点开视频、读字幕，再按它自己的品味挑片，收藏到你指定的收藏夹。',
          ),
        ),
        h(Account, {
          status,
          qr,
          busy,
          startLogin,
          cancelLogin,
          logout,
          requestLogout: () => setConfirmLogout(true),
          confirmLogout,
          refresh,
        }),
        h(
          'div',
          { 'data-bf-tabs': '', role: 'tablist' },
          TABS.map(([id, label]) =>
            h(
              'button',
              {
                key: id,
                type: 'button',
                role: 'tab',
                'data-bf-tab': '',
                'aria-selected': tab === id ? 'true' : 'false',
                onClick: () => setTab(id),
              },
              label,
            ),
          ),
        ),
        tab === 'run'
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { 'data-bf-section': '' },
                h(
                  'div',
                  { 'data-bf-row': '' },
                  h(
                    'button',
                    {
                      type: 'button',
                      'data-bf-btn': '',
                      'data-bf-primary': '',
                      disabled:
                        Boolean(running) ||
                        Boolean(busy) ||
                        (needsLogin && !loggedIn) ||
                        !channelReady,
                      onClick: () => startRun(false),
                    },
                    busy === 'run' ? '正在开始…' : '开始刷一轮',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      'data-bf-btn': '',
                      disabled: Boolean(running) || Boolean(busy),
                      onClick: () => startRun(true),
                    },
                    busy === 'preview' ? '正在开始…' : '试刷（不投递）',
                  ),
                  running
                    ? h(
                        'button',
                        { type: 'button', 'data-bf-btn': '', 'data-bf-danger': '', onClick: cancelRun },
                        '停止',
                      )
                    : null,
                  h('div', { 'data-bf-grow': '' }),
                  h(
                    'div',
                    { 'data-bf-hint': '' },
                    `${needsLogin ? (loggedIn ? '登录状态：正常' : '未登录：只 QQ 可用，收藏需要登录') : '只 QQ：不需要 B站登录'}${
                      needsChannel && !channelReady ? ' · 请先选好 QQ 渠道并填必填项' : ''
                    }`,
                  ),
                ),
                h(
                  'div',
                  { 'data-bf-note': '' },
                  `这一轮会扫 ${form?.scan ?? 20} 条候选，模型最多点开 ${
                    form?.deepRead ?? 8
                  } 条读内容，最后最多挑 ${form?.count ?? 5} 条。当前投递：${deliveryLabel(
                    deliveryMode,
                  )}${needsChannel ? ` · 渠道：${selectedChannel?.label || '未选'}` : ''}。判断用当前默认模型，会消耗 token。`,
                ),
                status?.note ? h('div', { 'data-bf-msg': '' }, status.note) : null,
                h(Notice, { notice }),
                h(Progress, { running }),
              ),
              running
                ? running.picks && running.picks.length
                  ? h(
                      'div',
                      { 'data-bf-section': '' },
                      h('div', { 'data-bf-label': '' }, '它已经挑出的视频'),
                      h(
                        'div',
                        { 'data-bf-cards': '' },
                        running.picks.map((pick) => h(PickCard, { key: pick.bvid, pick })),
                      ),
                    )
                  : null
                : latestRun
                  ? h(
                      'div',
                      { 'data-bf-section': '' },
                      h('div', { 'data-bf-label': '' }, '最近一轮'),
                      h(RunView, {
                        run: latestRun,
                        expanded: true,
                        onCopy: copyRun,
                        copyBusy: copyBusy === latestRun.id,
                      }),
                    )
                  : h(
                      'div',
                      { 'data-bf-section': '' },
                      h('div', { 'data-bf-empty': '' }, '还没有运行记录。先「试刷」看看它自己会挑什么。'),
                    ),
            )
          : null,
        tab === 'prefs'
          ? h(Preferences, {
              status,
              form,
              setForm: (updater) => {
                formTouched.current = true
                setForm(updater)
              },
              folders,
              busy,
              save: savePreferences,
              loadFolders,
              notice,
              channelMessage,
              listChannelTargets,
              testChannel,
            })
          : null,
        tab === 'history'
          ? h(History, {
              status,
              expandedRun,
              setExpandedRun,
              copyRun,
              copyBusy,
            })
          : null,
        h(
          'div',
          { 'data-bf-footer': '' },
          h('span', null, status ? `v${status.version}` : ''),
          h('span', null, status?.model ? `模型 ${status.model.provider}/${status.model.model}` : '未配置模型'),
          h('span', null, status?.home ? `数据目录 ${status.home}` : ''),
          qrVisible ? h('span', null, '正在等待扫码…') : null,
        ),
      )
    }

    async function copyText(text) {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('当前浏览器不允许写入剪贴板，请手动复制')
      }
      await navigator.clipboard.writeText(text)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        ctx.effect(
          () =>
            slots.inject('settings.section', () =>
              slots.register(
                {
                  name: 'settings.section',
                  id: 'bili-fav',
                  order: 40,
                  label: 'B站自主刷片',
                },
                () => h(Panel),
              ),
            ),
          'bili-fav: settings page',
        )
      },
    }
  },
})
