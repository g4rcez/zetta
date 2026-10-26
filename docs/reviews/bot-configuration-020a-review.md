# RFC-020a independent design review

Verdict: **CLEAR for design acceptance and a separately assigned pure020b contract slice.** No blocking defect in the reviewed design. This is not clearance for team services, schema application, readiness, native execution or public producers. Reviewed2026-10-22; only this review artifact was written.

Reviewed [bot configuration proposal](../decisions/bot-configuration.md), [020a](../../tasks/020a-design-versioned-bot-configuration.md), [020](../../tasks/020-implement-versioned-bot-configuration.md), [021](../../tasks/021-build-bot-onboarding-and-settings.md) and [ownership](../decisions/ownership.md). Source facts below were read directly, rather than inferred from another review or the author's evidence.

## Findings and disposition

| Scenario | Source/design observation | Result |
| --- | --- | --- |
| B/admin substitutes A or private resource | access.ts:9,43–49,57–59 issues actors through a private WeakSet and denies structural/foreign ownership. ADR53 preserves issued actors, fresh membership and owner-only writes; ADR43–47 limits visible DTO/history and isolates bindings/readiness. | CLEAR design; actual A/B/admin service proof remains required. |
| Public specialist versus private history | ADR9,33,39–45 defaults specialists to team, keeps chiefs private/unique, requires human audience submission, creates a new publication version and denies old private history/diffs. B's own run snapshot grants no continuing bot access. | CLEAR. |
| Concurrent edit or lost acknowledgement | ADR41,53–55 separates presentation CAS from semantic/lifecycle revision, rejects exhaustion, gives exact canonical operation replay priority over stale-version rejection after authorization, and repairs unknown commit using the same operation ID. | CLEAR; no new mutation on replay is permitted. |
| Oversized or unsupported configuration | ADR27–35 bounds text/canonical bytes/collections, rejects unknown keys and unsupported resource backends, and requires aggregate009 caps. run-contract.ts:17,44–49 enforces65536 prompt bytes,98304 canonical bytes and fixture-only execution today. | CLEAR; accepted native configuration is inert data, not admitted work. |
| A ready, B unready; fixture/native flag forgery | ADR59–69 separates current technical eligibility, trusted actual native response and explicit correlated human confirmation, pins actor/bot-owner epochs and all meaningful revisions, rejects fixture/uncertain responses, consumes a fresh challenge and never accepts model consent. | CLEAR; no successful native or human-consent proof is claimed. |
| Removal and re-enrollment | schema/identity.ts:6–23 has status/times but no epoch; enrollment.ts:153–159 and admin-lifecycle.ts:50–60 reactivate the persistent row without an epoch. ADR61 explicitly proposes a non-reused activation UUID extension and gates readiness on its implementation/race proof. | CLEAR proposal; timestamps are not treated as sufficient provenance. |
| Public or scheduled producer bypass | runs.ts:52–94 owns a separate transaction and inserts supplied fixture identifiers; it is not a transaction-bound bot/conversation/readiness producer. ADR81–83 requires real resource queries and a reviewed same-transaction009 entry point before public use, plus010 action rechecks. | CLEAR; schedules/delegation/workflows remain gated on their own stored provenance. |
| Setup authority expansion | ADR63 restricts setup transitively to bounded conversation/testing and inert proposals, at most8 human turns/30minutes with stricter per-attempt limits. ADR65–67 requires successful actual response and matching human confirmation. | CLEAR; setup origin cannot confer ordinary/tool/delegation authority. |

## Identity locking: verified cycle and bounded prerequisite

The original explicit cycle is real as a source-level schedule. enrollment.ts:62–69 locks installation, then active-admin membership A, then the subject auth account. acceptInvitation subsequently locks subject membership B at139–140. The proposed team read/use locks sorted memberships; with B lexically before A it can hold B and wait for A while enrollment holds A and waits for B. The existing active-member rejection is at142, after the blocking lock, so an already-active B does not remove this schedule. This is a source-derived schedule, not an executed PostgreSQL reproduction.

admin-lifecycle.ts:116–121 already sorts auth accounts and then memberships. ADR73–77 explicitly acknowledges the mismatch and selects a separate005 normalization: installation, required sorted accounts, required sorted memberships, then invitation/session/audit effects, with authorization rechecked under locks. It does not claim current code is compatible or authorize its incidental rewrite. This resolves the stated explicit-member ordering conflict at the design level. The future proof must observe blocking in both orders and lexical permutations. No production membership-removal method was found in the inspected identity exports/routes; the ADR's removal-path discussion is a required future integration, not evidence that cancellation/removal wiring already exists.

**Required integration gate, not a pure020b blocker:** preserve ADR77's full implicit FK/session-lock audit. There is a concrete additional edge to test: connections/store.ts:18–21,73 takes membership FOR UPDATE before creating a connection, whose owner FK targets auth user at schema/connections.ts:50. Admin replacement takes auth user FOR UPDATE before membership at admin-lifecycle.ts:38–45,118–121. An FK key-share request after membership can therefore oppose the admin user-row lock. PostgreSQL documents that FOR UPDATE conflicts with FOR KEY SHARE; weaker compatible modes need deliberate review, not an untested substitution. [PostgreSQL18 row-lock conflicts](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS)

That schedule is inferred from inspected code/schema and lock semantics; no actual race was run here. The normalization child must select a compatible account lock mode/order while preserving authorization/session guarantees and prove007 connection creation versus005 replacement/enrollment with independent connections. New020 FKs must be included. Sorting explicit members alone must never be reported as full graph proof. The design already keeps this audit and all team services gated, so no design revision is required for this CLEAR verdict.

## What020b may implement independently

A bounded pure slice may implement closed inert definition/binding shapes, exact canonical arguments, safe DTO parsers and meaningful boundary/CAS-input tests after root assignment. Reuse006's identifier grammar and capability names; represent the six native harness choices without reporting them supported. Keep unimplemented catalog/private/native slots empty or explicitly denied. Require version bounds, UTF-8/well-formed text and canonical byte limits, unknown-field rejection, independent actor-binding identity, and exact operation arguments. No fake actor issuer, ready flag, native response issuer, consent authority, database transaction, resource lookup or producer belongs in that slice.

The epoch and identity normalization prerequisites block service/readiness integration, not these pure parsers. Concrete020b export/file ownership and any missing normalized field representation must be supplied by its bounded assignment; this review does not invent production implementations for those future contracts. Schema generation, full version retention constraints, services, browser behavior and native confirmation each retain their own gates.

## Evidence and verification boundary

Inspection invocation: `nl -ba` on the source paths listed below; `rg -n 'status: "removed"|set\(\{.*removed|removeMembership|removeMember' apps/server/src packages/db/src` returned no matching production removal implementation. `rg -n` over connection FK/lock definitions located the additional integration edge. `shasum -a 256` over each listed path produced this exact source receipt. The binary review outcomes are: design blockers found=false; pure020b independently assignable=true; actual DB/browser/native proof run=false; runtime readiness granted=false. This document is the captured artifact for those inspection outcomes.

```text
5762e10ebf62952c8e54e9cca374b7bd201f008c538221fa931498362f5a5e34  docs/decisions/bot-configuration.md
3e748e6fd41c713ea8ce2861be6c7818cdd46a762880e8fd75cc98c52879ff8b  tasks/020a-design-versioned-bot-configuration.md
185c682e457b23a4478c12b9cdab5711a04a17d155d19c219818c2487b37dd00  tasks/020-implement-versioned-bot-configuration.md
8ecb80a7239ac8c115ff69d3305a592584ab9c27a7f233802047f7bed714e959  tasks/021-build-bot-onboarding-and-settings.md
5f9a2585323b76dfcb4c58e98b1ac625eb1e5a0c92e9f4d9343ca80cd2fc52a6  docs/decisions/ownership.md
0bbebd5d68bc6edae39491bd8cf952bc9762b57b22d1d3f57d15d7f65d018e40  apps/server/src/modules/identity/access.ts
0cbc222f81eecf28679d4a0dd8b33366992c335d6112cab8ba7f821309c71b24  apps/server/src/modules/identity/enrollment.ts
092a726a4f74f6573f5744d2e237a1b065a88332b522193534661714bbbeb052  apps/server/src/modules/identity/admin-lifecycle.ts
e09ab8133de32ce4d70df5bf9776eaea9903e3c8845ea4644615bff33c231a95  packages/db/src/schema/identity.ts
a165b61b221c3ee5644f750cd7dd1486e70344c227aff3deafc9fb73c2004d25  apps/server/src/modules/runtime/run-contract.ts
dfa9c25404e7d1779b6b3b30e9fde561420fd2afa38a917ab43a82307b3f0c87  apps/server/src/modules/runtime/runs.ts
e1d2d694cf4a812946395b7ef714739d800da44966755efa42d0c31f6ab1e0a7  apps/server/src/modules/runtime/harness.ts
72b8d47db055ee5ce4d293ca0d3599902d9cb0a8f7fa8bc480739d567d37d5eb  docs/decisions/durable-dispatch.md
99d19f64891647931e9971bd27dd0c5d3147e09867a1f8a702e27454886af1fa  apps/server/src/modules/connections/store.ts
3bd54ce01d5d5936c1cf70541e977c13a09baf897bd4b49d9b33a5b6f9ee7ea3  packages/db/src/schema/connections.ts
```

Final local artifact check used installed `bun -e` with node:fs/node:crypto/node:path: extract the15 hash/path rows above, recompute SHA256 for each, and resolve every relative Markdown link from this review directory. Captured output: `{"sourceHashesMatched":15,"localLinksResolved":5,"reviewPresent":true,"designOnly":true}`. This checks review/source integrity only.

No source mutation test is applicable: this assignment reviewed a design and changed no executable code. No test pass, LSP result, database enforcement, deployed privacy, deadlock freedom, browser behavior or successful native response is claimed. No schema, package, environment, credential, provider, VM, service or Git operation was performed. No runtime resource was created; the review is retained and no runtime cleanup is claimed.
