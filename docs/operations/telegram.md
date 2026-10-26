# Telegram plugin

The `telegram` plugin lets bots read your Telegram chats and groups and, if you allow it, send and manage messages, through your own bot on the official [Telegram Bot API](https://core.telegram.org/bots/api). Nothing to host: Zetta calls `api.telegram.org` (a fixed host, so the private-network setting does not apply).

1. In Telegram open [@BotFather](https://t.me/BotFather), send `/newbot` and copy the token.
2. Studio > Plugins > **Telegram** > Install, paste the token. The token is stored encrypted for your account and never shown again.
3. Add the bot to your groups (or message it once). Use **Sync chats** on the installed plugin to refresh the list.
4. Under **Bots**, enable the plugin for the bots that may use it.

## What bots can do

| Tool | Needs | Notes |
| --- | --- | --- |
| `status`, `list_chats`, `read_messages`, `get_chat`, `get_member` | nothing | Read only. Text from Telegram is untrusted: sanitised, truncated and flagged as data. |
| `send_message`, `edit_message`, `forward_message`, `send_media` | **Allow sending** | Plain text only (no parse mode, no link previews). Media is sent by public `https` URL. |
| `delete_message`, `pin_message`, `unpin_message` | **Allow managing messages** | The bot also needs those rights in the chat. |

Every write is off by default, rate limited (10/minute, 60/hour per user) and can be limited to an allowlist of chat ids or `@usernames`. Change the permissions any time from the installed card.

## Limits of the Bot API (not of Zetta)

- A bot cannot list chats or fetch history. It only receives updates, so Zetta reads the bot's **last 100 updates** and remembers the chats it has seen (up to 50) so groups stay listed.
- In groups a bot sees only commands and mentions while **Group Privacy** is on. To read everything: `/setprivacy` in @BotFather, choose the bot, Disable, then remove and re-add the bot to each group. The installed card tells you which mode applies.
- Telegram delivers a bot's updates to one place. If the bot has a **webhook**, reading is refused until you remove it; Zetta asks for confirmation before doing so (Sync chats > Remove webhook and sync).
