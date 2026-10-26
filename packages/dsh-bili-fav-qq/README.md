# dsh-bili-fav-qq

`dsh-bili-fav` 的 **QQ 渠道适配器**，独立安装、独立卸载。

它不包含任何 B站逻辑，只做一件事：通过核心插件暴露的 `biliFavChannels` 服务注册一个 `qq` 渠道，然后把推荐文本交给当前 QQ Bot 插件注册的 `qq_send__*` 工具。

## 安装

先安装/启用 `dsh-bili-fav`，再安装本包：

```bash
dsh plugin add /path/to/dsh-bili-fav/packages/dsh-bili-fav-qq
```

或在 Web 设置 → 插件里安装本地目录。安装后会多一个 bundle `dsh-bili-fav-qq`；启用后，核心的设置页「投递方式 → 只第三方渠道 / 都要」里会出现 **QQ Bot**。

## 配置

核心设置页会自动渲染本适配器声明的字段：

| 字段 | 说明 |
|---|---|
| 推送到 | 群名 / 好友昵称 / openid；官方 Bot 的 openid 很长（32+ 位）可直接粘贴 |
| 目标类型 | 自动 / 群聊 / 私聊；用 openid 时建议明确选 |
| QQ 发送工具 | 留空自动选第一个 `qq_send__*`；多个人设时填完整名 |

先点「读取目标」看机器人认识的群/私聊，再点「测试发送」联调。

## 依赖

- `dsh-bili-fav`（核心服务 `biliFavChannels`）
- 一个已启用、已绑定人设的 QQ Bot 插件，并注册了 `qq_send__*` 工具

两个依赖都不写进 `peerDependencies`：适配器通过 Cordis `inject` 等待服务/工具，缺任何一个时保持未激活，不会让核心启动失败。

## 第三方渠道

本包就是渠道 API 的参考实现。任意插件可以：

```js
export const inject = ['biliFavChannels']

export function apply(ctx) {
  ctx.effect(() => ctx.biliFavChannels.register({
    id: 'webhook',
    label: 'Webhook',
    fields: [{ key: 'url', label: 'URL', type: 'text', required: true }],
    async send(payload, options) {
      await fetch(options.url, { method: 'POST', body: payload.text })
      return { ok: true, message: '已 POST' }
    },
  }))
}
```

核心只负责选择渠道、渲染字段、调用 `send/listTargets/test`，不 import 任何渠道包。
