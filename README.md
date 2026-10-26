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

设置 → **偏好** → **投递方式**，三选一：

| 模式 | 做什么 | 需要 |
|---|---|---|
| **只收藏** | 挑中的视频写进 B站收藏夹 | B站登录 + 收藏夹 |
| **只 QQ 推送** | 把「标题 + BV 链接 + 理由」发到指定 QQ，不写收藏夹 | `@zaofan/dsh-qqbot` 已绑定人设，且配置了 QQ 目标 |
| **两者都要** | 收藏夹和 QQ 各走一遍；一路失败会在记录里标出 | 两者都需要 |

QQ 推送走的是 QQ Bot 插件注册的 `qq_send__<人设>` 工具（本机已装 `@zaofan/dsh-qqbot` 时可用）。在偏好里：

1. 填写 **推送到**（群名 / 群 openid / 好友昵称）；
2. 选 **目标类型**（自动识别 / 群聊 / 私聊）；
3. 点 **读取 QQ 目标** 先看机器人认识的群/私聊；点 **测试发送** 会真的发一条测试消息；
4. 保存后，下一轮就会按所选模式投递。

「只 QQ 推送」不要求 B站登录（用游客推荐流；个性化推荐和字幕仍需登录）。QQ 主动消息有平台配额，冷群第一次推送可能走主动消息；失败原因会写在运行记录里。

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
| `config.json` | 偏好（提示、数量、投递方式、收藏夹、QQ 目标、自动刷时间） |
| `credentials.json` | B站 Cookie（0600） |
| `state.json` | 点开/收藏记录、去重表、收藏夹缓存 |
| `bili-fav.log` | 诊断日志（不含 Cookie） |

## 已知限制

- B站字幕接口在未登录/未开启 AI 字幕时可能返回空：这时只能按标题、简介、标签判断，页面会写「没读到字幕」。
- B站风控（-352 / -412）时这一轮会失败并给出提示，过一会儿再试。
- 抖音式无限下滑没有做：一轮是「一批候选 + 模型自己点开若干条」。想刷更多就把「这一轮刷多少条候选」调大（最多 30）。
- 自动运行按**插件所在机器**的本地时间，不跟随浏览器时区。
- QQ 推送依赖 `qq_send__*` 工具；没有绑定 QQ 人设、没有填目标，或 QQ 主动消息配额用尽时会失败，运行记录会写原因。

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
