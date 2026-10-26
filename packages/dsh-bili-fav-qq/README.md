# dsh-bili-fav-qq

`dsh-bili-fav` 的 **QQ 渠道适配器**，直接调用**腾讯 QQ 官方 Bot API**。

它不依赖 DSH 的 QQ Bot 插件，也不使用 `qq_send__*` 工具；只要在 QQ 开放平台创建机器人，填 AppID / ClientSecret / 目标 openid 即可。

## 安装

先安装/启用 `dsh-bili-fav`，再安装本包：

```bash
dsh plugin add /path/to/dsh-bili-fav/packages/dsh-bili-fav-qq
```

安装并启用后，核心设置页「投递方式 → 只第三方渠道 / 都要」里会出现 **QQ Bot（官方 API）**。

## 配置

| 字段 | 说明 |
|---|---|
| AppID | QQ 开放平台机器人的 AppID |
| ClientSecret | QQ 开放平台机器人的 ClientSecret；只保存在本机 `config.json`（0600） |
| 目标 openid | 群的 `group_openid` 或用户的 `user_openid`，官方 Bot 的 openid 通常 32 位以上 |
| 目标类型 | 单聊 `c2c` / 群聊 `group` |
| 被动回复 msg_id | 可选；来自最近一条入站事件的 `d.id`，群聊 5 分钟、单聊 60 分钟内有效。不填走主动消息 |

点「测试发送」会走官方 API 真发一条消息；主动消息受官方频控/权限限制，失败原因会直接显示。

## 官方接口

```text
POST https://api.bot.qq.com/app/getAppAccessToken
  { "appId": "...", "clientSecret": "..." }

POST https://api.bot.qq.com/v2/groups/{group_openid}/messages
POST https://api.bot.qq.com/v2/users/{user_openid}/messages
  Authorization: QQBot <access_token>
  { "msg_type": 0, "content": "...", "msg_id": "...", "msg_seq": 1 }
```

- access_token 有效期约 7200 秒；适配器会缓存并在过期前 60 秒刷新。
- 群聊被动回复 5 分钟 / 5 次；单聊被动回复 60 分钟 / 4 次。
- 主动消息受 Bot/单关系频控与权限限制；出错会原样显示官方 `err_code` / `message`。

参考：[获取访问凭证](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html)、[发送群聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)、[发送单聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html)。

## 第三方渠道

本包仍然是 `biliFavChannels` 渠道 API 的参考实现：

```js
export const inject = ['biliFavChannels']

export function apply(ctx) {
  ctx.effect(() => ctx.biliFavChannels.register({
    id: 'webhook',
    label: 'Webhook',
    fields: [{ key: 'url', label: 'URL', type: 'text', required: true }],
    async send(payload, options) {
      await fetch(options.url, { method: 'POST', body: payload.text })
      return { ok: true, message: 'sent' }
    },
  }))
}
```

核心只负责选择渠道、渲染字段、调用 `send/listTargets/test`，不 import 任何渠道包。
