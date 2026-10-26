# RFC-009a: Design durable run and attempt storage

- Parent: [RFC-009](009-persist-run-lifecycle-and-idempotency.md); root status remains coordinator-owned and incomplete.
- Status: done for bounded design; root accepts independent CLEAR/APPROVE review and separately authorizes009b1 offline schema and009b2 pure contract/state. Parent009 remains incomplete.
- Scope: durable identity/input, owner request deduplication, lifecycle/uncertainty, cancellation CAS and later consumer boundaries.

## Completion record

Read RFC-009/010/011, the actual006 harness and005 access contracts,007 connection/ownership ADRs,008 supervisor ADR, installed Drizzle declarations and current schema/query patterns. Proposed [durable-runs ADR](../docs/decisions/durable-runs.md) records exact trusted request/DTO/result shapes, immutable run versus append-only attempt identity, lease/fence boundaries, private restart input, lock ordering, cancellation races and explicit retry limits.

Only fixture producers may use the initial store; missing bot/conversation/config producers are mandatory later authorization gates, not invented FKs or public submit readiness. Input includes no raw connection credentials; opaque connection references require later pinned version resolution. Terminal logical status never proves stop or no effect. RFC-010 owns grants/claims and actual capacity;011/025 own replay/retention/materialization.

Next bounded children009b/009c/009d are proposed in the ADR, each at most five product/proof files plus focused tests/generated migration as specified. One migration writer; no implementation assigned by this document. Root must accept schema and semantics first. Unit state tests are immediately feasible after authorization; actual transactional proof needs the later approved disposable DB scenario. Native compatibility remains a separate proof.

Validation: read-only installed source inspection, source hashes, local-link and required-contract checks captured in the [009a evidence report](../.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/durable-runs-009a/report.md). No code tests, LSP, migration, service/container, provider, environment or Git mutation was run for this documentation-only task. No production behavior is claimed.
