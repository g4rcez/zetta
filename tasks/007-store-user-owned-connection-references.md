# RFC-007: Store user-owned connection references

- **Module:** Connections
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-002](002-prove-multi-user-execution-isolation.md), [RFC-005](005-enforce-actor-and-resource-access-boundaries.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Persist external account metadata and resolve credentials only in the owning user execution scope.

## Non-goals

No marketplace, new OAuth provider, shared global API key fallback or plaintext secret persistence.

## Source anchors and planned changes

- `packages/db/src/schema/connections.ts (new)`
- `apps/server/src/modules/connections/ (new)`
- `apps/server/src/services.ts`
- `apps/server/.env.schema`

## Contract and implementation steps

1. Approve schema and secret-store strategy from RFC-002; retain only safe metadata in API responses and opaque credential references elsewhere.
2. Implement owner-scoped create/list/revoke and execution-only resolution; distinguish model/harness accounts from application connections.
3. Version bindings and make revoked/expired credentials fail clearly without falling back to server/admin credentials.

## Acceptance criteria

- [ ] A cannot list, resolve, bind or revoke B connections; shared bot definitions store references/requirements, not another user secret.
- [ ] Revocation prevents new resolution, and errors/logs/serialized DTOs contain no credentials.
- [ ] Restart preserves valid references under the approved storage design, while absent key material fails closed.

## Verification

Proposed command: `bun test apps/server/src/modules/connections/store.test.ts`. Use fake secret material, A/B access, revoked references, missing key material and serialization assertions; real secret-store checks require approval.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Export the described module behavior with focused tests and a short contract handoff for dependent RFCs. Do not leave mock success paths in production code.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Accepted children: [007a design](007a-select-connection-secret-storage.md), [007b crypto](007b-implement-connection-secret-crypto.md), [007c1 schema](007c1-define-connection-storage-schema.md), [007c1a actualSQL](007c1a-verify-connection-schema.md), [007c2 store](007c2-implement-connection-store.md), [007c2a buffer/seam correction](007c2a-harden-secret-input-and-nonce-proof-seam.md) and [007c3 actual service proof](007c3-verify-connection-store.md). Independent reviews CLEAR/APPROVE; root independently63schema scenarios and19store scenarios,66focusedtests159assertions, strict diagnostics/native allocation proof and exact cleanup pass. The store exposes metadata create/list/replace/revoke only, with owner-scoped membership locks, exact MAC receipts, retained encrypted versions/nonces, startup key-check and bounded collisions/capacity.

Accepted storage contracts supply RFC008's secret-free prerequisite. Full execution-only resolution, grants, readiness invalidation and delivery stay pending until008/010 integration; no second grant engine is introduced here. Actual proof uses controlled sessions, same-database fresh factories, post-real-commit wrapper faults and a synthetic near-cap counter, with those limits explicit in007c3. Native profiles remain unsupported pending their own backend/storage proof. Environment/composition/public connection routes, production custody/backup/rekey and actual native/provider access remain unverified; parent007 remains incomplete. No plaintext persistence, global credential fallback or actual product connection is claimed.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Sealed connection store is wired into the product: list/create/revoke routes, per-user bot bindings, execution-time resolution that fails closed (revoked/expired/foreign/missing), no secret in any response, missing key disables connections visibly.

Evidence: apps/server/src/modules/connections/service.ts, routes.ts, store.ts (resolveForExecution); connections.service.integration.test.ts.
