# WhatsApp plugin (WAHA)

The `whatsapp` plugin talks to your own [WAHA](https://waha.devlike.pro) server. Optional; the main `docker-compose.yml` is untouched.
Example service to add to your own compose file (commented on purpose):

```yaml
# services:
#   waha:
#     image: devlikeapro/waha   # on Apple Silicon / arm64 use devlikeapro/waha:arm
#     restart: unless-stopped
#     ports: ["127.0.0.1:3010:3000"]   # host port 3010: Zetta itself uses 3000; keep it off the public internet
#     environment:
#       WAHA_API_KEY: change-me          # sent by Zetta as X-Api-Key
#       WHATSAPP_DEFAULT_ENGINE: WEBJS
#     volumes: ["./.waha/sessions:/app/.sessions"]
```

1. Start WAHA, then install **WhatsApp (WAHA)** in Studio > Plugins with base URL `http://127.0.0.1:3010`, the API key and session `default`.
2. A localhost/private WAHA that **a person types** in the plugin is blocked by the same SSRF policy as MCP servers; the administrator must turn on **Let the server call private network addresses** in Studio > Server settings (the setting `allowPrivateNetwork`; it applies at once, no restart).
3. Use **Pair** on the installed plugin and scan the QR code in WhatsApp > Linked devices.
4. Sending is off. Set `Allow sending` to `yes` (optionally with a send allowlist) to let bots message; sends are capped at 1000 characters, 5/minute and 30/hour.
5. Incoming message text is untrusted data and is sanitised and truncated before bots see it.

> A WAHA container a person types in the plugin on localhost or a private network is reachable only while the setting `allowPrivateNetwork` is on (it also relaxes the same check for MCP servers). The administrator's own shared server (below) is not checked against it.

## One WAHA server for everybody

The administrator can set up the WAHA server once so that people only scan a QR code and type no address or key. In **Studio > Plugins > WhatsApp > Server for everyone**:

- **Server address**: stored as the setting `wahaUrl`. Empty means the built-in address, `http://127.0.0.1:3010`. An upgrader's `ZETTA_WAHA_URL` is imported once at the first start.
- **Server key** (`X-Api-Key`): sealed in the browser, stored encrypted as an administrator's connection, never shown again. The key is **not** imported from `ZETTA_WAHA_API_KEY`: a secret needs an owning administrator, so the server only logs a warning while that variable is still set. Save the key in Studio, then remove the variable. The key is shared by everyone who uses WhatsApp here without their own server, so use a key made for this.
- **Test** asks the server for its list of sessions (`GET /api/sessions`, from the WAHA sessions documentation) with the saved address and key, and says whether it answered and accepted the key.

Which server a call goes to: the person's own address and key in the plugin settings come first; then the administrator's address and key; then the built-in address with no key. The administrator's key is only ever sent to the administrator's address (or the built-in one), never to a server a person typed. On this shared server each person gets a session named after their own user id. A change in Studio applies at the next call, with no restart. These settings are for people only: the Chief and other bots cannot read or change the key (see `docs/decisions/bot-parity.md`).

## Instant incoming messages (push)

Without this, a bot that answers WhatsApp messages reads WAHA every minute. With it, WAHA tells Zetta when a message arrives and the bot starts in a few seconds. There is no server setting: each user saves it in their own WhatsApp plugin settings.

1. In Studio > Plugins > WhatsApp > Advanced settings, set **Zetta address for WAHA** to the address at which the **WAHA container** reaches Zetta: plain `http`, no path (for example `http://host.docker.internal:3000`; Podman: `http://host.containers.internal:3000`). A local `https` address with a mkcert certificate does not work, because the container does not trust that CA.
2. When the user saves this and turns on incoming messages for a bot, Zetta creates a random signing key for that user (kept sealed in the plugin settings, never shown) and registers a webhook on their WAHA session (`message` event, signed with HMAC-SHA512). If the session is not paired yet, the first poll after pairing does it. WAHA restarts the session once to apply it. With the session storage set up above, it reconnects with the stored login, so no new QR code should be needed.
3. From then on polling only runs every 15 minutes, as a safety net for a push that was lost while Zetta was down.

A bot can set this up in the chat. Ask it to turn on instant WhatsApp messages: it reads the state and shows a card with the exact change (the address, and which chats it answers). Nothing is saved until you press **Apply**; Apply uses your own session. A bot can propose only the settings the plugin allows (the address and the time format), never the API key, the WAHA address or sending.

The webhook is only a doorbell: Zetta never reads message text from it. A valid call makes Zetta read that user's chats the normal way, so filters, limits and the untrusted-data wrapping stay the same. Other webhooks you set on a session are kept. Removing the plugin settings or the address stops push; the old webhook on WAHA then calls a route that no longer accepts it, so delete it in WAHA if you want it gone.
