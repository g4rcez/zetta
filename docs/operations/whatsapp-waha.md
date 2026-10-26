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
2. A localhost/private WAHA is blocked by the same SSRF policy as MCP servers; the administrator must enable private networks (`allowPrivate`).
3. Use **Pair** on the installed plugin and scan the QR code in WhatsApp > Linked devices.
4. Sending is off. Set `Allow sending` to `yes` (optionally with a send allowlist) to let bots message; sends are capped at 1000 characters, 5/minute and 30/hour.
5. Incoming message text is untrusted data and is sanitised and truncated before bots see it.

> A WAHA container on localhost or a private network is reachable only when the server runs with `ZETTA_ALLOW_PRIVATE_NETWORK=1` (it also relaxes the same check for MCP servers).
