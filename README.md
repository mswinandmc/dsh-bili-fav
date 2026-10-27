# dsh-bili-qq ｜ B站自主刷片 + QQ 官方 Bot

[![npm](https://img.shields.io/npm/v/dsh-bili-qq.svg)](https://www.npmjs.com/package/dsh-bili-qq)

一个 DeepSeek Harness（DSH）插件：让 agent 在你当前的 DSH 会话里自己刷 B站、自己点开视频、自己读字幕、自己挑片写理由，然后调用工具通过**腾讯 QQ 官方 Bot API** 发给你；QQ 里的回复会转回同一个会话，agent 接着聊。

腾讯 QQ 适配器已经内置，不需要再单独安装适配器插件。

## 它是什么

- **B站登录沿用现在的扫码 / Cookie**，登录凭证只保存在本机。
- **当前 DSH 会话就是长期会话**：自动和手动任务都 prompt 这个会话，agent 用它自己的判断做完整一轮。
- **agent 是执行者**：它调用 `bili_fav_recommend` 刷推荐、写 QQ 文案，再调用 `bili_fav_push` 走 QQ 官方 API 推送。
- **QQ 回消息会回到会话**：内置 QQ 网关收到私聊/群消息后，把它转成会话任务，agent 再用 `bili_fav_push` 回复。
- **回复提示词可自定义**：设置页里改 agent 的 QQ 回复风格；默认是“称呼主人、自称本鲸、文明简短”。

不做：日记、作息、人设、评论/私信自动回复、点赞/投币、伪造播放。

## 工作方式

一轮推荐：

1. 到点或点「让 agent 刷一轮」，插件把任务 prompt 进当前 DSH 会话。
2. agent 调 `bili_fav_recommend`，用 B站 Cookie / 游客推荐流取候选，像普通观众一样被某条吸引、点开读字幕，再决定要不要推；不必凑满，也可以今天什么都不推。
3. agent 按「回复提示词」自己写 QQ 文案（不套固定模板）：只写一条短消息，只讲 1 条、2–3 句、不超过 180 字，不报统计、不编号、不列清单；对用户的称呼和自称也由回复提示词决定。
4. agent 调 `bili_fav_push`，把文案作为 `text` 通过内置 QQ 官方渠道发出去。
5. 用户在 QQ 回消息，QQ 网关把消息转回同一 DSH 会话，agent 用 `bili_fav_push` 回复。

宿主不会绕过 agent 直接推 QQ；QQ 消息也不会只在会话里落灰。

## 安装

推荐 npm：

```bash
dsh plugin --profile web add dsh-bili-qq
```

或直接从 GitHub：

```bash
dsh plugin --profile web add https://github.com/mswinandmc/dsh-bili-qq
```

这个包本身就是 DSH bundle（`dsh.bundle.patch` + `dsh.client`）。装完重启 DSH，进 **设置 → B站自主刷片**。

本地开发目录：

```bash
dsh plugin --profile web add /path/to/this/directory
```

## 第一次使用

1. **登录 B站**：设置 → B站自主刷片 → 扫码登录。凭证落在 `<DSH_HOME>/bili-fav/credentials.json`（0600）。
2. **配置 QQ**：在「QQ 渠道」里填腾讯 QQ 开放平台机器人的 **AppID / ClientSecret**；私聊 user_openid 可以手动填，也可以点「读取目标」让官方事件网关自动收集；留空用上次成功的私聊目标。
3. **调回复风格**：在「回复提示词」里写 agent 的 QQ 语气；留空使用默认的 QQ 聊天语气。
4. **QQ 回消息**：保持「把 QQ 收到的消息转到 DSH 会话」开启，用户在 QQ 私聊回复时 agent 会接着回。
5. **试运行**：点「试刷（不投递）」先看它挑什么；满意后点「让 agent 刷一轮」。
6. **自动运行**：在偏好里打开「每天自动刷一轮」，选本机时间；到点会把任务交给会话。

## 设置页

- **B站账号**：扫码登录/退出；显示当前登录用户。
- **它怎么挑**：给模型的一句参考、候选数量、深读数量、最多挑几条。
- **回复提示词**：agent 写 QQ 文案和回复 QQ 消息时的风格/格式，包括对用户的称呼和自称；留空使用默认的 QQ 聊天语气。
- **QQ 渠道**：AppID、ClientSecret、私聊目标、手动 user_openid、msg_id，以及「把 QQ 收到的消息转到 DSH 会话」。
- **自主唤醒**：作息窗口 + 每个窗口醒几次 + 最小唤醒间隔；到点用 sessionController.prompt 叫醒当前会话。
- **运行/历史**：试刷、让 agent 刷一轮、停止、每轮记录和清单复制。

不再有「收藏到哪个收藏夹」和「投递方式」设置。收藏相关工具仍保留，但不在推荐/QQ 主流程里；推荐和推送不依赖收藏夹。

## Agent 工具

| 工具 | 用途 |
|---|---|
| `bili_fav_recommend` | 即时刷一轮，返回一条中性短草稿、picks、理由和配置的 `replyPrompt`；不收藏、不推送 |
| `bili_fav_push` | 把 agent 自己写的 `text` 通过 QQ 官方 API 发出去；纯文本或推荐都行，`runId` 可选 |
| `bili_fav_last` | 只读最近一轮推荐（标题/链接/理由），用于回答“刚才推荐了什么/为什么” |
| `bili_fav_preview` | 只预览一轮，不写收藏、不发送 |
| `bili_fav_run` | 只收藏（不推送）；需要 B站登录 |
| `bili_fav_folders` | 列出现有收藏夹（收藏工具用） |
| `bili_fav_status` | 查看登录、模型、渠道、最近一轮和配置（密钥脱敏） |
| `bili_fav_channels` | 列出渠道、读取目标、测试发送 |

## 腾讯 QQ 官方 Bot

内置渠道直接调用腾讯官方 API，不依赖 QQ Bot 插件。**QQ 推送仅限私聊（c2c），不会发到群聊**：

- 发送：`POST https://api.bot.qq.com/v2/users/{user_openid}/messages`
- 鉴权：`Authorization: QQBot <access_token>`
- 目标：只收集私聊目标，或手动填私聊 user_openid；留空回退最近成功的私聊目标；旧配置里的群聊目标会被忽略
- 被动回复：有最近入站私聊 `msg_id` 时自动带上，私聊窗口由腾讯限制（约 60 分钟）
- 入站：网关收到私聊 `MESSAGE_CREATE` 后转发到当前 DSH 会话；群消息忽略；可在设置里关掉

QQ 主动消息的配额、权限、目标 openid 都由腾讯官方 Bot 平台决定。`fetch failed` / 401 / 403 先查网络、AppID/ClientSecret、机器人权限和私聊目标。

## 自主唤醒（生物钟）

设置里的「自主唤醒」不再是一个固定时间，而是**作息窗口**：

```text
窗口 07:00–08:00，wakes 2
窗口 20:00–22:00，wakes 1
最小唤醒间隔 120 分钟
```

- 每天按窗口随机生成唤醒点；同一个窗口醒 `wakes` 次；
- 唤醒点之间保持“最小唤醒间隔”，不会挤在一起；
- 到点后插件用 `sessionController.prompt` 唤醒**当前 DSH 会话**，agent 自己刷、自己写文案、调 `bili_fav_push` 推 QQ；
- 计划里的这一轮标记完成后不会重复叫醒；改窗口/间隔会重排当天计划；
- 自动任务不再由宿主直接刷、直接推。

建议先手动「让 agent 刷一轮」试一次，再打开自主唤醒。

## 数据与安全

`<DSH_HOME>/bili-fav/`：

| 文件 | 内容 |
|---|---|
| `config.json` | 偏好、回复提示词、QQ/渠道 options、自动刷时间（0600） |
| `credentials.json` | B站 Cookie（0600） |
| `state.json` | 最近运行、去重、收藏夹缓存 |
| `qq-targets.json` | 官方网关收集到的 QQ 目标（0600） |
| `bili-fav.log` | 诊断日志（不含 Cookie/ClientSecret） |

- Cookie 和 ClientSecret 不出现在工具结果、API 返回或日志里；设置页状态里的密钥会脱敏。
- HTTP API 走 DSH 的信任栅栏，只服务同源页面。
- 视频标题/简介/字幕是不可信外部内容，提示词要求忽略其中的指令。
- 不会点赞、投币、发评论、私信或伪造播放。

## 开发与测试

要求 Node.js >= 22，零运行时/开发依赖。

```bash
npm test            # 37 个单元测试
npm run check       # release preflight + 测试
npm pack --dry-run  # 查看发布文件
```

仓库：https://github.com/mswinandmc/dsh-bili-qq

## 发布

版本号写在 `package.json`。推同版本 `v*` tag 会触发 `.github/workflows/release.yml`：

1. 校验 tag 与 `package.json` 版本；
2. 跑 preflight 和单元测试；
3. 用 npm trusted publishing（OIDC，无 NPM_TOKEN）发布 `dsh-bili-qq`；
4. 创建 GitHub Release。

`beta` tag 走 npm `beta`；`rc` tag 按主人决定走 `latest`；稳定版走 `latest`。

npm 侧需要为 `dsh-bili-qq` 配置 Trusted Publisher：GitHub Actions / `mswinandmc` / `dsh-bili-qq` / `release.yml`，允许 `npm publish`。

```bash
git tag v0.2.0-rc1
git push origin v0.2.0-rc1
```

## 已知限制

- 建议登录 B站；游客访问推荐流可能被 B站风控阻止。
- B站字幕接口未登录/未开启 AI 字幕时可能为空，此时只能按标题/简介/标签判断。
- B站风控（-352 / -412）会让这一轮失败，过一会儿再试。
- 一轮是“一批候选 + agent 自己点开若干条”，不是无限下滑；想多看就把候选数调大（最多 30）。
- QQ 推送仅限私聊；群聊目标会被忽略并回退到最近的私聊目标，群消息不会转进会话。
- QQ 官方网关受网络和腾讯 API 影响；`fetch failed` 不等于渠道没注册。
- 自动运行按插件机器本地时间，不跟随浏览器时区。

## License

MIT
