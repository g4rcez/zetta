# Integration decisions and delivery gates

[Wiki home](../README.md) · [System overview](system-overview.md)

> **Status: required capabilities with unresolved technical decisions.** A named integration is not evidence of installed support. This page identifies decision owners; implementation status remains in [TASKS.md](../../../TASKS.md).

## Required scope versus technical choice

| Capability | Confirmed requirement | Decision and evidence owner |
| --- | --- | --- |
| Harnesses | Pi, Codex, OMP, Claude Code, OpenCode, and Cursor | [RFC-012](../../../tasks/012-research-six-harness-compatibility.md): exact versions, headless interaction/events, login/model discovery, cancellation, state containment, and host-tool exposure. Adapters must not invent flags or hide unsupported capabilities. |
| Browser and computer use | Both required, with isolated user resources and secure takeover | [RFC-074](../../../tasks/074-select-required-browser-and-computer-backends.md): verify agent-browser or an approved equivalent and an actual CUA/native desktop path. Browser-only evidence cannot satisfy both. |
| Browser profile lifecycle | Dedicated or explicitly shared among the same user's bots | [RFC-075](../../../tasks/075-manage-scoped-browser-profiles.md): storage, ownership, exclusive use, revocation/reset, and recovery. |
| Browser and desktop actions | Bounded tools with safe outputs and owned cleanup | [RFC-076](../../../tasks/076-expose-isolated-browser-automation-tools.md), [RFC-077](../../../tasks/077-run-isolated-computer-use-sessions.md): actual backend probes, not fixture-only completion. |
| Human takeover | Secure login/MFA, exclusive input, explicit hand-back | [RFC-078](../../../tasks/078-provide-secure-takeover-and-hand-back.md): owner-bound access, sensitive-capture suppression, and honest reconnect/continuation behavior. |
| Persistent memory | Hermes-style facts, corrections, retrieval, and retention across sessions/restarts | [RFC-054](../../../tasks/054-select-hermes-memory-mechanism.md): identify upstream mechanism, license, reuse/compatibility approach, and data/deletion rules. Do not assume a hosted API or vector database. |
| Decisions | Integrate both Jev and Laya | [RFC-046](../../../tasks/046-identify-and-verify-jev-integration.md), [RFC-048](../../../tasks/048-identify-and-verify-laya-integration.md): product identity, protocol, auth, data egress, typed outputs, and failures. Missing identity is a blocker, not permission to invent an endpoint. |
| Connected apps and sources | User-owned access for the accepted initial source workflows | [RFC-042](../../../tasks/042-approve-mcp-and-source-connection-contract.md): MCP purpose, permissions/scopes, transports, source availability, and approved fallback. Not every app in the README requires a bespoke v1 connector. |
| Hooks | Context changes/redaction, stop, and owned background work | [RFC-051](../../../tasks/051-define-ordered-hook-contracts.md), [RFC-052](../../../tasks/052-execute-bounded-hooks-around-model-calls.md): ordered, bounded behavior that cannot change actor authority. |
| Visual workflows | Conditional graphs, durable execution, visual/accessible editing, and inspectable results | [RFC-079](../../../tasks/079-define-versioned-conditional-workflow-graphs.md): accept a bounded graph/node catalog. Full n8n parity and arbitrary embedded code are not implied. |
| Calendar | Calendar-oriented routine management | [RFC-040](../../../tasks/040-build-routine-calendar-and-editor.md): verify the requested `@g4rcez/components` API/dependency before installation. |

The six harnesses are all required; identical native feature sets are not assumed. Compatibility research must explain supported exposure paths or explicit blockers. No silent fallback to another user's credentials, an unapproved provider, or the unrestricted host desktop is acceptable.

## What would block release?

- Missing real support for a required harness, browser path, or computer-use path.
- Unproved user isolation, including native harness state and browser/desktop resources.
- Fixture-only onboarding or a missing explicit satisfaction step.
- Configuration paths that bypass authorization or have different form/chat semantics.
- Broken transitions between tasks, attention, repair, retained results, learning, and routines.
- Visual workflows without validated execution and inspectable branch/partial outcomes.
- Required compatibility, licensing, or data-egress decisions still unresolved.

[Recovery evidence](../../../tasks/065-document-and-verify-recovery-boundaries.md), [isolation evidence](../../../tasks/066-verify-cross-user-isolation-end-to-end.md), [journey evidence](../../../tasks/067-verify-representative-v1-user-workflows.md), and the [release gate](../../../tasks/068-gate-release-on-real-compatibility-and-readiness.md) own the final decision. A technically blocked requirement remains blocked until resolved or the user explicitly changes scope.

## Verification without accidental environment changes

Use the selected RFC's proposed focused checks only after its prerequisites and approvals are satisfied. Inspect the actual scripts before running them: the root `check` script writes formatting, and the plan records that web `check-types` invokes a build. Documentation validation does not need either.

Do not infer approval for installs, dependency/lockfile changes, schemas, routes/auth changes, builds, full suites, E2E, migrations, paid/provider calls, deployment, or real account probes from an RFC or this wiki. Record exact commands and skipped checks. Keep synthetic inputs separate from real compatibility evidence; never use production secrets as fixtures.

## Not required in this release

The confirmed exclusions remain marketplace, visual team-map canvas, external notifications, configurable per-action permissions, model training, billing/public SaaS tenancy, and a new native desktop client. These do not exclude local access enforcement, visual workflows, isolated computer use, or in-app attention.

For product risks rather than technical protocol decisions, use [product refinement](../product-refinement.md). For current development setup, consult [TECH.md](../../../TECH.md) and verify it against the manifests; this wiki does not introduce another installation runbook.
