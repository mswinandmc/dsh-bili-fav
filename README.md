# dsh-bili-qq ｜ B站自主刷片 + QQ 官方 Bot

[![npm](https://img.shields.io/npm/v/dsh-bili-qq.svg)](https://www.npmjs.com/package/dsh-bili-qq)

一个 DeepSeek Harness（DSH）插件：让 agent 在你当前的 DSH 会话里自己刷 B站、自己点开视频、自己读字幕、自己挑片写理由，然后调用工具通过**腾讯 QQ 官方 Bot API** 发给你；QQ 私聊里的回复会转回同一个会话，agent 接着聊。

腾讯 QQ 适配器已经内置，不需要再单独安装适配器插件。

## 它是什么

- **B站登录沿用现在的扫码 / Cookie**，登录凭证只保存在本机。
- **当前 DSH 会话就是长期会话**：QQ 渠道已配置时，自动和手动任务都 prompt 这个会话，agent 用它自己的判断做完整一轮。
- **agent 是执行者**：它调用 `bili_fav_recommend` 刷推荐、写 QQ 文案，再调用 `bili_fav_push` 走 QQ 官方 API 推送。
- **QQ 回消息会回到会话**：内置 QQ 网关收到私聊消息后，把它转成会话任务，agent 再用 `bili_fav_push` 回复；群消息忽略。
- **回复提示词可自定义**：设置页里改 agent 的 QQ 回复风格；默认是“称呼主人、自称本鲸、文明简短”。

不做：日记、人设、角色扮演、评论/私信自动回复、点赞/投币、伪造播放。

## 工作方式

一轮推荐：

1. QQ 渠道已配置时，到点或点「让 agent 刷一轮」，插件把任务 prompt 进当前 DSH 会话。
2. agent 调 `bili_fav_recommend`，用 B站 Cookie / 游客推荐流取候选，像普通观众一样被某条吸引、点开读字幕，再决定要不要推；不必凑满，也可以今天什么都不推。
3. agent 按「回复提示词」自己写 QQ 文案（不套固定模板）：分两条发，第一条理由，第二条链接；两条合计不超过 180 字，不报统计、不编号、不列清单；对用户的称呼和自称也由回复提示词决定。
4. agent 分两次调用 `bili_fav_push`，每次只传一条，插件通过内置 QQ 官方渠道分别发出去。
5. 用户在 QQ 私聊回消息，QQ 网关把消息转回同一 DSH 会话，agent 用 `bili_fav_push` 回复。

宿主不会绕过 agent 直接推 QQ；QQ 私聊消息也不会只在会话里落灰。

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


## 第一次使用

1. **登录 B站**：设置 → B站自主刷片 → 扫码登录。凭证落在 `<DSH_HOME>/bili-fav/credentials.json`（0600）。
2. **配置 QQ**：在「QQ 渠道」里选中 QQ，再填腾讯 QQ 开放平台机器人的 **AppID / ClientSecret**；私聊 user_openid 可以手动填，也可以点「读取目标」让官方事件网关自动收集；留空用上次成功的私聊目标。渠道选「未选择」时视为未配置。
3. **调回复风格**：在「回复提示词」里写 agent 的 QQ 语气；留空使用默认的 QQ 聊天语气。
4. **QQ 回消息**：保持「把 QQ 收到的消息转到 DSH 会话」开启，用户在 QQ 私聊回复时 agent 会接着回。
5. **试运行**：点「试刷（不投递）」先看它挑什么；满意后点「让 agent 刷一轮」。
6. **自主唤醒**：打开「自主唤醒（生物钟）」，设置作息窗口、每个窗口醒几次和最小唤醒间隔；QQ 渠道已配置时，到点会把任务交给会话。

## 设置页

- **B站账号**：扫码登录/退出；显示当前登录用户。
- **它怎么挑**：给模型的一句参考、候选数量、深读数量、最多挑几条。
- **回复提示词**：agent 写 QQ 文案和回复 QQ 消息时的风格/格式，包括对用户的称呼和自称；留空使用默认的 QQ 聊天语气。
- **QQ 渠道**：先选中 QQ，再填 AppID、ClientSecret、私聊目标、手动 user_openid、msg_id，以及「把 QQ 收到的消息转到 DSH 会话」。选「未选择（视为未配置）」时，QQ 推送、「让 agent 刷一轮」、自主唤醒和 QQ 入站都会关闭，试刷仍可用。
- **自主唤醒**：作息窗口 + 每个窗口醒几次 + 最小唤醒间隔；QQ 渠道已配置时，到点用 sessionController.prompt 叫醒当前会话。
- **运行/历史**：试刷、让 agent 刷一轮、停止、每轮记录和清单复制。

不再有「收藏到哪个收藏夹」和「投递方式」设置。收藏相关工具仍保留，但不在推荐/QQ 主流程里；推荐和推送不依赖收藏夹。

## Agent 工具

| 工具 | 用途 |
|---|---|
| `bili_fav_recommend` | 即时刷一轮，返回 messages（[理由, 链接]）、picks、理由和配置的 `replyPrompt`；不收藏、不推送 |
| `bili_fav_push` | 一次发一条 agent 写的 `text`；推荐时分两次调用（先理由、再链接）。需要先在设置页选中渠道并填好必填项，未选择视为未配置；`runId` 可选 |
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
- 入站：QQ 渠道已选中且配置完整时，网关收到私聊 `MESSAGE_CREATE` 后转发到当前 DSH 会话；群消息忽略；可在设置里关掉

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
- 到点后，若 QQ 渠道已配置，插件用 `sessionController.prompt` 唤醒**当前 DSH 会话**，agent 自己刷、自己写文案、调 `bili_fav_push` 推 QQ；
- 计划里的这一轮标记完成后不会重复叫醒；改窗口/间隔会重排当天计划；
- 自动任务不再由宿主直接刷、直接推。

建议先手动「让 agent 刷一轮」试一次，再打开自主唤醒。


## 已知限制

- 建议登录 B站；游客访问推荐流可能被 B站风控阻止。
- B站字幕接口未登录/未开启 AI 字幕时可能为空，此时只能按标题/简介/标签判断。
- B站风控（-352 / -412）会让这一轮失败，过一会儿再试。
- 一轮是“一批候选 + agent 自己点开若干条”，不是无限下滑；想多看就把候选数调大（最多 30）。
- QQ 推送仅限私聊；群聊目标会被忽略并回退到最近的私聊目标，群消息不会转进会话。
- QQ 官方网关受网络和腾讯 API 影响；`fetch failed` 不等于渠道没注册。
- 自主唤醒按插件机器本地时间，不跟随浏览器时区。

## License

MIT
