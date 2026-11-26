# Settings reference

Generated from `apps/server/.env.schema` by `bun run settings:doc` in `apps/server`. Do not edit it by hand: change the schema and run the
command again. A test fails when this page is out of date.

Set them in `apps/server/.env` (one `NAME=value` per line). With the Docker install, `install.sh` writes the first ones for you and
`docker compose` reads that file. Restart the server after changing one.

## Required

### `NODE_ENV`

Required · not secret

The mode the server runs in: development, production or test. The Docker image sets production; leave it alone on a normal install.

### `BETTER_AUTH_SECRET`

Required · secret: kept encrypted or out of logs, never shown

The secret the sign-in system signs sessions with: at least 32 random characters (`openssl rand -base64 32`). Keep it private. Changing it signs everyone out.

### `ZETTA_SERVER_URL`

Required · not secret

The one public address of Zetta, scheme and host (and port) with no path: the web app and the API answer on it, the browser calls /api on it, and it is the origin Better Auth, CORS, OAuth callbacks and MCP use. Set the same value in apps/web/.env. MCP clients sign in with OAuth, which needs HTTPS off loopback: use the public https:// address, whoever terminates TLS.

### `ZETTA_CONNECTION_KEY`

Required · secret: kept encrypted or out of logs, never shown

Encryption key for stored secrets and proof of ownership at first-run onboarding: base64 of 32 random bytes (`openssl rand -base64 32`).

## Optional

### `DATABASE_URL`

Optional · secret: kept encrypted or out of logs, never shown

Postgres connection string. Leave it empty to use the Postgres that ships inside Zetta: it is unpacked into ZETTA_HOME, started with the server and migrated at boot. Set it to use your own Postgres 18 with the vector and unaccent extensions.

### `ZETTA_HOME`

Optional · not secret

Folder for Zetta's local state, including the embedded database (default ~/.zetta). When it is set, the installation is isolated: files, artifacts, code, caches and container names all live under (or carry a tag of) this folder, and nothing is read from or written to ~/.zetta.

### `ZETTA_PG_ARCHIVE`, `ZETTA_MIGRATIONS_DIR`

Optional · not secret

Where a packaged install keeps the Postgres runtime archive and the SQL migrations, when they are not at their checkout locations. The desktop app sets both. Leave them empty in a checkout.

### `ZETTA_DESKTOP_LINK_TOKEN`

Optional · secret: kept encrypted or out of logs, never shown

The secret the desktop app that runs this server shares with it (at least 32 characters). With it set, the app can link this server to the owner's other Zetta server through /api/desktop/remotes, from this computer only. Leave it empty on any other install.

### `ZETTA_WEB_DIST`

Optional · not secret

A built web app (apps/web/dist) for the server to serve at its own address, next to /api. Leave it empty when a web server such as the Docker install's nginx serves the UI. The desktop app sets it for the server it runs.

### `ZETTA_SETUP_KEY`

Optional · secret: kept encrypted or out of logs, never shown

One-time key typed in the browser at first-run onboarding. Use a value different from ZETTA_CONNECTION_KEY (`openssl rand -base64 32`): the connection key then never leaves the server. When unset, onboarding asks for ZETTA_CONNECTION_KEY.

### `ZETTA_COOKIE_SAMESITE`

Optional · not secret

Session cookie SameSite: none (default, the desktop app needs it), lax or strict. A web-only install should use lax.

### `ZETTA_TRUSTED_IP_HEADER`

Optional · not secret

Header your reverse proxy sets with the real client address (for example x-forwarded-for or cf-connecting-ip); sign-in rate limits count per that address. Unset: the socket address is used. Only set it when the proxy always overwrites or appends the header.

### `ZETTA_EXTRA_ORIGINS`

Optional · not secret

Extra origins allowed to sign in and call the API, comma-separated, https only. Every address of this machine (localhost, LAN, Tailscale) and ZETTA_SERVER_URL are trusted already: use this only for a host name (a MagicDNS name, a reverse proxy) that is not an interface address. Each one is added to Better Auth's trusted origins and to CORS. Restart the server after changing it.

### `ZETTA_HOST`

Optional · not secret

Listen address override. Default: 127.0.0.1, or 0.0.0.0 once onboarding opened Zetta to the network. Containers set 0.0.0.0.

### `ZETTA_TLS_CERT`, `ZETTA_TLS_KEY`

Optional · not secret

HTTPS served by the API itself: PEM certificate and private key paths (relative to apps/server). Set both or neither. Leave unset in local development: the web dev server is the HTTPS entry point and forwards /api to the API over plain HTTP (PORT=6000). MCP clients sign in with OAuth, which needs HTTPS off loopback: ZETTA_SERVER_URL must be the public https:// address, whoever terminates TLS.

### `NODE_EXTRA_CA_CERTS`

Optional · not secret

Extra root certificate Bun trusts, for a local CA such as mkcert's (`bun run certs` copies it to .certs/rootCA.pem), when the server calls an HTTPS service signed by it. Bun reads it only at process start: `bun dev` passes it from here, other launchers must export it.

### `ZETTA_DB_POOL_MAX`

Optional · not secret

Max connections in the app's Postgres pool (default 20). Keep the sum over all server instances below Postgres's max_connections.

### `ZETTA_BUILD_COMMIT`, `ZETTA_BUILD_DATE`

Optional · not secret

Which version this server is: the commit it was built from and that commit's date (ISO 8601). install.sh stamps them into the image; a source checkout leaves them empty and the server asks git. Studio shows them, and the update check compares the date with the published changelog.

### `ZETTA_UPDATE_CHECK`, `ZETTA_UPDATE_FEED`

Optional · not secret

The daily "newer version" check (docs/operations/upgrade.md). ZETTA_UPDATE_CHECK=off turns it off for the whole server and wins over the setting in Studio > Server settings. ZETTA_UPDATE_FEED replaces the changelog address (https; a private network needs the setting allowPrivateNetwork).

### `ZETTA_DESKTOP_RUNTIME`

Optional · not secret

Per-user Linux desktops ("VMs"): `docker` runs docker/desktop per VM.

### `ZETTA_VM_IMAGE_UBUNTU`

Optional · not secret

The image of an Ubuntu desktop (docker/desktop, see its Dockerfile; it must be built before Ubuntu computers can be offered). Default: zetta-desktop-ubuntu:latest.

### `ZETTA_VM_IMAGE`

Optional · not secret

Desktop VM image and limits (defaults: zetta-desktop:latest, 2g, 2 cpus; 4 VMs and 2 running per user, 6 running in total). ZETTA_VM_RUNTIME=runsc uses gVisor; ZETTA_VM_NETWORK attaches VMs to a network with host-level egress rules.

### `ZETTA_DOCKER_BIN`, `ZETTA_VM_MEMORY`, `ZETTA_VM_CPUS`, `ZETTA_VM_RUNTIME`, `ZETTA_VM_NETWORK`

Optional · not secret

Container CLI for VMs (default docker); e.g. /opt/podman/bin/podman.

### `ZETTA_AGENT_BROWSER_BIN`

Optional · secret: kept encrypted or out of logs, never shown

Path to the agent-browser binary that drives host-mode browser sessions. Default: node_modules/.bin/agent-browser, then PATH. Needed when the server runs as a compiled binary. Browser containers (ZETTA_BROWSER_RUNTIME=docker) have no network of their own: they reach the internet only through the server's egress proxy.

### `ZETTA_CODE_ROOT`

Optional · not secret

Code access for bots: where each user's persistent code directory lives (default ~/.zetta/code). Docker harness runs mount the code directory at /work. Bot runs have no time limit; only Stop ends them.

### `ZETTA_HARNESS_SLOT_MS`

Optional · not secret

How long a bot run holds a concurrency slot (default 120000 ms). The slot limits how many runs start at once, not how long they last.

### `ZETTA_EMBEDDING_MODEL_DIR`

Optional · not secret

Company knowledge: where the local embedding model is cached (default ~/.cache/zetta/models).

### `ZETTA_FILES_ROOT`

Optional · not secret

Where Zetta keeps its files. Everything lives under the server user's home (~/.zetta) except the files store, which is .zetta-files in the server's working folder. In Docker the server's HOME and ZETTA_FILES_ROOT are on the zetta_data volume, so they survive an update. Authorized server files: me/<userId>/ is private, shared/ is readable by the team.

### `ZETTA_ATTACHMENTS_ROOT`

Optional · not secret

Chat attachments (default ~/.zetta/attachments).

### `ZETTA_ARTIFACTS_ROOT`

Optional · not secret

Artifacts that people and bots publish (default ~/.zetta/artifacts).

### `ZETTA_CLAUDE_PLUGIN_ROOT`

Optional · not secret

Claude Code plugins that bots use (default ~/.zetta/claude-plugins).

### `ZETTA_PLAYGROUND_DIR`

Optional · not secret

Playground runs (default ~/.zetta/playground).

### `ZETTA_BROWSER_ROOT`, `ZETTA_VM_TOKEN_ROOT`

Optional · not secret

Browser sessions of bots in host mode (default .zetta-browser in the working folder), and the tokens of desktop VMs (default .zetta-vm).

### `ZETTA_HARNESS_RUNTIME`

Optional · not secret

Where bot turns run. By default the agent CLI (Claude Code, Codex...) runs on the server itself, as the server user, with that user's login. ZETTA_HARNESS_RUNTIME=docker runs every turn in a throwaway, hardened container instead; it needs a container runtime the server can reach.

### `ZETTA_HARNESS_IMAGE`, `ZETTA_HARNESS_CPUS`, `ZETTA_HARNESS_MEMORY`, `ZETTA_HARNESS_PIDS`, `ZETTA_HARNESS_NETWORK`

Optional · not secret

Image of those containers (default zetta-harness:latest, built from docker/harness) and the limits of each one (defaults: 1 cpu, 1g of memory, 256 processes, network bridge).

### `ZETTA_CONTAINER_ENGINE`, `ZETTA_CONTAINER_USER`

Optional · not secret

The container command that runs harness, browser and playground containers. Zetta picks docker or podman itself: set this when its answer is wrong or the binary cannot be run here. ZETTA_CONTAINER_USER is the uid:gid they run as (default: the server user's, or 10001:10001 where there is no uid).

### `ZETTA_HARNESS_HOME_ROOT`

Optional · not secret

Gives every person their own HOME for each agent CLI, so their logins and sessions are not shared. Unset: everyone uses the login of the server user.

### `ZETTA_BROWSER_RUNTIME`, `ZETTA_BROWSER_IMAGE`, `ZETTA_BROWSER_CPUS`, `ZETTA_BROWSER_MEMORY`, `ZETTA_BROWSER_PIDS`, `ZETTA_CHROMIUM_PATH`

Optional · not secret

Bot browsers. ZETTA_BROWSER_RUNTIME=docker runs a bot's browser in a container; it is required once Zetta is open to the network. Image default zetta-browser:latest; limits default to 1 cpu, 1g of memory and 512 processes. ZETTA_CHROMIUM_PATH is the Chromium to use in host mode.

### `ZETTA_PLAYGROUND_CPUS`, `ZETTA_PLAYGROUND_MEMORY`, `ZETTA_PLAYGROUND_PIDS`, `ZETTA_PLAYGROUND_NETWORK`

Optional · not secret

Playground containers: limits default to 2 cpus, 1g of memory and 256 processes. ZETTA_PLAYGROUND_NETWORK=none closes the network.

### `ZETTA_VM_PIDS`, `ZETTA_VM_SHM`

Optional · not secret

Desktop VM limits that ZETTA_VM_MEMORY and ZETTA_VM_CPUS do not cover: processes (default 1024) and shared memory (default 1g).

### `ZETTA_ROLE`, `ZETTA_EVENT_BUS`

Optional · not secret

Several servers on one database (docs/operations/scaling.md). ZETTA_ROLE is what this process does: all (default), api (serves requests, never starts bot turns) or worker. ZETTA_EVENT_BUS is how live updates reach the other servers: local (default for all) or pg (default otherwise).

### `ZETTA_INSTANCE_NAME`

Optional · not secret

The name this server instance goes by; unset: Zetta chooses one.

### `ZETTA_HEARTBEAT_MS`, `ZETTA_INSTANCE_DEAD_AFTER_MS`, `ZETTA_FENCE_AFTER_MS`

Optional · not secret

Timing between server instances, in milliseconds: how often one reports it is alive (default 10000), how long without a report before it is treated as dead (default 90000) and the recovery timing (default 60000). Leave the defaults unless you run several instances and need it.

### `ZETTA_SSE_HEARTBEAT_MS`

Optional · not secret

How often the live-updates stream sends a keep-alive, in milliseconds (default 30000). Lower it when a proxy closes idle streams.

### `ZETTA_ROOM_STUCK_MS`

Optional · not secret

How long a room turn may go without progress before it counts as stuck (default 600000 ms).

### `ZETTA_INTERNAL_URL`

Optional · not secret

The address the server uses to call its own API (default http://127.0.0.1:<PORT>).

### `ZETTA_AUTH_RATE_LIMIT_STORAGE`

Optional · not secret

Sign-in and secrets. ZETTA_AUTH_RATE_LIMIT_STORAGE=database keeps the sign-in rate-limit counters in the database so several servers share them; unset, each server counts on its own.

### `ZETTA_CONNECTION_KEY_ID`

Optional · not secret

The label of the connection key (default v1). Change it only when you rotate the key.

### `ZETTA_OAUTH_REDIRECT_BASE`

Optional · not secret

The base of the return addresses that plugins with OAuth (Google, Reddit...) use. Default: ZETTA_SERVER_URL.

### `ZETTA_LAYA_PRELOAD`

Optional · not secret

Features. ZETTA_LAYA_PRELOAD=0 loads the Laya model on first use instead of at boot.

### `ZETTA_TRANSCRIBE_MODEL_DIR`

Optional · not secret

Where the local speech-to-text model (Whisper) is downloaded to (default ~/.cache/zetta/models; copy the files there to work offline).

### `ZETTA_SPEECH_MODEL_DIR`

Optional · not secret

Where the local text-to-speech model (Kokoro) is downloaded to (default: the speech-to-text model folder; copy the files there to work offline).

### `ZETTA_TEST_GREENMAIL`

Optional · not secret

Test infrastructure only, not a server setting: set to 1 to run the mail tests against a GreenMail container (modules/mail/greenmail-setup.ts).

### `ZETTA_GREENMAIL_IMAGE`

Optional · not secret

Test infrastructure only, not a server setting: the image of that GreenMail container.
