# Zetta v1 implementation plan

Status: proposed implementation plan; product intent and the subsequent UX scope update are confirmed. Visual workflows, browser/computer use and an attention kanban are required in v1. No RFC is implemented by creating this backlog.

## Read first

1. [Confirmed intent](../docs/intent/zetta-v1.md).
2. [TASKS.md](../TASKS.md), the sole status and ordering index.
3. [Agent execution contract](README.md).
4. The selected RFC and its completed prerequisite handoffs.

Each numbered RFC is one bounded task. Research RFCs produce evidence and decisions, not speculative production adapters. The root index groups RFCs by module and lists a global topological execution order. There is no second `todo.md` to drift out of sync.

## Repository baseline

Observed before this documentation pass:

| Concern | Existing anchor | Planning consequence |
| --- | --- | --- |
| Runtime/workspace | `package.json`, Bun package manager 1.3.14 | Reuse Bun and TypeScript; no new orchestration platform by default. |
| Web | `apps/web/src/routes`, React 19, TanStack Router | Extend authenticated routes; do not replace routing. |
| Server | `apps/server/src/index.ts`, `services.ts`, Elysia ^1.4.30 | Keep app-owned service wiring; do not assume Elysia v2 APIs. |
| Identity | `packages/auth/src/index.ts`, Better Auth 1.7.7 | Reuse authentication. Membership/admin policy is a gated addition. |
| Storage | `packages/db/src/schema`, Drizzle 1.0.0-rc.4, PostgreSQL | Add feature migrations incrementally, not one speculative full schema. |
| UI | `packages/ui/src/components`, including message/bubble/attachment/scroller primitives | Reuse shared components and Tailwind tokens. |
| Calendar | User's `@g4rcez/components` reference | Not declared in inspected web/UI manifests; verify before any installation. |
| Environment | `.env.schema` files, Varlock generation described in `TECH.md` | Never edit generated accessors or inspect secret values for planning. |
| Diagnostics | evlog is declared in server manifest | Extend existing logging, avoiding user content/secret logging. |
| Tests | No test script in inspected root/server/web manifests | First establish a focused native-Bun test approach; do not install a framework. |

`TECH.md` is an existing untracked user file. It is useful context, not modified here. Its statement about `check` differs from the actual root script: `bun run check` runs a write formatter. `apps/web`'s `check-types` invokes a build. Neither is a harmless default read-only check. Root lockfiles and existing edits must be preserved.

## Architecture direction — proposed, not an approved public API

Use the current server, database, and web packages. Proposed new domain modules live under `apps/server/src/modules/<domain>/`, UI features under `apps/web/src/features/<domain>/`, and feature tables under `packages/db/src/schema/`. These are planned paths, not claims that files already exist. Create a shared package only for demonstrated current reuse.

Every execution carries an immutable actor context: initiating user, authorized team scope, bot, conversation, run, and originating routine/delegation where present. Server code derives this context from the session or stored job owner, never from an untrusted body. A shared bot definition is not a shared execution identity.

Keep separate concepts:

- **Human membership boundary:** which users may see team-visible bots and snapshots.
- **Workspace:** user-facing name for a visual bot team/group. It organizes bots only; it is not an ACL, account-sharing boundary, chief scope or shared conversation. Existing proposed bot-teams paths can keep their internal name.
- **Connection:** a user-owned external account reference, with secrets resolved only inside execution.
- **Run:** a durable logical execution request with separate attempt identities, explicit status, cancellation, deadlines and event sequence. Persisted assistant/tool messages outlive event retention; an event stream is not the sole chat store.
- **Memory/instructions:** persisted knowledge with scope and provenance, separate from chat history and runtime configuration.
- **Onboarding/readiness:** actor/bot/configuration-and-binding evidence of a real conversation followed by explicit positive satisfaction. Separate technical prerequisites from user confirmation; a shared bot never confers account readiness to another user.
- **Attention item:** a source-linked, actor-owned request for input/repair/review, separate from run status and audit events. Sidebar, activity and kanban consume the same projection.
- **Workflow:** an owned versioned graph of conditional bot work, executed through existing runs. Visual layout is not execution state.
- **Browser/computer session:** isolated runtime resources, with explicit input ownership, per-user profiles and secure takeover. These are not the visual workspaces above.

The first domain RFC must settle membership cardinality, who can edit shared bots, chief configuration ownership, enrollment/admin behavior, snapshot retention/revocation, and visibility after membership removal. Do not infer a SaaS organization model or full RBAC system.

## Invariants for every module

1. No cross-user credentials, chat history, files, native harness state, browser sessions, private instructions, or memories.
2. Run identity survives delegation, hooks, decisions, retries, and schedules. Configuration cannot rewrite the actor identity.
3. System prompts are not security boundaries. Multi-user process isolation is a release blocker if a harness can read a shared host home or another user's secrets.
4. Immutable configuration versions are captured for runs. Edits affect future work; self-edits use explicit versioned proposals and approval.
5. Every async task has an owner, status, deadline, cancellation, bounded output, and restart semantics. Do not claim exactly-once external side effects.
6. Reconnect, scheduler overlap, and request retries do not create duplicate logical jobs. Unknown external outcomes need reconciliation, not blind replay.
7. Untrusted message, tool, source, file, and memory content remains data; it cannot escalate credentials or alter configuration policy.
8. Snapshot publication copies safe content at a cutoff, not live pointers or account capabilities.
9. Locally enforced authentication and authorization are in v1 even though configurable tool/action permissions are deferred.
10. Setup has two channels—forms and any bot's chat—with the same target authorization, validated draft, version checks and explicit bot-proposal approval. The chief is an orchestrator, not a special authorization role.
11. Ordinary work requires completed onboarding; only a bounded user-started test conversation may precede satisfaction. A model cannot assert satisfaction, forge test purpose or complete onboarding for another user.
12. Attention acknowledgment is not task completion, repair, approval or permission. Kanban movement cannot manufacture a successful external action.
13. Browser and desktop actions cannot run concurrently with human takeover. Credential-entry views never become retained task output, model context or learned knowledge.

## Delivery sequence

The exact RFC graph is in [TASKS.md](../TASKS.md). Deliver working slices:

1. Resolve ownership and isolation gates, establish focused tests, and research required browser/desktop backends once harness evidence is available.
2. Add local identity enforcement, scoped connections, durable runs/events and the shared attention contract (RFC-071).
3. Prove Pi and bot configuration services, provision personal chiefs/workspaces, then build the sidebar and private chat. RFC-024 depends on configuration services (020), not completed onboarding (021). This allows 025 → 069 → 070 → 026 before 021's real conversation and satisfaction gate without a cycle.
4. Complete friendly onboarding with explicit satisfaction, and deliver the other five harness adapters against the same contract. A saved form is not a ready bot.
5. Add files, threads, mentions, reactions and snapshots. Connect chief delegation and routine results to attribution, durable outputs and shared attention producers.
6. Add scoped integrations, Jev/Laya, hooks, knowledge management and diff approval. RFC-062 no longer depends on automatic learning: user-requested configuration must not wait for a bot to learn first.
7. Deliver the attention kanban (072), required browser/profile/desktop/takeover path (074–078), and versioned visual workflows (079–082).
8. Connect forms and any-bot chat configuration (073) to the same services; verify successful task → instruction → routine, incorrect result → knowledge correction → later session, and blocker → repair → retained work.
9. Verify privacy, recovery, real six-harness/browser/computer compatibility, visual workflows and nontechnical user journeys before release. The root index gives the exact dependency-safe order; IDs are not execution ranks.

After every two or three RFCs, review their handoffs and run only their focused approved checks. At each module boundary, test one user-visible success case and one isolation/failure case. The index contains explicit module checkpoints. No release gate can be passed by a mock alone.

## External compatibility and scope gates

| Gate | Required result before implementation |
| --- | --- |
| CLI compatibility | Versioned first-party evidence for headless interaction, events, login ownership, model discovery, session state, cancellation, tools and hooks for each of the six harnesses. Unsupported behavior stays visible; no made-up flags. |
| Hermes | Identify the intended upstream mechanism, license, data model, retrieval/write API, and whether to reuse an existing integration or implement compatible semantics. No assumption that Hermes is a hosted API or needs a vector database. |
| Jev / Laya | Identify both products, protocol/auth, privacy/data egress, action outputs and failure behavior independently. Missing docs/product identity is a blocker, not permission to invent an endpoint. |
| MCP / sources | Confirm transport support, server purpose, permissions and OAuth scopes. Select the smallest real source setup for acceptance; a marketplace is not required. |
| Browser / computer use | Required in v1. RFC-074 selects evidenced backends and supported OS/versions; RFC-075–078 implement per-user profiles, browser tools, isolated desktops and secure takeover. No host-desktop or cross-user-profile fallback. |
| Visual workflows | Required in v1. RFC-079 proposes the bounded typed graph/node catalog; RFC-080–082 implement durable execution, visual/list editing and inspectable results. Full n8n parity is not implied. |
| Friendly configuration | Forms and any bot chat share validation/versioned changes. Actual harness responses and explicit positive user satisfaction complete onboarding; privacy and readiness checks are server-enforced. |
| UI dependencies | Verify Markdown and calendar capabilities in installed components. Ask before adding or changing dependencies. |

A research RFC can be completed with an accepted supported design, but a blocked required integration cannot be marked delivered. If product choice or licensing prevents support, keep its implementation and release gate blocked until the user changes scope.

## Verification strategy

Documentation in this pass is checked for unique RFC IDs, valid local links, required sections, dependency existence, an acyclic graph, and agreement between module order and prerequisites.

Implementation tasks use native Bun fixtures where suitable. Each RFC specifies a proposed focused test file and scenario matrix. Database, subprocess, browser and provider integration checks need isolated environments and approval. Pure mocks are useful for contracts but do not prove real isolation or compatibility. Ask before a build, full suite, E2E, external/paid service, dependency change, schema migration, or environment-dependent command. No production account is used as a fixture.

Use available LSP diagnostics for changed code; report when the tool is unavailable. Avoid generated files, auth schema hand edits, lockfile churn, unrelated formatting, and installing tools. Feature migrations must come from the approved schema workflow; applying them needs separate approval.

## Risks and mitigation

| Risk | Mitigation / release condition |
| --- | --- |
| Host CLIs share global login state | Prove per-user filesystem, process, credential and session isolation before real multi-user execution. |
| Six harnesses expose different protocols | Capability matrix, fixture contracts and per-harness adapters; explicit unsupported states. |
| Autonomous tools have external side effects | Identity and connection containment, deadlines, visible failures and no automatic replay of ambiguous side effects. Action-level controls remain later work. |
| Schedule restart duplicates work | Durable occurrence keys, leases, transaction boundaries, restart tests and reconciliation states. |
| Shared bots leak learning | Scoped reads/writes, no automatic promotion of private knowledge, deletion and cross-user adversarial fixtures. |
| Snapshot leaks tool handles or paths | Explicit safe content schema and immutable publication storage; no live-resource resolution in viewer. |
| Self-edits or chat setup overwrite concurrent changes | Shared form/chat services, target authorization, base version/hash checks, exact diff approval and future-run-only application. |
| Shared bot inherits someone else's onboarding | Actor/bot/configuration-binding evidence, explicit satisfaction and dispatch-time access/revocation checks. |
| Kanban drifts from execution | One source-linked attention projection; read/resolve/approve/cancel are distinct operations. |
| Browser/computer login leaks or concurrent input | Owner-bound profiles/screens, exclusive input leases, observation suppression during secure takeover and explicit hand-back. |
| Visual workflow repeats uncertain actions after restart | Pinned graph/step versions, durable claims, retained partial results and explicit reconciliation before a new attempt. |
| Larger tasks overwhelm a small model | One RFC per assignment; bounded paths, concrete tests, prerequisite handoffs and escalation rules. Split before work if scope exceeds a focused session. |

## Approval and change policy

RFC-069/070 retain chat ownership fixes; RFC-071–082 add the user-approved management and execution scope. Existing IDs remain stable. Follow the root index's explicit execution order, not a numeric filename sort.

The v1 scope change supersedes the earlier deferral of visual workflows and browser/computer use. Only the app marketplace, team-map canvas, external notifications and configurable per-action permissions remain deferred among those discussed features. Do not reinterpret technical backend research as permission to omit a required v1 capability.

This is a documentation deliverable, not approval to implement every proposal immediately. Product scope is confirmed; specific schemas, routes, auth changes, dependencies and external services require the repository's approval gates. Technical decisions must be recorded by their owning RFC and linked in the handoff. If a decision changes confirmed behavior, ask the user and update intent/index/dependents together. Do not silently drop a required harness or call a fixture implementation production-ready.
