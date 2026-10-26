# RFC-003: Establish focused test seams

- **Module:** Foundation
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-001](001-approve-domain-and-ownership-contracts.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Make the server constructible without binding a port or loading real infrastructure so later RFCs have focused tests.

## Non-goals

No new test package, wholesale server refactor, auth behavior change or full-suite execution.

## Source anchors and planned changes

- `apps/server/src/index.ts`
- `apps/server/src/services.ts`
- `apps/server/src/app.ts (new)`
- `apps/server/src/test-support/ (new)`

## Contract and implementation steps

1. Confirm approval to establish native Bun tests and keep startup behavior unchanged; extract only app construction from listen/bootstrap.
2. Inject fake auth, clock, identifier, storage and runner boundaries as needed by current tests; avoid a generic dependency-injection framework.
3. Add synthetic two-user fixtures and a health/auth-forwarding regression test. Document isolated PostgreSQL test setup as approval-required rather than launching it.

## Acceptance criteria

- [ ] Importing the test app neither listens nor connects to PostgreSQL/Axiom/providers.
- [ ] Existing health/auth route forwarding, CORS intent and startup port remain unchanged under focused fixtures.
- [ ] A documented single-file Bun command runs without secrets; integration tests cannot accidentally use a production database.

## Verification

Proposed command: `bun test apps/server/src/app.test.ts`. Assert bootstrap side-effect absence and current route responses.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Export the described module behavior with focused tests and a short contract handoff for dependent RFCs. Do not leave mock success paths in production code.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Accepted: implementation and focused checks complete; independent source review found no blockers. Coordinator independently confirmed the approved single-file checkpoint: 16 pass, 0 fail, 126 assertions (162 ms). Approval: the user explicitly approved native Bun single-file tests using the existing runtime without new dependencies. RFC-001 policy acceptance is recorded in [ownership](../docs/decisions/ownership.md) and its completion record. This slice changes no auth/schema/API policy and adds no UI. The root task index was deliberately left to the coordinator.

Changed paths:
- `apps/server/src/index.ts`: production composition only; retains real environment/services, `initLogger` service `zetta-server`, Axiom drain, port 3000 and the exact startup message.
- `apps/server/src/app.ts`: exports synchronous `createApp({ auth, webOrigin, desktopOrigins, drain })`, `AppAuth` and `CreateAppOptions`. Requires only the current auth session/handler boundary, origin values and a drain typed from installed evlog. No clock/identifier/storage/runner scaffolding. Keeps evlog → identity derive → CORS → auth wildcard → health in the original order. No environment/services/Axiom import, module-evaluation app construction, logger initialization, drain construction or listen.
- `apps/server/src/app.test.ts`: native Request/Response fixture checkpoint through `app.handle(new Request(...))`.
- `apps/server/src/test-support/fixtures.ts`: synthetic A/B sessions and minimal type-safe auth, plus a synchronous in-memory recording drain. Explicit test-only `initLogger` clears global plugins/drain fallback, disables console output and makes redaction deterministic so the real middleware's email masking can be asserted. No timer/batching/network drain or real auth/database is constructed.
- This completion record only; no dependency, lockfile, root index, schema or unrelated file changes.

Acceptance evidence:
1. A fresh Bun subprocess with only `NODE_ENV=test`, repository dotenv loading disabled, and throwing listen/network/timer guards successfully imports the factory. Logger environment remains unchanged. A closed static-import allowlist also excludes environment/services/database/auth runtime/Axiom and bootstrap calls. Fixture app has no bound server. No secrets or infrastructure are needed.
2. Health remains 200/`OK`; GET and POST (plain text and JSON) preserve original Request identity, URL/query, headers, body and returned success/rejection status, header/cookie and body. PUT/PATCH/DELETE/HEAD return 405 without forwarding. Web and `views://mainview` CORS origins retain credentials; unlisted origins lack allow-origin while still returning the existing health response. Allowed/denied OPTIONS preflights retain 204, configured methods/headers and no auth dispatch/session lookup. Anonymous/A/B health requests use separate session identities; real evlog middleware records masked email/session IDs, not fixture session tokens/cookies. Production port/message and composition were reviewed in the source diff, not exercised by listening.
3. From repository root, the user runs exactly `bun test apps/server/src/app.test.ts`. Final result on Bun 1.3.14: **16 pass, 0 fail, 126 expect() calls, 1 file, 175 ms**. This is a fixture checkpoint, not a real login, authorization or multi-user OS/DB-isolation proof.

Exact validation history:
- `bun test apps/server/src/app.test.ts` (RED): exit 1; 0 pass, 1 fail, 1 error; expected missing `../app` before extraction (21 ms).
- Same command after extraction: exit 1; 12 pass, 3 fail, 109 assertions (15.12 s). All three preflight response assertions passed, but tests incorrectly awaited log events on the CORS early-return path. Installed Elysia 1.4/CORS does not invoke the evlog after-response drain there; tests were corrected to preserve/assert that existing behavior, not change production hooks.
- Same command after correcting preflight waits: exit 0; 15 pass, 0 fail, 112 assertions (98 ms).
- Same command after adding JSON POST and rejection-status coverage: exit 0; 16 pass, 0 fail, 126 assertions (175 ms).
- `git diff --check` passed; final `git status --short` showed only the intended server additions/change alongside pre-existing unrelated work, and `git diff --cached --name-only` was empty. No files staged.
- LSP tool unavailable. Installed `tsc --version` reported 6.0.3. Initial explicit-file no-emit invocation without `--ignoreConfig` stopped with TS5112; the corrected invocation then found one test-only `string | undefined` regex-capture diagnostic, which was fixed.
- Final targeted no-write diagnostics passed with no output: `apps/server/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/app.ts apps/server/src/app.test.ts apps/server/src/test-support/fixtures.ts apps/server/src/index.ts`. This includes production auth assignability with no cast. Installed/lockfile APIs reviewed: Elysia 1.4.30, evlog 2.33.1 and CORS 1.4.2, rather than the skill's v2 examples.

Failure/privacy and skipped checks: CORS is browser response approval, not authorization; denied origins still receive the existing status and credentials header without allow-origin. Auth wildcard exclusion and middleware identity logging remain unchanged. Existing preflight non-emission is retained. All fixtures are synthetic `.invalid` identities. No production startup, real Better Auth login, PostgreSQL, Axiom/provider, browser/desktop, build, broad suite, install, generation or migration was run. No commits/staging/worktrees were used; existing unrelated edits/untracked documents were preserved.

Approval-required isolated PostgreSQL setup (not implemented or launched): obtain a separately approved disposable database and explicit test-only URL; fail closed if absent and reject production/default `DATABASE_URL`, never fall back to it or import `services.ts` for test connections. Apply only separately approved migrations against that isolated target, use synthetic A/B data and define teardown before connecting. There is intentionally no database integration entry point in this fixture slice, so its checkpoint cannot fall back to a production database.

Review note: fixture `initLogger` changes process-global state without restoring it. Accepted only for this standalone sequential single-file checkpoint; broader/concurrent fixture reuse must define logger ownership or process isolation first. The reviewer had no command runner; independent runtime confirmation was performed by the coordinator, not the reviewer.

Next consumer: dependent RFCs can import `createApp` and reuse/extend synthetic fixtures under their own approved scopes and logger-ownership constraints. RFC-004 exact enrollment/bootstrap/auth/schema changes and RFC-002 real isolation evidence remain separately gated. Do not interpret this seam as authorization/readiness/OS containment proof or permission for a broad test or environment run.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Unchanged.

Evidence: tasks/003.
