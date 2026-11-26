# Desktop app

Status: accepted design, 2026-11-09. Phase 1 is built (see "Phase status" at the end). Mobile (Android, iOS) is on the roadmap; what it shares is listed at the end.

## Decisions

1. **The app is a client of any Zetta server, and can also run one.** It remembers several servers (self-hosted, LAN, hosted). The app runs its own isolated server ("Run Zetta on this computer", below), supervised by the app. Everything a bot does (commands, CLIs, the browser) still happens on the machine that runs the server; the desktop app does not change that. Reaching the user's own computer from a remote server is the companion (phase 5).
2. **Each server window loads that server's own web UI.** `ZETTA_SERVER_URL` is inlined when the web app is built and 11 web files read it, so a copy of `apps/web` inside the app could only ever talk to one server and could not follow that server's version. Loading the server's page gives first-party cookies and the same OAuth and `window.location` behaviour as a browser. The only bundled page is the **launcher** (`views://launcher`): the server list, "add a server" and errors.
3. **Electrobun with the Bun main process.** The scaffold used the experimental Cottontail main process. The app needs Bun's own APIs (`Bun.listen`, `Bun.spawn` for the local server and the companion, a WebSocket with auth headers), so `build.mainProcess` is `"bun"`.
4. **Adding a server is checked.** `discoverServer` (`apps/desktop/src/bun/discovery.ts`) asks `<address>/api/meta`, or `<address>/.well-known/zetta.json` for a web UI served on its own, then the API it names. The address that was typed must be one of the two origins the server reports, so a server cannot send the app to another site while the person believes they added the one they typed. `/api/meta` is public and holds only those two origins and a protocol number (`packages/core/src/server-meta.ts`); never add a version, build id or installation detail to it.
5. **Links.** Inside a server window, the server's own origins stay inside; other http(s) sites and `mailto:` open in the system browser; every other scheme (`javascript:`, `file:`, `views:`, `data:`, `blob:`) opens nowhere (`navigation.ts`). A same-origin popup (the computer viewer) opens a second window of that server.
6. **Closing the window keeps the app running** in the tray. Quit is in the tray menu and the application menu. One instance runs per user (`single-instance.ts`): a loopback socket plus an exclusive, private lock file; a later launch hands over its arguments and exits.

## Findings from the spike (2026-11-09, Electrobun 2.0.4, CEF, macOS arm64)

Tested by building the app, adding two fake servers through the launcher and driving it over CEF's debugging port.

- **A named `persist:` partition does not work.** `new BrowserView({ partition: "persist:<name>" })` logs `CreateBrowserSync returned null` and the page never loads (two different names tried). An ephemeral partition loads but would sign people out on every launch. So server windows use the default persistent profile. A cookie with a `Max-Age` survived a hard kill and relaunch (after Chromium's own flush interval, about 30 seconds; a sign-in made seconds before a crash can be lost).
  **Consequence:** cookies are kept per host, not per port. Two servers on one host (for example the dev server and a local server, both `localhost`) share a cookie jar, and every Zetta server uses the same session cookie name, so signing in to one signs the other out. The launcher warns when a new server shares a host with one it already has. Give a local server `127.0.0.1` when `localhost` is taken.
- **A sandboxed window has no bridge**: `window.__electrobun` and `__electrobunSendToHost` are `undefined` in the page, as intended for phase 1.
- The page's own `fetch` works from the server's origin, and the server sees that `Origin`. A second launch exits and leaves one process running. CEF reported "Opening in existing browser session" before the app's own code ran, so on macOS a second launch stops before the lock in `single-instance.ts`; unit tests cover the lock. Passing a second launch's arguments to the first instance on Windows and Linux belongs to phase 3.
- A top-level `const status` in the launcher's classic script is `window.status` and silently swallowed every message. The launcher uses `note`.

## Phase status

Phases:

1. **Shell foundation: built.** Launcher, registry (`servers.json` in the user-data folder, a file that cannot be read is moved aside, never overwritten), discovery, windows, tray, single instance, `GET /api/meta`, `/.well-known/zetta.json` from the web build, CI that builds unsigned artifacts for four targets (`.github/workflows/desktop.yml`, first run pending).
2. Native bridge, notifications, tray unread count: not started. The design is in the plan: server windows stay sandboxed; a preload defines `window.zettaNative` only for the main frame of the server's origin and holds a per-window secret, because bot-made HTML runs in iframes of the same webview and Electrobun tags RPC messages with a webview, not a frame.
3. Deep links (`zetta://`) and OAuth return through the system browser: not started for `zetta://`. (The sign-in in phase 4b returns on a loopback address instead.) `urlSchemes` is not in the config yet on purpose; macOS registers the scheme only for an app in `/Applications`, and nothing handles it.
4. **Sign-in to remote servers, and the companion: built (see "Local server, remote servers, companion" below).** Device pairing, the Devices list, work done on this computer for a remote server's bots.
5. Windows and Linux companion runtime: commands use `cmd.exe /c` and `/bin/sh -c`.
6. **Run Zetta on this computer: built** (same section).

## Local server, remote servers, companion (2026-11-19)

The app is a launcher of servers and can be two more things at once: the host of its own isolated server, and a client signed in to the person's remote server whose bots can then reach this computer.

**The local server (`src/bun/local-server.ts`, `local.ts`).** A child process of the app's own Bun runs the built server (`apps/server/dist`) with the web build served from the same address (`ZETTA_WEB_DIST`), the Postgres that ships with Zetta (empty `DATABASE_URL`) and its migrations (`ZETTA_PG_ARCHIVE`, `ZETTA_MIGRATIONS_DIR`).

- _Isolation._ Everything lives under `<userData>/local/home` (`ZETTA_HOME`): with that set, every folder the server writes is inside it (`packages/core/src/zetta-home.ts`, guarded by `apps/server/src/data-paths.test.ts`), container names and VM labels carry an install tag so a boot sweep never touches another install's containers, and the process gets a clean environment (PATH, HOME, USER, locale and the settings below; nothing else of the app's own).
- _Reachability._ Bound to `127.0.0.1` on a port chosen once and kept (the origin keeps its cookies); `ZETTA_COOKIE_SAMESITE=lax` because page and API share one origin; updates, Laya preload and the daily check are off.
- _Secrets._ `BETTER_AUTH_SECRET`, `ZETTA_CONNECTION_KEY`, `ZETTA_SETUP_KEY` and the link token are generated on first run into `secrets.json` (mode 0600) and never replaced (the connection key seals every saved connection). Not in the system keychain yet.
- _First run._ The window opens `/onboarding#key=<setup key>`: the web onboarding takes the key from the fragment (never sent to a server) and the person only chooses a name and password.
- _Supervision._ Restart with backoff (3 times), a start timeout, a pid file so a server left behind by a killed app is stopped at the next start (checked against its command line), logs in `local/logs/server.log` (5 MB cap), status and Start/Stop/Log in the launcher. `ZETTA_DESKTOP_LOCAL=off` turns it off.
- _Packaging._ `scripts/prepare-resources.ts` stages `.resources` (built server, the packages it still imports by name, web build, the Postgres archive for the platform, `migrations.json`; about 160 MB on macOS arm64) and `electrobun.config.ts` copies it into the app. `@huggingface/transformers` (embeddings, transcription) and `agent-browser` are not shipped; Laya loads `onnxruntime-node` only when it is used (it made the built server fail at import before).

**Signing in to a remote server (`oauth.ts`, `remote-link.ts`, `token-store.ts`).** OAuth 2.1 with PKCE in the system browser; the answer returns to a one-shot listener on `127.0.0.1`. The app is identified by a client id metadata document (`apps/landing/public/oauth/zetta-desktop.json`, to be served at `https://zettabot.app/oauth/zetta-desktop.json`; a test checks it against the server's own validator). Endpoints come from the server's `/.well-known` metadata and must be on its own origins. Scopes: `openid offline_access mcp:read mcp:write`. Tokens are kept in `remote-tokens.json` (0600) and renewed a minute before they end. On macOS the file holds only ciphertext (AES-256-GCM) sealed with a key kept in the Keychain (`secret-box.ts`, verified against the real Keychain); where the Keychain is missing or refuses, it stays a private plain file. `secrets.json` of the local server is still a plain 0600 file.

**Local uses remote (`apps/server/src/modules/desktop-link`).** The app pushes the current access token to its own server (`PUT /api/desktop/remotes`, loopback only, guarded by the link token), which seals it as a connection and lists the remote as an MCP server (`Zetta: <host>`) for the owner's bots. _Deviation from the first plan:_ the app refreshes the tokens, not the local server, because the local server only runs while the app does.

**Remote reaches this computer (`apps/server/src/modules/devices`, `src/bun/companion/`).**

- _Pairing._ Turning on "Share this computer" for a signed-in server calls `POST /api/devices` with the access token (scope `mcp:write`); the server stores only the SHA-256 of the credential it returns once. Tables `device` and `device_bot` (which bots may use a device).
- _Connection._ The app opens `wss://<server>/api/devices/connect` with the credential and keeps it up (keep-alive, backoff); the server sends requests, nothing on this computer is reachable from outside. A revoked device is dropped at once.
- _Use._ A device answers to the bot's existing `zetta:machine` call by name (`run`, `list`; no file transfer), so sharing, prompt text, audit and the delete/root/mail rule are the machine pipeline's.
- _Approval is here, not on the server._ The app checks every request itself: a bot nobody allowed asks first, "Always for this bot" is kept per server and bot, deletes/root/mail (`guardedWords`) always ask and can only be allowed once, no answer in two minutes is a refusal, and Pause (launcher and tray) refuses everything and drops the connections. Output is capped at 64 KB, commands run in the home folder with a time limit and a minimal environment.

Run it with `bun run dev:desktop` (`apps/desktop/scripts/dev.ts`): the server on `:6000`, the web dev server on `https://localhost:3000` (with the `.certs` mkcert pair when present) and the app, which opens that address as "Dev server". It starts nothing else (no landing page) and no database container: with an empty `DATABASE_URL` the server runs the [embedded Postgres](embedded-postgres.md). Stopping it stops all three process trees.

Still missing for a release: a macOS icon (`icon.iconset`; the build warns), Windows and Linux icons, code signing and notarization, auto-update.

## Mobile

Shared with desktop: server discovery and the registry format, `/api/meta`, device tokens and pairing (phase 4), the `packages/core` contracts, the web `native` adapter (phase 2), `zetta://` links. Not shared: Electrobun, the tray, the local server, the companion runtimes.
