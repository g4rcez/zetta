# Spec: Workspaces (multi-tenant SaaS)

## Context

Zetta is self-hosted, one install per company (`installation_identity` / `installation_settings` are single rows, "one admin per installation"). The pivot: one hosted instance serves many unrelated companies. A **Workspace** is the tenant. Today 91 tables in schema `zetta` are scoped only by `owner_user_id`, filtered by hand in each store (`apps/server/src/modules/identity/access.ts`). There is no tenant column and no RLS. The app connects as `postgres`, a superuser that bypasses RLS. Bots run shell on the host, which would defeat any DB wall on a shared host.

Confirmed intent (interview, explicit yes):

- **Users:** one global login per person; membership in many workspaces with roles owner/admin/member; a Slack-like switcher.
- **Database:** one shared DB. `workspace_id` on every tenant row; RLS is the cross-workspace wall. Owner/team privacy stays in app code. "team" visibility/sharing means workspace members.
- **Modes, chosen by start command:**
  - `bun run local` = today's self-host with host tools.
  - `bun run app` = SaaS with containers.
  - Both use the same schema and code path.
- **First release:** isolation core, export/delete, BYOK keys, quotas.
- **Out of scope:** self-serve signup (invite-only), SSO, per-token billing, schema-per-tenant or DB-per-tenant.

Decisions from spec review:

- **Containers:** per turn, scoped to the workspace (reuses the existing Docker harness).
- **Postgres:** direct connections, no transaction-mode pooler.
- **Keys:** workspace key plus an optional personal key per member.
- **Payments: skipped.** Assumption to confirm: plans, usage metering and quota enforcement stay in; no payment provider and no invoicing.

## 1. Data model

New tables. All ids use `uuidv7()` and all states are string enums.

- `workspace(id, slug unique, name, status active|suspended|deleting|deleted, plan_id, created_at)`
- `workspace_member(workspace_id, user_id, role owner|admin|member, status active|removed, activation_revision, joined_at, removed_at)`, PK `(workspace_id, user_id)`. It replaces `membership` (`packages/db/src/schema/identity.ts:7`) and keeps the activation-revision rule that `team_person` depends on.
- `workspace_key`: a per-workspace data key wrapped by the deployment key, copying the `connection_user_key` pattern (`schema/connections.ts:184`). Shredding it makes the workspace's secrets unreadable.

Changes to existing tables:

- **`membership`:** copy it into the default workspace; it is read-only for one release, then dropped.
- **`invitation`:** add `workspace_id` and `role`.
- **`identity_audit`:** add a nullable `workspace_id`. A null value means a platform event, which the app role cannot see.
- **`installation_identity` and `installation_settings`:** stay global. The install admin becomes the platform operator. In `local` mode the operator is also owner of the default workspace.

**Rename the old bot folder:**

- `zetta.workspace` (`schema/chat.ts:25`) becomes `folder`, and `bot.workspace_id` becomes `folder_id`.
- Its indexes get matching names.
- Route `/workspaces` (`modules/chat/routes.ts:681`) becomes `/folders`, with an alias for one release.
- The code-dir sense of "workspace" in `harness.ts:305` becomes `codeDir`.

**Table classes:**

- **Tenant-direct (57):** every table with `owner_user_id`. They get `workspace_id NOT NULL`.
- **Tenant-child (11):** `bot_revision, bot_claude_config, bot_claude_asset, bot_database, discussion_member, team_member, team_person, wiki_link, wiki_page_team, bot_skill, workflow_version`. They also get `workspace_id`, plus a composite FK `(parent_id, workspace_id)` to a `unique(id, workspace_id)` on the parent. FK checks ignore RLS, so without the composite FK a row in workspace A could point at a row in B. This also lets every policy be the same one-line rule.
- **Global, no RLS (20):** auth (`user, session, account, verification, jwks, oauth_*`), `installation_*`, `server_instance, rate_limit, transport_key, dispatch_capacity, connection_nonce, connection_key_check`.

**Unique constraints that gain `workspace_id`:**

- `bot_slug_key` (`chat.ts:127`; today it leaks bot names across companies)
- `mcp_server_team_name`, `wiki_page_shared_slug`, `bot_one_chief_per_owner`
- `agenda_sync.owner_user_id`, `user_preference` PK, `connection_user_key` PK
- every other unique constraint that starts with `owner_user_id`

## 2. RLS

**Roles:**

| Role              | Attributes                                                                  | Used by                                                    |
| ----------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `zetta_migrator`  | Owner, BYPASSRLS                                                            | drizzle-kit migrate, backfills                             |
| `zetta_app`       | NOSUPERUSER NOBYPASSRLS, DML grants, CREATEROLE (bot-database needs it)     | All request and turn queries                               |
| `zetta_scheduler` | NOBYPASSRLS, SELECT only, with `USING (true)` policies on queue tables only | Finds due rows across workspaces                           |
| `zetta_operator`  | BYPASSRLS                                                                   | Provisioning, export and delete from the operator CLI only |

Queue tables for `zetta_scheduler`: routine, goal_loop, chat_queue, discussion_turn, wiki_job, inbound_route, agenda_sync, knowledge_source, runs.

Reuse the grant and catalog check ideas from `docs/decisions/membership-runtime-role.md`.

**Policy on all 68 tenant tables** (`ENABLE` + `FORCE ROW LEVEL SECURITY`):

```sql
create policy workspace_wall on zetta.<t> to zetta_app
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
```

- It uses built-ins only, with no custom function or trigger, so it fits the "no permanent DB logic" rule.
- A missing setting gives NULL, which denies the read or write.
- The column default uses the same expression, so existing inserts need no change.
- Main indexes get `workspace_id` as their first column.

## 3. Context plumbing

**Workspace per checkout:**

- `AsyncLocalStorage<{workspaceId}>` (`tenant.run(ctx, fn)`; never `enterWith`).
- A `Pool` subclass in `packages/db/src/index.ts` whose `connect()` runs `select set_config('app.workspace_id', $1, false)` on every checkout, with `''` when there is no context.
- This covers every query: pg-pool `query()` goes through `this.connect` (verified, `pg-pool/index.js:449`), and Drizzle transactions call `client.connect()` (verified, `drizzle-orm/node-postgres/session.js:52`). So the 64 existing transactions need no edits.
- The setting is overwritten on each checkout, so a pooled connection cannot leak the previous workspace. Long bot turns hold the context, not a connection.

**Actor:**

- `ActiveActor` (`access.ts:14`) becomes `{userId, workspaceId, role}`, and `isAdmin` is derived from `role`.
- `MembershipLookup` takes `(userId, workspaceId)`.

**HTTP:**

- `requireActive` reads the `X-Zetta-Workspace` header, with a `?w=` fallback for EventSource, images and WebSockets.
- Add the header to CORS (`app.ts:144`).
- Each guarded handler runs inside `tenant.run`.
- The web app moves to `/w/$slug/...` routes, so the workspace lives in the URL per tab (project rule: state in the URL).

**MCP:** the resource URL is per workspace, `/api/mcp/w/:workspaceId`, used as the token audience (`mcp-guard.ts:85`). `actorFor(sub, workspaceId)` replaces the current call at `services.ts:492`. _Unverified:_ whether better-auth `mcp()` accepts more than one resource. The fallback is a workspace claim from `oauth_consent.reference_id`.

**Background work:**

- Each scheduler selects as `zetta_scheduler`, then for each row runs `issueBackgroundActor(userId, row.workspaceId)` and `tenant.run`.
- Call sites: `services.ts:289-417`, `discussions/worker.ts:38`, `wiki/jobs.ts:276`, `knowledge/service.ts:611`, `agenda/scheduler.ts:132`, `inbound/service.ts:210/295/593`, `chat/service.ts:5773`.
- Schedulers start at boot outside any context, and they assert that they have none.

**Events:** the bus key becomes `${workspaceId}:${userId}` (`events/bus.ts:21`), and `BusItem` carries `w` through NOTIFY (`pg-signals.ts:37`).

## 4. Runtime modes

`ZETTA_MODE=local|app` and root scripts `local` / `app`.

|                     | `local`                                                                          | `app`                                                 |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Harness             | Host                                                                             | `ZETTA_HARNESS_RUNTIME=docker` is forced              |
| Workspaces          | Default workspace selected automatically; switcher hidden when there is only one | Operator creates workspaces; invite-only              |
| Provider keys       | Host CLI logins allowed                                                          | Workspace key or personal key; host logins never used |
| Quotas              | Off                                                                              | Enforced                                              |
| Database role check | Warns if superuser or BYPASSRLS                                                  | Refuses to start if superuser or BYPASSRLS            |

**Container:**

- Keep the existing throwaway, hardened container per turn (`harness.ts:545-611`), with the environment as an allowlist and secrets passed as `-e KEY`.
- **New:** a dedicated Docker network with no route to Postgres. Today it is `bridge` and Postgres is published on `127.0.0.1:5432`.
- **New:** workspace file roots `<root>/w/<workspaceId>/...` for files, artifacts (`artifacts/storage.ts:24`), attachments (`chat/images.ts:21`), code dirs, harness homes and browser profiles.
- Bots act through zetta blocks parsed by the server (`tools.ts:92`), so the container never needs DB access.
- Bot databases stay on the server side. New role and schema names get a workspace prefix; existing names are kept, because their password is derived from the name.

**Keys:**

- Reuse `connection` (kind `api-key`, `connections/service.ts:24`), adding a `scope personal|workspace` column.
- Workspace keys are encrypted under `workspace_key`.
- The resolver (`connections/service.ts:83`) uses the member's personal key first, then the workspace key.
- Keys are write-only.

## 5. Export / delete

- **Export:**
  - Runs as `zetta_app` with the workspace set, so RLS limits it to that workspace.
  - Writes NDJSON per tenant table, plus workspace files and a `pg_dump -n` of each bot schema.
  - Secrets go out as metadata only.
  - The result is an expiring link, and the export is recorded in `audit_event`.
- **Delete:**
  1. Set status to `deleting`, stop turns, and cancel runs.
  2. Delete rows in FK order as `zetta_operator`, with the order computed from the catalog.
  3. Drop bot roles and schemas; remove files and volumes.
  4. Shred `workspace_key`.
  5. Keep a tombstone and a platform audit entry.

## 6. Quotas (payments skipped)

**Tables:**

- `plan`: limits for container-seconds, storage bytes and turns.
- `usage_counter(workspace_id, period, metric, value)`, updated by upsert.
- `usage_event`: append-only ledger.

**Enforcement:**

- Turns are checked when a turn is admitted to the chat queue.
- Container time is metered per run, and the container is stopped when over quota.
- Storage is measured on a schedule, and uploads are blocked when over.
- The existing bot-database quota stays.

## 7. Phases (each ships working software; checkpoint after each)

1. **P0 Rename:** folder rename (DB, API alias, UI); "workspace" code-dir renamed to codeDir.
2. **P1 Tenant tables:** workspace and workspace_member; default workspace; copy membership into it; actor gains `workspaceId`, always the default for now.
3. **P2 Column:**
   - Add a nullable `workspace_id` to all 68 tables.
   - Backfill in batches; there is a single default workspace, so no row is ambiguous.
   - Add the default, then a NOT VALID check, then validate, then NOT NULL.
   - Then the composite FKs and the new unique constraints.
   - Data is never lost: test each migration on a scratch DB first.
4. **P3 Plumbing:** AsyncLocalStorage, the Pool subclass, all entry points. `ZETTA_RLS=shadow` counts checkouts that have no context. Postgres has no log-only RLS mode, so this stands in for one.
5. **P4 RLS:** roles and policies; CI runs as `zetta_app`; production switches `DATABASE_URL`, and switching back is the rollback.
6. **P5 Multi-workspace:** switcher, `/w/$slug` routes, invitations per workspace, events keyed by workspace, MCP per workspace.
7. **P6 App mode:** `ZETTA_MODE`, scripts, network without a route to Postgres, workspace file roots, BYOK scopes.
8. **P7 Rest of the first release:** quotas, export, delete.

## Verification

- **Isolation matrix:** extend `apps/server/src/modules/isolation-matrix.integration.test.ts`. Seed workspaces A and B and connect as `zetta_app` with A set. For every tenant table:
  - only A's rows come back;
  - inserting with B's id fails with 42501;
  - updating or deleting B's rows affects 0 rows;
  - with no setting, 0 rows come back;
  - a reference from A to B fails on the composite FK.
- **Catalog test:** every `zetta` table is either on the global allowlist, or has RLS enabled and forced, a `workspace_wall` policy, and a NOT NULL `workspace_id`.
- **Schema test:** every `zetta.table` declares `workspaceId` unless it is on the allowlist.
- **Startup check:** the app role is not superuser and has no BYPASSRLS.
- **Import rule:** only allowlisted files may use the scheduler or operator database connections.
- **Container check:** a harness container cannot reach Postgres (`pg_isready` from inside fails).
- **E2E (Playwright):** two users in two workspaces; switch workspaces; Back/Forward keeps the workspace.
- **Diagnostics:** run DB tests on a scratch database (per project memory), then type-check after each phase.

## Risks / open

1. **AsyncLocalStorage context captured by a long-lived timer.** It writes to the wrong workspace, and RLS cannot catch that. Mitigation: boot-time schedulers outside any context, plus assertions.
2. **MCP:** support for a resource per workspace in better-auth is unverified.
3. **Container network:** whether Postgres is reachable depends on the host (Docker Desktop vs Linux). It needs the container check above.
4. **Retention window for deleted data in backups:** not decided.
5. **Desktop and CLI workspace selection:** not yet designed. The desktop app is a webview, so the `/w/$slug` routes probably cover it.

## On approval

Save this spec as `docs/decisions/workspaces.md`. Then implement **P0 only** and stop at the checkpoint before P1.
