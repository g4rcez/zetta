# Slack plugin

The `slack` plugin lets people in your Slack workspace write to one of your bots (a direct message, or an @mention in a channel) and lets the bot answer in the same place. Slack **pushes** each message to Zetta, so the server must be reachable from the internet (a public address, HTTPS).

Everybody who writes in Slack is an **outside person**: same trust as Telegram. The bot's reply turn cannot run code or change anything; it has only its reply tool and `read_thread`.

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps) from this manifest (replace the address and your user id):

```yaml
display_information:
  name: Zetta bot
features:
  bot_user:
    display_name: Zetta bot
    always_online: true
  app_home:
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - im:history
      - chat:write
settings:
  event_subscriptions:
    request_url: https://YOUR-SERVER/api/inbound/slack/hook/YOUR-ZETTA-USER-ID
    bot_events:
      - app_mention
      - message.im
  org_deploy_enabled: false
  socket_mode_enabled: false
```

2. Install the app to the workspace. Copy the **Bot User OAuth Token** (`xoxb-…`) and, under Basic Information, the **Signing Secret**.
3. Studio > Plugins > **Slack** > Install, paste both. They are stored encrypted and never shown again.
4. Open **Inbound** for the bot that should answer and add the Slack route. Slack's one-time check of the Request URL passes as soon as the signing secret is right.
5. Turn on **Allow replies** on the installed card when you want the bot to answer.

## Limits

- One bot answers for a workspace install (one route per plugin and person).
- A direct message is one chat; each @mention is a thread. Channel chatter without a mention is ignored.
- Replies are plain text; Slack's control sequences (`<!channel>`, `<@U…>`, links) are escaped, so a reply cannot ping people. Limited to 10 a minute.
- No approve buttons in Slack: a bot's write actions are not available to outside people at all.
- Requests older than five minutes, or not signed with your secret, are refused.
- Not yet checked against a real workspace; tested with signed fake requests and a fake Slack API.
