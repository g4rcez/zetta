# Zetta Apps: tools, accounts, triggers and workflows built into the harness

Status (2026-11-08): design accepted. Phase 0 (retire the first attempt, generalize the approval card) and Phase 1 (apps core) are built and tested; phases 2 to 6 are open. User guide: [operations/apps](../operations/apps.md). This is the second part of Zetta Apps; the first part is the [Playground](playground.md).

## Why

We want Zetta to be a gateway to **skills, apps, triggers (routines, improved) and workflows (n8n-inspired)**, built on Zetta's own runners, connections, approval cards and engines, with no other service in the middle.

## Shape of an app

- An **app** is code that declares typed **tools**: a `query` (read) or a `mutation` (write), each with an input schema and an optional **approval** policy (`always`, `never`, or a condition on the input). Apps also declare the **accounts** they need, small storage, and ship skills. Every publish is an immutable **version** that can be rolled back.
- **Accounts** are saved apart from the code. The bot never sees a credential; the server attaches it at call time. One account can serve several apps. An account is the person's own (`user`) or shared by the app (`app`).
- A bot talks to a **fixed set of tools** whatever apps exist: search, describe, call, and (later) run a short program that chains tools in a sandbox with no network, files or imports.
- A tool that needs approval **stops the call**; the person answers; only then does it run. Declining makes the call fail with a clear reason.
- Nothing in the catalogue says whether a tool reads or writes: the kind is known only to the app, so Zetta decides the policy itself.
- Triggers and workflows that wait for a person or an event are the gap n8n fills.

## Decisions

1. **An app is published code.** Edit in the Playground (bots keep using `zetta:playground`); **Publish** creates an immutable `app_version` (files snapshot + manifest). Draft vs published, rollback, and "promote a playground to an app" come from this.
2. **Tools are declared in code** with a small SDK Zetta ships (`defineApp`, `query`, `mutation`, schema helpers that produce JSON Schema). The manifest is extracted by running the app in `describe` mode at publish time; the same SDK validates at call time. TypeScript and JavaScript only at first.
3. **A call runs in the existing runners** (host, or container when available). The payload (tool, input, accounts, storage snapshot) goes on **stdin**, never argv or environment; the result comes back as `result.json`.
4. **Approval happens before execution.** Effective policy = the owner's override (`block`, `ask`, `auto`) > the tool's declared `approval` > the default by kind (query: never, mutation: always). Asking creates a card; approving runs the stored call. There is no paused program on the server.
5. **Accounts** are sealed `connection` rows (provider `app-account`, a typed JSON secret) linked to an app requirement, per user or shared. A generic OAuth2 helper is extracted from the Google plugin. A missing link gives `NEEDS_ACCOUNT` and a connect card; secrets go through the sealed form, never chat.
6. **Storage** is declared collections of small JSON records, delivered as a bounded snapshot and written back in one transaction after the tool returns valid output.
7. **Code mode** runs bot-written programs in a QuickJS sandbox with host functions for tools (to be confirmed by a spike under Bun).
8. **Triggers and workflows stay in Zetta's engine, upgraded**: cron, filters, tool polling, chaining, an event log with test and replay; durable workflows with a step table, a lease, resume after a restart, and tool, code, for-each, wait, approval and sub-workflow steps.
9. **The gateway is outward too**: `/api/mcp` gets `apps_search`, `apps_describe`, `apps_call` and workflow runs.
10. We do not build on the `runs` and `dispatch_*` tables (built but unwired, fixture-only). The goal-loop lease pattern (`ownerInstance` + `recoverable`) is what production already uses.

## Phases

0. Retire the bridge; keep the approval card and the pause/resume path, now generic (`tool_resume`). **Done.**
1. Apps core: tables, SDK, runner `stdin` and result, publish and rollback, policy and approval, the `apps` plugin for bots, the Apps page. **Done.**
2. App pages: an app can ship a frontend that draws in a sandboxed frame and calls its tools. **Done.**
3. App storage: declared collections, written back after a valid result. **Done.**
4. Bots build apps in chat (`zetta:app`), with an approval card for host code and a receipt. **Done** (the side pane is not built; the receipt links to the app page).
5. Skill management: list filters, usage, per-bot view, history, update check, lint.
6. Later, in order: accounts and OAuth, code mode, triggers, durable workflows, the outward gateway, app skills.

## Phase 0: what changed

- The pause -> card -> resume path is generic: `PluginPause` (with `pluginTool`), `PluginDef.pausing.resume`, `plugins.resumeTool` (also for built-in plugins), the proposal kind **`tool_resume`**, `createPauseCard`, `resumePaused`, `noticeTurn` in `chat/service.ts`, `ToolPauseCard` in `apps/web/src/features/chat/tool-card.tsx`.
- Gaps fixed: the resume notice turn is marked untrusted; an expired card tells the bot it did not run; a team bot can be resumed by the person who used it; a resume is checked against the plugin tool that paused (not one fixed tool); a decline always goes through.
- Still open for phase 1: a call with no conversation (a routine, the outward gateway) has nowhere to report its result yet; `app_call` will hold it.
- Tests: `chat/tool-card.integration.test.ts` (7, on Postgres), `integrations/plugins/pause.test.ts` (7), `features/chat/tool-card.test.tsx`.

## Phase 1: what was built

- **Tables** (migration `20261108023114_apps_core`, applied to dev): `app`, `app_version` (immutable), `bot_app`, `app_call`. `packages/db/src/schema/apps.ts`.
- **Server** (`apps/server/src/modules/apps/`): `schema.ts` (the JSON Schema subset and its validator), `policy.ts` (run / ask / deny), `manifest.ts` (check a manifest, diff two versions, slugs), `sdk.ts` (the `zetta-app` module and the harness, kept as text because the server is bundled), `service.ts` (publish, call, answer, rollback, policy, grants, search), `routes.ts` (`/api/apps/*`).
- **Runners** (`playground/`): `RunSpec.stdin` and `RunSpec.resultFile`, `RunResult.result`; the host runner passes stdin, the container runner uses `exec -i`. The payload is never in an argument or the environment. A result file is read only if it is a plain file of at most 1 MB.
- **Bot surface**: the built-in `apps` plugin (`integrations/plugins/apps.ts`: `apps_search`, `apps_describe`, `apps_call`), on for a bot that has a `bot_app` grant. Approval is the generic `PluginPause` -> `tool_resume` card from phase 0; the pending call is the `app_call` row, the card's request id is its id, and `pausing.resume` answers it.
- **Web**: `/apps` and `/apps/$ref` (`features/apps/`), a **Publish** button on the Playground page, `ToolPauseCard` for the card.

### Decisions made while building

- Approval happens before execution: the call is validated, its policy decided, and only then is a process started. A waiting call is pinned to the version and the input it was asked with.
- Defaults and "undeclared properties are dropped" are the server's job (`schema.ts`); the SDK only describes. The SDK and the harness are tested with a real `bun` process, including that a secret in the payload never reaches the environment.
- A "no" is an answer, not an error: the bot is told "the user declined" rather than "it could not continue".
- `apps_call` is a write tool, so an inbound (outside people) conversation cannot use any app. Letting outside people run queries needs a flag on the plugin context first.
- A file named `apps_.$ref.tsx` (trailing underscore) keeps the detail page from nesting under the list route, which has no outlet.

### Not verified

The Bun image in a container (`oven/bun`) was not pulled here; the container plumbing was verified with a Debian image and a shell script. The pages were checked only with happy-dom, not in a real browser. A call whose source has no chat (a routine, the outward gateway) has no way to ask yet (phase 4 and 6).

## Phase 2: app pages

- **A page is part of a version.** `ui/index.html` (with its own css, js and ts files) or an HTML playground. It is built at publish time with Bun into one self-contained HTML (`app_version.ui`, at most 5 MB; migration `20261108035722_app_ui`). Local files are inlined; a library comes from a public CDN by `https://` URL; a bare package name (`react`) is refused with a message that says so. An app can have a page, backend tools, or both; a page-only app has zero tools.
- **The frame is opaque.** The page runs in `<iframe srcDoc sandbox="allow-scripts">`: no same-origin, so no cookies and no API of its own (it sends `Origin: null`), no popups, no forms, no top navigation. The build puts, in this order and before anything of the page: a `<meta http-equiv="Content-Security-Policy">` with the artifact policy (so browsers that ignore the iframe `csp` attribute are still closed), the design-system style, the bridge, the console relay.
- **The bridge** (`packages/core/src/app-bridge.ts`): the page gets `window.zetta.call(tool, input)` -> Promise, nothing else. It posts to its parent and accepts replies only from its parent. The web app (`features/apps/app-host.ts`, drawn by `app-frame.tsx`) checks the sender window, the message shape, the tool against the tools of that version, size caps and a rate limit (8 in flight, 20 a second), then calls `POST /api/apps/:ref/call` as the person. The server decides again; the page cannot reach anything the person's session could not, and a tool the app does not have never leaves the browser.
- **Approval is shown by the web app, never by the page.** A change that needs a yes (`approval_required`) shows a bar outside the frame with the tool, its kind and the exact input; **Allow** answers through `POST /api/app-calls/:id/answer`. "Allow this tool while this page is open" lasts until the page closes; the server still records every call. Closing the page cancels the prompts that are open.
- **Serving**: `GET /api/apps/:ref/ui` returns `{ page: { html, version, tools } }` with the same visibility rules as the app; the version list and detail never carry the HTML.
- **Web**: an **Open** tab (the default when the app has a page; the default stays out of the address), and a "Has a page" badge on the list.
- **Tests**: `ui-build.test.ts` (real Bun builds: order of the head, CDN rules, macros, size, script breakout), `apps.integration.test.ts` "pages" (publish with a page, page only, build error, visibility, rollback, bridge validator into a real call), `app-bridge.test.ts` (validator, limiter, the prelude run against a stand-in window), `app-host.test.ts` (17, the whole host decision path), `app-frame.test.tsx` (frame flags, sender check, prompt outside the frame, allow, decline, cancel on close), `app-page.test.tsx`.

### Not verified (phase 2)

No real browser has run a frame yet: happy-dom does not enforce the sandbox, the CSP or `Origin: null`. The first thing to do by hand is open an app with a page, click something that calls a query, then something that changes data, and see the bar. A frame can still navigate itself (a sandbox limit), so an app must not hold data its viewer should not see. The host runner is still not a sandbox.

## Phase 3: app storage

- **Table** `app_record` (migration `20261108060804_app_storage`, applied to dev after a dump): `app_id`, `user_id` (null in a shared collection), `collection`, `key`, `value` jsonb, `bytes`. Unique on `(app_id, coalesce(user_id,''), collection, key)`.
- **Declaration**: a tool's `storage: { collections, shared, write }`, checked by `checkManifest` (names, at most 10 collections, a collection is personal or shared, a query cannot write) and shown in the version diff as `storage`, because what a tool may keep is part of what the owner agrees to.
- **Snapshot, not a connection.** The server loads the caller's records of the declared personal collections and the shared ones (at most 1 MB, else `STORAGE_TOO_LARGE` before anything runs) and sends them in the payload. `ctx.storage` reads that snapshot plus the tool's own writes. Writes are buffered and returned in `result.json`. The tool never touches the database, so the host runner gains no database access from this.
- **Written once, after success.** `checkOps` (modules/apps/storage.ts) re-checks every write against the declaration (the server does not trust the SDK's own checks), keeps the last write of a key, and `applyOps` applies them in one transaction, then checks the quotas inside it: a pass over a quota undoes the whole call (`STORAGE_FULL`). A failed tool, a bad output or a rejected write leaves nothing behind.
- **Concurrency.** Writes are upserts. Two calls at once both finish and the last write of a key wins; there is no per-record versioning yet.
- **Rollback and new versions never touch records.** A collection an older version declared still shows on the Data tab while it holds records.
- **Data tab and API**: `GET /api/apps/:ref/data`, `DELETE /api/apps/:ref/data?scope=mine|all` (`all` is the owner's). The owner sees counts of other people's records, never their content. Deleting is audited.
- **Tests**: `storage.test.ts` (checks, manifest, diff), `storage.integration.test.ts` (17, a real to-do app: personal vs shared, failure writes nothing, quotas, 1 MB snapshot, concurrency, rollback, data page, through the bridge validator), routes tests, `app-page.test.tsx` (Data tab).

### Not done (phase 3)

No per-record versioning (last write wins), no query or index over values (`list` returns a collection, with an optional key prefix and limit, and the 1 MB snapshot is the real ceiling), no export of the data. An app's owner cannot read other people's records, which also means the owner cannot repair them from the Data tab.

## Phase 4: bots build apps in chat

- **The tool** `zetta:app` (`chat/tools.ts`, schema in `apps/fields.ts`): `guide`, `create`, `update`, `get`, `list`, `archive`. The always-on prompt has one short line; `guide` returns the full reference (`apps/guide.ts`: SDK, page bridge, storage, limits, design-system classes) only to a bot that is about to build, so the other bots do not pay for it. `guide.test.ts` ties its numbers to the code's own constants.
- **Author** (`apps/author.ts`): the files go into a playground the person owns (`createdByBotId` set, so they can open and edit the code like any other), then `apps.publish`. Detection is by file: `index.ts` is the backend, `ui/index.html` the page. Neither is `INVALID`. A page-only app becomes an `html` playground on the `browser` runner.
- **`update` merges by path** (`files` add or replace, `remove` deletes, the rest stay). The plan said "files replace the set"; a bot that sends one changed file must not wipe the others.
- **Where the code runs decides who says yes.** Describing an app runs its code, and the host runner is not a sandbox. So the check (`apps.check`, a split of the checks in `publish`) runs the describe step only when it is safe: no backend (building a page runs nothing), or the container runner. A new app uses the container when the server has one; otherwise the host, and then nothing runs until the person approves a `publish_app` card (press and hold, like other cards that widen what a bot may do). An update that changes only `ui/` files publishes at once, since the backend that already ran is unchanged. A build error always comes back to the bot, because the page is built before the gate.
- **The card** (`config_proposal.kind = publish_app`, TypeScript enum only, no SQL change): `patch = {botId, conversationId, args}`; the diff lists the action, the files and why it waits. Approving runs the same `author.run` with `approved = true`, then tells the bot in a quiet turn (`noticeTurn`, framed as untrusted); a failure at that point goes to the bot instead of leaving a stale card. `ToolScope.approved` is set while a held `bot_action` card replays, so an app call held after outside content (it is in `defersWrite`) is not asked twice.
- **Safety rules that already apply**: after a bot read outside content, `app` writes wait for one `bot_action` card; outside (inbound) people cannot use it (`inboundAllowed`); `get` and `list` and `guide` stay allowed. A bot cannot grant an app to a bot, share it, or set a tool policy: those are the person's, in the Apps page.
- **Receipt**: kind `app` (`id` = slug, text `Name · vN`) renders as a chip that links to `/apps/$ref`, which opens on the page.
- **Tests**: `author.integration.test.ts` (10), `chat/app-author.integration.test.ts` (8, through the real tool loop, the card and the notice), `guide.test.ts`, web `message-row-app.test.tsx`, `tool-fences.test.ts`.

### Not done (phase 4)

The live side pane while the bot works (the artifact pane opens on a `data-artifact` event; an app would need its own event through `ui-stream` and `chat-rows`). A bot cannot call the tools of the app it just built to test it, because it is not granted to it; the person grants it. Several bots editing one app have no merge: the last `update` wins.
