# Desktop app

Status: accepted design, 2026-11-09. Phase 1 is built (see "Phase status" at the end). Mobile (Android, iOS) is on the roadmap; what it shares is listed at the end.

## Decisions

1. **The app is a client of any Zetta server, and can also run one.** It remembers several servers (self-hosted, LAN, hosted). A later phase adds "Run Zetta on this computer": a bundled server and database, supervised by the app. Everything a bot does (commands, CLIs, the browser) still happens on the machine that runs the server; the desktop app does not change that. Reaching the user's own computer from a remote server is the companion (phase 5).
2. **Each server window loads that server's own web UI.** `VITE_SERVER_URL` is inlined when the web app is built and 11 web files read it, so a copy of `apps/web` inside the app could only ever talk to one server and could not follow that server's version. Loading the server's page gives first-party cookies and the same OAuth and `window.location` behaviour as a browser. The only bundled page is the **launcher** (`views://launcher`): the server list, "add a server" and errors.
3. **Electrobun with the Bun main process.** The scaffold used the experimental Cottontail main process. The app needs Bun's own APIs (`Bun.listen`, `Bun.spawn` for the local server and the companion, a WebSocket with auth headers), so `build.mainProcess` is `"bun"`.
4. **Adding a server is checked.** `discoverServer` (`apps/desktop/src/bun/discovery.ts`) asks `<address>/api/meta`, or `<address>/.well-known/zetta.json` for a web UI served on its own, then the API it names. The address that was typed must be one of the two origins the server reports, so a server cannot send the app to another site while the person believes they added the one they typed. `/api/meta` is public and holds only those two origins and a protocol number (`packages/core/src/server-meta.ts`); never add a version, build id or installation detail to it.
5. **Links.** Inside a server window, the server's own origins stay inside; other http(s) sites and `mailto:` open in the system browser; every other scheme (`javascript:`, `file:`, `views:`, `data:`, `blob:`) opens nowhere (`navigation.ts`). A same-origin popup (the computer viewer) opens a second window of that server.
6. **Closing the window keeps the app running** in the tray. Quit is in the tray menu and the application menu. One instance runs per user (`single-instance.ts`): a loopback socket plus an exclusive, private lock file; a later launch hands over its arguments and exits.

## Findings from the spike (2026-11-09, Electrobun 2.0.4, CEF, macOS arm64)

Tested by building the app, adding two fake servers through the launcher and driving it over CEF's debugging port.

- **A named `persist:` partition does not work.** `new BrowserView({ partition: "persist:<name>" })` logs `CreateBrowserSync returned null` and the page never loads (two different names tried). An ephemeral partition loads but would sign people out on every launch. So server windows use the default persistent profile. A cookie with a `Max-Age` survived a hard kill and relaunch (after Chromium's own flush interval, about 30 seconds; a sign-in made seconds before a crash can be lost).
  **Consequence:** cookies are kept per host, not per port. Two servers on one host (for example the dev server and a local server, both `localhost`) share a cookie jar, and every Zetta server uses the same session cookie name, so signing in to one signs the other out. The launcher warns when a new server shares a host with one it already has. Give a local server `127.0.0.1` when `localhost` is taken.
- **A sandboxed window has no bridge**: `window.__electrobun` and `__electrobunSendToHost` are `undefined` in the page, as intended for phase 1.
- The page's own `fetch` works from the server's origin, and the server sees that `Origin`. A second launch exits and leaves one process running. CEF reported "Opening in existing browser session" before the app's own code ran, so on macOS the lock in `single-instance.ts` was exercised only by its unit tests, not by a real second launch. Whether Electrobun passes a second launch's arguments to the first instance on Windows and Linux is unknown (needed for phase 3).
- A top-level `const status` in the launcher's classic script is `window.status` and silently swallowed every message. The launcher uses `note`.
- Not verified: Windows and Linux (CI builds them; nothing has been run there), `will-close` hiding the window, the tray menu, the macOS application menu, and `history.back()` after an external navigation (Electrobun cannot cancel a navigation from the main process).

## Phase status

Phases:

1. **Shell foundation: built.** Launcher, registry (`servers.json` in the user-data folder, a file that cannot be read is moved aside, never overwritten), discovery, windows, tray, single instance, `GET /api/meta`, `/.well-known/zetta.json` from the web build, CI that builds unsigned artifacts for four targets (`.github/workflows/desktop.yml`, first run pending).
2. Native bridge, notifications, tray unread count: not started. The design is in the plan: server windows stay sandboxed; a preload defines `window.zettaNative` only for the main frame of the server's origin and holds a per-window secret, because bot-made HTML runs in iframes of the same webview and Electrobun tags RPC messages with a webview, not a frame.
3. Deep links (`zetta://`) and OAuth return through the system browser: not started. `urlSchemes` is not in the config yet on purpose; macOS registers the scheme only for an app in `/Applications`, and nothing handles it.
4. Device pairing, Devices page, notifications with no window open: not started.
5. Companion (the server drives this computer): not started.
6. Run Zetta on this computer: not started.
7. Windows and Linux companion runtime: not started.

Run it with `bun run dev:desktop` (`apps/desktop/scripts/dev.ts`): the server on `:6000`, the web dev server on `https://localhost:3000` (with the `.certs` mkcert pair when present) and the app, which opens that address as "Dev server". It starts nothing else (no landing page) and no database container: with an empty `DATABASE_URL` the server runs the [embedded Postgres](embedded-postgres.md). Stopping it stops all three process trees.

Still missing for a release: a macOS icon (`icon.iconset`; the build warns), Windows and Linux icons, code signing and notarization, auto-update.

## Mobile

Shared with desktop: server discovery and the registry format, `/api/meta`, device tokens and pairing (phase 4), the `packages/core` contracts, the web `native` adapter (phase 2), `zetta://` links. Not shared: Electrobun, the tray, the local server, the companion runtimes.
