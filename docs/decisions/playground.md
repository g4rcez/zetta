# Playground (REPL)

Status: accepted design, 2026-11-05. Intent: [repl-playground](../intent/repl-playground.md). Phase status is at the end of this file.

## Design

### Data (`packages/db/src/schema/playground.ts`, export in `schema/index.ts`)

Follow `schema/skills.ts`: `zetta.table`, `uuidv7()` ids, `restrict` FKs, string enums, `version` for optimistic concurrency, `check()` for path rules.

- `playground`: `id`, `ownerUserId`, `title`, `language` enum `typescript|javascript|python|bash|html`, `runner` enum `host|container|browser`, `entry` (path), `inputs` jsonb `InputSpec[]` (`{ name, label?, type: "string"|"number"|"boolean"|"json", default? }`), `visibility` enum `private|team`, `status` enum `active|archived`, `createdByBotId` (nullable, set null), `conversationId` (nullable, set null), `version`, `createdAt`, `updatedAt`. Index on owner.
- `playground_file`: PK `(playground_id, path)`, `content text`, `size int`. Copy the path `check()` from `skill_file` (no absolute path, no `..`, max 300).
- `playground_run`: `id`, `playgroundId`, `actorUserId`, `botId?`, `runner`, `status` enum `running|ok|failed|timeout|cancelled|interrupted`, `runtimeVersion`, `files` jsonb snapshot, `inputs` jsonb values, `exitCode?`, `stdout`, `stderr`, `output` enum `complete|truncated`, `durationMs?`, `startedAt`, `finishedAt?`.
- `playground_run_output`: PK `(run_id, path)`, `content bytea`, `mimeType`, `size`.
- The DB check limits a cell to its own row. App limits: at most 50 files, 1 MB of source in total, 64 KB per stream, 5 MB of `out/` per run, and the last 20 runs per playground (prune old runs in app code after each insert).
- Generate the migration with the drizzle recipe (`--hints` in a copy, test on scratch, then migrate dev). Add the tables to `apps/server/src/test-support/db-cleanup.ts`.

### Language map (`apps/server/src/modules/playground/languages.ts`)

One constant, `language → { exts, runners, host: { bin, args(entry) }, image, versionArgs }`:

- typescript/javascript: `bun run <entry>`, image `oven/bun:1.3.14` (already used by RFC-002), runners host|container|browser
- python: `python3 <entry>`, image `python:3.13-slim`, runners host|container
- bash: `bash <entry>`, image `debian:trixie-slim`, runners host|container
- html: runners browser only

`GET /api/playgrounds/languages` returns each language with availability per runner: host bin found (`Bun.which`), container engine found (`engineOf` in `modules/container-user.ts`), and the runtime version (cached).

### Runners (`modules/playground/runner-*.ts`, one interface `run(spec, signal) → RunResult`)

- **Host:** write the snapshot to a fresh temp dir (`mkdtemp`), plus `inputs.json`, plus an empty `out/`. Spawn detached in its own process group, with `cwd` = run dir and a clean env (`PATH`, `LANG`, `HOME` = run dir, `ZETTA_INPUTS` = JSON). Read stdout and stderr with a tail cap. On timeout (default 30 s, max 120 s) or abort, kill the group. Then collect `out/` up to the cap and remove the dir. Reuse `readTail` and `CLEAN_ENV` from `computer/machine-runner.ts` and `killGroup` from `chat/harness.ts`; export them where needed, do not copy them. This is not a sandbox: it runs as the server user, the same as bot Bash.
- **Container:** start one container per language on first use, `zetta-playground-<language>`. Use `-d`, a hardened argv like `dockerArgs` (`chat/harness.ts:587`: `--cap-drop=ALL`, `no-new-privileges`, pids/mem/cpu limits, `--user containerUser()`), network on, and the host runs root bind-mounted at `/runs`. Each run writes its dir under the runs root, then `exec -w /runs/<id> <name> timeout -s KILL <s> <cmd>`, so the in-container `timeout` owns the kill. Sweep `name=zetta-playground-` at boot, as `computer/service.ts:563` does. Runs that share a language container are not isolated from each other (accepted).
- **Browser:** the server does not execute. `POST /api/playgrounds/:id/build` takes `{ files?, inputs }` (a draft, so unsaved edits render). It writes the files to a temp dir and runs `Bun.build` (HTML or TS/JS entrypoint, target browser). It inlines the result into one HTML document and injects `window.ZETTA_INPUTS` and a console-capture script that `postMessage`s logs to the parent. The web shows it in an `<iframe srcDoc sandbox={ARTIFACT_HTML_SANDBOX} csp={ARTIFACT_HTML_CSP}>` (`packages/core/src/artifact-csp.ts`). No in-browser transpiler and no new dependency.
- **Concurrency:** reuse `createLimiter` (`chat/harness.ts:707`): per user 2, global 4. Busy returns 429 `BUSY`.
- **Run lifecycle:** `POST /runs` inserts `running`, runs in the background and returns the run id. On finish it updates the row, audits `tool_call` with `detail: "playground:run"` and outcome ok/failed/timeout/cancelled (`features/audit.ts`), and publishes `topics.playground(id)` to the owner and the actor. Cancel aborts an in-process `AbortController` map. At boot, runs still `running` become `interrupted`.

### Service and routes (`modules/playground/{service,routes}.ts`)

- The service owns all Drizzle access and throws `PlaygroundError` with codes `NOT_FOUND|FORBIDDEN|CONFLICT|INVALID|TOO_LARGE|BUSY|UNAVAILABLE`. Access rules: read/run/fork = owner, or `visibility = 'team'` (the bot `visibility` pattern, `chat/service.ts:3896`). Edit/archive = owner (`requireOwned`).
- Routes use `createGuardedRoute` (`modules/http-response.ts:35`) and Zod in the handler:
  - `GET /api/playgrounds?scope=mine|team&q=`, `POST /api/playgrounds`, `GET|PATCH|DELETE /api/playgrounds/:id` (PATCH carries `expectedVersion`, files replace all, DELETE archives), `POST /api/playgrounds/:id/fork`
  - `POST /api/playgrounds/:id/runs` `{ inputs }` (runs the saved files), `GET /api/playgrounds/:id/runs`, `GET /api/playground-runs/:runId`, `POST /api/playground-runs/:runId/cancel`, `GET /api/playground-runs/:runId/outputs/*` (raw file, with the artifact CSP header for HTML)
  - `POST /api/playgrounds/:id/build`, `GET /api/playgrounds/languages`
- Wiring: `services.ts` builds it, `index.ts` passes it, `app.ts` gets the optional field and `.use(...)`, and the boot sweep and interrupt go in `index.ts` inside `runsWork`. Add `playground(id)` to `packages/core/src/live-topics.ts`.

### Bot tool (`chat/tools.ts`, `chat/service.ts`)

- Add a `zetta:playground` fence with a discriminated `action`:
  - `create {title, language, runner?, entry?, files[], inputs?}`
  - `edit {id, …partial, files?}`
  - `run {id, inputs?}`: waits up to the run timeout, returns status, exit code, the stdout/stderr tail (≈4 KB) and the `out/` names
  - `get {id, runId?}`
- Changes:
  - add a schema in `toolSchemas`
  - add the name to the fence regex at `tools.ts:598`
  - add a prompt snippet to `toolPreamble`
  - add a branch in `runTools`
  - add `create`/`edit` to `PERSISTENT_WRITES`/`defersWrite`, so they wait for an Approve card after outside content
  - treat `run` and `get` as reads, the same as bot Bash under the current permission model
- The owner is `actor.userId`. Set `createdByBotId = who.id` and `conversationId`.
- Receipt `{ kind: "playground", id, text: title, created }` in the server `Receipt` union (`service.ts:305`).

### Web (`apps/web/src/features/playground/`)

- **Routes:** `routes/_auth/playground.tsx` (list) and `routes/_auth/playground_.$id.tsx` (detail). Pages take `search`/`setSearch` props. The parsers are pure (`playground-search.ts`, like `skills/skills-search.ts`):
  - list: `q`, `scope` (`mine|team`)
  - detail: `file` (the open tab), `run` (the selected history entry)
- **Nav:**
  - add the entry last in `components/app-links.ts`
  - add the label to the "More" list in `components/app-sidebar.tsx`
  - add `"/playground"` to `APP_PREFIXES` in `components/header.tsx`
- **`playground-api.ts`:** `call` from `chat/chat-client.ts`, `queryOptions` keys under `["playground", …]`, and a `keysFor` entry in `lib/live-events.ts`.
- **Detail page:**
  - file tabs (add, rename, delete) and the entry marker
  - language and runner selects, filtered by `/languages` availability
  - an inputs form: `Input` for string/number and a switch for boolean are allowed as structured fields; JSON uses a plain `Editor`
  - Run and Cancel
  - an output panel: stdout/stderr, `out/` files (HTML in the sandboxed iframe, images, text), and the browser console for browser runs
  - run history with a "load this run's files" view
  - visibility toggle and Fork
  - Save uses `expectedVersion`; Run saves first
- **Editor:** add one `language?: string` prop to `components/editor/editor.tsx`. When it is set, a new Compartment loads `LanguageDescription.matchLanguageName(languages, …)` from `@codemirror/language-data` (already a dependency) in place of the markdown extensions and keymap. Without the prop, nothing changes. Code editors carry `// Plain on purpose: source code, not natural language` (required by `src/free-text.test.ts`).
- **Chat:**
  - add `"playground"` to the `Receipt` union in `chat-client.ts`
  - add a `<Link to="/playground/$id">` branch in `message-row.tsx`
  - add `"playground"` to `KINDS` in `chat/tool-fences.ts`

## Phases (one checkpoint per phase; a fresh session per phase if context grows)

0. **Docs:** save the intent to `docs/intent/repl-playground.md` and this spec to `docs/decisions/playground.md`.
1. **Data + service + host runner + routes:**
   - schema and migration (applied to dev)
   - service
   - host runner
   - language map
   - routes
   - `/languages`
   - boot interrupt
   - integration tests (real DB): create/edit/run a bun and a python script on the host; `out/` capture; timeout; team read vs private 404; non-owner edit refused
2. **Container runner:** per-language container lifecycle, exec with timeout, and a boot sweep. Gated test on podman (see the memory recipe for gated container tests).
3. **Browser build:** the `/build` endpoint with `Bun.build`, input and console injection. A test for an HTML + TS multi-file build.
4. **Web:**
   - Editor `language` prop
   - list and detail pages
   - nav
   - live topic
   - page tests that mount with search values (`skills-page.test.tsx` pattern)
   - iframe console capture
5. **Bot tool:** the `zetta:playground` fence, receipt, preamble and deferral rules. Tool tests in the existing tools test style. Then a real chat check: a bot creates and runs a Python report and posts the link.

## Verification

- **Server:** `bun test` on the new playground test files only, with `ZETTA_CHAT_TEST_DATABASE_URL` on the scratch DB (see memory: stale zetta_test). Then `tsc` for server, web, db and core.
- **Web:** `bun test src/features/playground src/free-text.test.ts src/in-app-links.test.ts src/components/editor`.
- **End to end:** run the dev stack, open `/playground` (Playwright MCP):
  - create a TS playground and run it on the host
  - switch it to the container runner and run it again
  - create an HTML + TS playground with the browser runner and check that the console shows output
  - change an input and run again; history shows both runs with their snapshots
  - share it with the team and open it as a second user (read + run, no edit)
- **Bot:** in chat, ask a bot for a small report. Check the receipt link, the run history entry and the rendered `out/report.html`.
- `oxfmt --check` on changed files only (never prettier); run the public-repo hygiene grep from CLAUDE.md on changed paths.

## Risks

- Host runner = arbitrary code as the server user, with access to server files. It follows the same switch as bot Bash: with `ZETTA_CODE_ACCESS=off` (set by the operator, or automatically when the install is open to the network without the Docker runtime) a host run is refused and only the container and browser runners work. Not safe for the hosted SaaS mode. The SaaS runner is later work, per `docs/decisions/execution-isolation.md`.
- Shared language containers: runs can see each other's `/runs` dirs and processes. Network is on.
- In-process cancel map: a cancel that reaches another API instance cannot abort the run (horizontal scaling). It returns `CONFLICT`, and the boot interrupt covers crashes.
- Container images must be pulled once; the first run is slow, or `UNAVAILABLE` with no engine.

## Status

- Phase 0 (docs): done.
- Phase 1 (data, service, host runner, routes): done 2026-11-05. Migration `20261105212238_playground` applied to dev. `modules/playground/` has `languages`, `runner-host`, `service`, `routes`, and an integration test (8 tests, real DB, real bun/python3/bash). The service takes `runners` in its deps, so the container runner plugs in without changes to callers.
- Phase 2 (container runner): done 2026-11-05. `runner-container.ts`; on when `ZETTA_DOCKER_BIN` (default `docker`) exists. One container per CLI (`bun` serves typescript and javascript), `exec` per run with `timeout -s KILL` inside, cancel kills the process group through a pid file. Config: `ZETTA_PLAYGROUND_DIR` (default `~/.zetta/playground`, must be under a folder the Podman machine shares), `_MEMORY`, `_CPUS`, `_PIDS`, `_NETWORK` (`none` closes the network), `ZETTA_PLAYGROUND_IMAGE_<BIN>`. Boot sweep removes the containers and `r-*` run folders. Verified live on Podman with bash on `ubuntu:24.04` (8 tests, `ZETTA_DOCKER_TEST=1`, see the Podman shim recipe in the project notes). **Not run yet:** the `bun` and `python` images (never pulled here).
- Phase 3 (browser build): done 2026-11-05. `POST /api/playgrounds/:id/build` -> `{ html }`. `build-browser.ts` bundles with `Bun.build` in a temp folder; a resolver plugin keeps imports inside the playground, lets `https://` imports through as URLs, refuses bare packages and macros. The page gets `window.ZETTA_INPUTS` and a console/error relay (`postMessage` with `source: "zetta-playground"`).
- Phase 4 (web): done 2026-11-05. `features/playground/` (list page, detail page, API client, URL-state parsers, input helpers), routes `/playground` and `/playground/$id`, nav entry under More, live topic `playground:<id>`. The `Editor` got one optional `language` prop (code mode: no Markdown helps, language loaded on demand). Tests mount the pages with a search value and no clicks. **Done after:** renaming a file in the editor (`files.ts`, tested as a pure function; imports in other files are not updated). **Not done:** a check in a real browser (layout, gutter colours, the iframe console relay): only DOM tests ran.
- Phase 5 (bot tool): done 2026-11-05. `zetta:playground` with `create|edit|run|get|list`, a `playground` receipt (link in chat), a prompt snippet in the tool preamble for every bot. Rules: a `run` on `host` or `container` needs code access (as a bot's own Bash does); a `browser` playground is run by the person. After outside content `create`, `edit` and `run` wait for one Approve card (`bot_action`), and an inbound (outside people) turn drops them. A run's output returns to the bot framed as untrusted data (last 3500 characters of each stream). Not in `/api/mcp`.
- Docs with examples: [operations/playground](../operations/playground.md). Linked from the README.
