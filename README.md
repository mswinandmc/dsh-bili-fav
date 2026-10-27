# dsh-bili-fav ｜ B站自主刷片

[![npm](https://img.shields.io/npm/v/dsh-bili-fav.svg)](https://www.npmjs.com/package/dsh-bili-fav)

用你的哔哩哔哩账号刷推荐流，让模型**自己决定点开哪些视频、自己读字幕、按自己的品味挑片**，最后把挑中的视频收藏到你指定的自定义收藏夹（可以公开分享）。

这是一个 DeepSeek Harness（DSH）设置页插件：装在 DSH 的 `web` profile 里，设置里会多出一页「B站自主刷片」。**纯 JavaScript，不需要 Python，不需要装任何运行时依赖。**

## 它怎么工作

一轮大概是这样：

1. **刷**：用你登录后的 Cookie 请求 B站个性化推荐流，取回一批候选（默认 20 条）。
2. **自己挑**：把候选的标题、UP、时长、播放/点赞、标签、简介交给模型，让模型凭自己的好奇心和品味选出**它想点开看**的视频（默认最多 8 条）。
3. **自己看**：只给这 8 条读视频详情、标签和**字幕原文**（登录后 B站 AI 字幕可用时），再交给模型。
4. **自己决定**：模型读完内容后，按它自己的判断挑出真正值得收藏的（默认最多 5 条），并写一句第一人称的理由。
5. **收藏**：把结果写进你设置的收藏夹；同名收藏夹不存在时会自动创建一个公开收藏夹。

页面上能看到的：

- 它这一轮**点开了哪些**、为什么想点开、读到了多少字字幕；
- 它最后**收藏了哪些**、理由是什么；
- 每轮的记录、失败原因、模型是谁；
- 可以一键复制本轮清单去分享。

偏好里的「给模型的一句参考」是**可选**的。留空就是完全按模型自己的判断；填了也只是参考，不是关键词过滤。

## 投递方式

核心只负责刷推荐流、模型挑片、写 B站收藏夹；**投递本身由独立渠道插件提供**。设置 → **偏好** → **投递方式**：

| 模式 | 做什么 | 需要 |
|---|---|---|
| **只收藏** | 挑中的视频写进 B站收藏夹 | B站登录 + 收藏夹 |
| **只 QQ** | 把「标题 + BV 链接 + 理由」交给 QQ 渠道，不写收藏夹 | 安装并启用 QQ 适配器 |
| **两者都要** | 收藏夹和渠道各走一遍；一路失败会标在记录里 | 两者都需要 |

核心包里没有任何 QQ 代码；内置的 **Webhook** 是通用 HTTP 渠道，不需要 QQ Bot。QQ 推送由独立包 **`dsh-bili-fav-qq`** 提供（源码在独立库 https://github.com/mswinandmc/dsh-bili-fav-qq）：它**直接调用腾讯 QQ 官方 Bot API**，不依赖 QQ Bot 插件；安装并启用后，设置页会出现 **QQ Bot（官方 API）** 渠道，字段为 AppID / ClientSecret / 目标（可选下拉，官方事件网关自动收集，也可手动填 openid）/ 手动目标类型 / 可选 msg_id；留空会用上次成功目标。

「只 QQ」不要求 B站登录（用游客推荐流；个性化推荐和字幕仍需登录）。渠道主动消息的配额/权限由渠道自己负责，失败原因会写进运行记录。

## 对话式推荐

用户在 QQ 里可以直接问“推荐几个视频 / 换一批 / 为什么推这个”。

- agent 调 `bili_fav_recommend`，把用户这句话当**一次性偏好**，即时刷一轮并返回带理由的推荐清单；不写收藏夹、不推送、不改保存的偏好。
- 自主推送的消息末尾会邀请用户回复；用户追问某条理由时，agent 读 `bili_fav_status` 的 `lastRun`（含每条的 `reason`）回答，不需要重新刷。
- 推送后会短提示 DSH agent 进入**真实模型回合**：先调只读工具 `bili_fav_last` 读这轮推荐和理由，再用模型自己的话和用户聊一两句，邀请追问/换一批。不会把推荐原文或内部备注直接注入/转发。
- 用户追问“刚才推荐了什么/为什么推这个”时，agent 也调 `bili_fav_last`；它只读，不收藏、不推送、不重复清单。
- 要真正收藏/推送时仍用 `bili_fav_run`；对话推荐只负责“聊”和“理由”。

这不是核心插件自己直接收 QQ 消息：收消息和对话由 DSH 的 QQ agent 负责，核心通过工具提供推荐和理由；官方 API 适配器只负责把结果发出去。

### 内置 Webhook（不依赖 QQ Bot）

核心自带一个 **Webhook** 渠道，完全不需要安装 QQ Bot 插件：

1. 设置 → 偏好 → 投递方式选 **只 QQ**（或 **都要**）；
2. 渠道选 **Webhook**；
3. 填 URL，必要时填 `Authorization`（原样放进请求头），选 JSON / 纯文本；
4. 点 **测试发送** 联调。

JSON 模式会 POST：

```json
{
  "title": "🐟 大肥鱼推荐",
  "text": "标题 + BV 链接 + 理由",
  "picks": [{ "bvid": "BV...", "title": "...", "reason": "..." }],
  "folder": { "id": 123, "title": "大肥鱼推荐", "link": "..." },
  "mode": "channel",
  "sentAt": "2026-..."
}
```

可以接自建服务、ntfy、Telegram relay，或外部 OneBot/NapCat 的 HTTP 接口；核心不关心对面是谁。

## 渠道插件 API

核心在宿主里提供 Cordis 服务 `biliFavChannels`，任意插件都可以注册渠道：

```js
export const inject = ['biliFavChannels']

export function apply(ctx) {
  ctx.effect(() => ctx.biliFavChannels.register({
    id: 'webhook',
    label: 'Webhook',
    description: 'POST 到自己的服务',
    fields: [
      { key: 'url', label: 'URL', type: 'text', required: true },
    ],
    async send(payload, options, { signal }) {
      const response = await fetch(options.url, {
        method: 'POST',
        body: JSON.stringify({ text: payload.text, picks: payload.picks }),
        signal,
      })
      return { ok: response.ok, message: response.ok ? '已 POST' : `HTTP ${response.status}` }
    },
    async test(options, { signal }) {
      // 可选：设置页的「测试发送」会调用它
      return { ok: true, message: 'ok' }
    },
  }), 'webhook channel')
}
```

`register` 支持的字段：

- `id` / `label` / `description` / `order`
- `fields`：设置页自动渲染的字段，类型 `text | textarea | select | checkbox`，可带 `required / placeholder / help / default / options`
- `send(payload, options, { signal })`：必须；`payload` 包含 `text / title / picks / folder / mode`
- `listTargets(options, { signal })`：可选，设置页「读取目标」
- `test(options, { signal })`：可选，设置页「测试发送」
- `available()`：可选，返回 false 时渠道在 UI 里标为不可用
- 渠道可以调用 `ctx.biliFavChannels.updateFields(id, fields)` 动态更新下拉选项；`ctx.biliFavChannels.dataDir` 是核心数据目录

核心会按 `channelId` 选择渠道、按 `fields` 渲染表单，并把 `channelOptions[channelId]` 原样交给渠道。渠道插件可以独立安装、升级、卸载。

## 安装
## 安装

从 npm 安装（推荐）：

```bash
dsh plugin --profile web add dsh-bili-fav
```

本地开发目录：

```bash
dsh plugin --profile web add /path/to/this/directory
```

这个包本身就是一个 DSH bundle（`package.json` 里的 `dsh.bundle.patch` + `dsh.client`）。装完重启一次 DSH，然后进 **设置 → B站自主刷片**。

> 如果你是让 AI 助手装：从 npm 直接 `dsh plugin --profile web add dsh-bili-fav`；本地开发时用插件管理器的 `install_bundle`，target 指向本目录。装完用 `Cordis Inspect` 的 `Slots.listSubTree` 确认 `settings.section` 里多了一个 `bili-fav`。

## 第一次使用

1. 打开 **设置 → B站自主刷片**，点 **扫码登录**，用手机 B站 扫码。确认时建议选「记住我 / 长期」。
   - 凭证只落在本机 `<DSH_HOME>/bili-fav/credentials.json`，权限 `0600`，不会上传到任何地方。
2. 先点 **试刷（不收藏）**：不用登录也能看到模型会怎么挑（游客推荐流），但不会写收藏夹。
3. 满意后点 **开始刷一轮**。第一次运行会自动创建收藏夹「大肥鱼推荐」，也可以在偏好里改成已有收藏夹。
4. 想每天自动跑，在偏好里打开「每天自动刷一轮」，选一个本机时间。自动运行只在 DSH 开着时生效。

## 判断用的是什么模型

用 DSH 当前的**默认模型**（`agentDefaultModel`），每轮约 2 次模型调用：先挑想看的，再读完后决定收藏。会消耗 token。页面上会显示当前模型。

## 隐私与边界

- 只读：推荐流、视频详情、标签、字幕；只写：收藏夹（以及登录本身）。
- 不会点赞、不会投币、不会发评论、不会私信，也不会伪造播放。
- 模型看到的标题/简介/字幕是**不可信外部内容**；提示词里明确要求忽略其中的任何指令，防止视频内容里的 prompt injection 影响判断。
- Cookie 不会出现在 API 返回、日志或工具结果里；HTTP API 走 DSH 的信任栅栏（浏览器登录态）并只服务同源页面。
- 公开/私密由收藏夹本身决定。自动创建的新收藏夹默认公开，可以在 B站里改成私密。

## 数据目录

`<DSH_HOME>/bili-fav/`：

| 文件 | 内容 |
|---|---|
| `config.json` | 偏好（提示、数量、投递方式、渠道 id/options、收藏夹、自动刷时间） |
| `credentials.json` | B站 Cookie（0600） |
| `state.json` | 点开/收藏记录、去重表、收藏夹缓存 |
| `bili-fav.log` | 诊断日志（不含 Cookie） |

## 已知限制

- B站字幕接口在未登录/未开启 AI 字幕时可能返回空：这时只能按标题、简介、标签判断，页面会写「没读到字幕」。
- B站风控（-352 / -412）时这一轮会失败并给出提示，过一会儿再试。
- 抖音式无限下滑没有做：一轮是「一批候选 + 模型自己点开若干条」。想刷更多就把「这一轮刷多少条候选」调大（最多 30）。
- 自动运行按**插件所在机器**的本地时间，不跟随浏览器时区。
- 渠道的可用性/目标/配额由对应渠道插件负责；核心只负责选择渠道和调用 `send`，失败原因写运行记录。

## 发布（维护者）

版本号写在 `package.json`。推一个同版本的 `v*` tag，GitHub Actions 的 `.github/workflows/release.yml` 会：

1. 校验 tag 与 `package.json` 版本一致；
2. 跑 release preflight 和单元测试；
3. 用 **npm trusted publishing（OIDC，无 NPM_TOKEN）** 发布 `dsh-bili-fav`；
4. 创建对应的 GitHub Release。

```bash
git tag v0.1.1
git push origin v0.1.1
```

npm 侧只需一次性配置：npmjs.com → `dsh-bili-fav` → Settings → Trusted Publishers → GitHub Actions，填 `mswinandmc` / `dsh-bili-fav` / `release.yml`，允许 `npm publish`。首次发布前如果 npm 上还没有这个包，需要先用有权限的 npm 账号做一次首发布（或在 npm 上先创建包），之后 tag 发布就完全走 OIDC。

## 致谢

- 交互与产品思路参考了 [dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll)（MIT）。本插件是独立实现：不再依赖 Python/MCP，直接调用 B站 Web API，并把「挑什么」交给模型自己的判断。
- 二维码渲染使用了 Kazuhiko Arase 的 [QR Code Generator](https://github.com/kazuhikoarase/qrcode-generator)（MIT），见 `NOTICE.md`。

## License

MIT
