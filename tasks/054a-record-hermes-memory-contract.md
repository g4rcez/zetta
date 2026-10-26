# RFC-054a: Record Hermes memory semantics and port proposal

- **Parent:** [RFC-054](054-select-hermes-memory-mechanism.md); root-index row remains authoritative and incomplete.
- **Status:** Review, 2026-10-22; bounded research complete pending policy acceptance.
- **Type:** Research / decision input
- **Prerequisites:** [RFC-001](001-approve-domain-and-ownership-contracts.md) accepted ownership policy and [RFC-002](002-prove-multi-user-execution-isolation.md) completed isolation before operational acceptance. Consumers also need the scoped runtime/host-tool contracts.

## Scope and authority

Coordinator assigned this child and `docs/decisions/hermes-memory.md` under user's continued v1/read-only discovery authorization. Read parent054/consumer055, ownership/access and isolation handoffs, confirmed intent, source leads, existing database manifest and version-pinned first-party Hermes memory implementation. No schema/code/dependency/service changes or import of private memories.

## Goal and exported input

[Hermes-style memory proposal](../docs/decisions/hermes-memory.md) identifies NousResearch's built-in curated store at commit `41dfcf2c1bd7146d4ad46aea08b7dd007900602e` and its MIT license. It distinguishes frozen snapshots/bounded explicit writes from external providers/history search, compares reuse options and recommends existing PostgreSQL semantics with actor-scoped namespaces, optimistic revisions, durable receipts, provenance/deletion and six-harness bridges. This is a proposal, not an exported storage API or a connected Hermes service.

## Acceptance and verification

- [x] Exact upstream source/license and reused/local semantics recorded.
- [x] Two-user/shared-bot/chief/delegation/schedule/restart/conflict/forget scenarios and native memory boundaries defined.
- [x] Existing PostgreSQL dependency path compared with direct Hermes/Python/external-provider reuse.
- [ ] Scope/quotas/conflicts, native memory containment and physical retention/purge accepted; parent runtime prerequisites and real persistence/bridge proofs complete.

Check new document links/required sections and named source pins. No PostgreSQL test, model call, native memory tool or install belongs to this documentation-only research. Source reading does not prove operational isolation or memory persistence.

## Completion record

- **Status:** Review. Parent054 stays incomplete; source-backed proposal supplies concrete decisions for owner/coordinator review.
- **Approval:** Bounded early research authorized; no schema, runtime or dependency approval implied.
- **Changed paths:** This child and `docs/decisions/hermes-memory.md` only for the memory slice. No parent/index mutation.
- **Evidence:** GitHub connector retrieved pinned LICENSE, memory tool/store, provider/manager and session-search source. Public overview reconciled with newer source: internal replace differs from public tool acceptance; writes use locks/atomic replacement, but profiles still must not share a home. Existing `packages/db/package.json` confirms pg/Drizzle/Zod. Access date2026-10-22.
- **Focused checks:** Shared assertion exited 0: four files, 16 valid relative links, two parseable synthetic JSON envelopes, nine required sections; exact command in [046a](046a-identify-decision-products.md). Runtime/database/harness tests intentionally skipped.
- **Remaining decisions:** Accept PostgreSQL semantic port and logical scopes/quotas/optimistic revisions; approve deletion/backup/transcript retention and native-memory disable/containment per selected version. Actual six-harness round trips remain required, Cursor still lacks its target.
- **Next consumer:** Parent054 records acceptance; RFC-055 approves/implements schema and scoped persistence, later retrieval/learning modules consume the same store. No direct Hermes package, hosted endpoint, vector DB or current agent personal memory import is assumed.
