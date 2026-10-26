# RFC-020a: Design versioned bot configuration

- Parent: [RFC-020](020-implement-versioned-bot-configuration.md).
- Status: accepted design after independent CLEAR review and coordinator source inspection,2026-10-22.
- Owned paths: `docs/decisions/bot-configuration.md`, this task and unique020a evidence.
- Scope: no implementation, schema, routes, environment, database, native calls, UI or Git mutation.

## Contract handed off

[Decision proposal](../docs/decisions/bot-configuration.md) separates bot identity, immutable execution versions, actor-private binding versions and actor-scoped readiness. Default team specialists retain owner-only editing; the unique chief is private. Publication cannot expose private history or bindings. Cosmetic revision is distinct from semantic configuration/lifecycle revisions.

The proposal specifies bounds, normalized mutation replay/CAS, safe visible/private DTOs, lifecycle, reference provenance, forward lock order, actual-native-response plus human-confirmation requirements, and bounded children020b–020f. Forms and any-bot chat share authorization/versioned services. Public producers and action admission require real resource queries under the same transaction, not opaque IDs or client readiness flags.

## Acceptance and verification

- Design artifact covers approved ownership, actor-specific accounts, meaningful-change invalidation and human confirmation.
- Technical evaluation, native evidence and human consent remain separate; unsupported backends are blocked.
- Exact proposed fields/limits, mutation semantics, locks and actual PostgreSQL/browser/native proof scenarios are reviewable.
- Evidence records source lineage and local-link checks; those checks prove document integrity only.

## Completion record

Status: design accepted. [Independent CLEAR review](../docs/reviews/bot-configuration-020a-review.md) and coordinator source inspection permit a separately assigned pure020b slice. Team-service locking, epoch, native readiness and public producer integration remain gated. Parent020 is incomplete.

Evidence: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/bot-020a/`.

No tests, database, browser or real-harness scenarios were executed: this assignment produces an architecture proposal. The document names the future binary observables and integration gates rather than claiming those proofs. Existing accepted005/006/007/009 contracts and010's membership-epoch gate are reused; no future schema field is assumed to exist.

Next: independent design review; root resolves/accepts the bounded proposal, then may separately assign020b. Team read/use additionally requires the documented005 identity lock-order normalization and actual opposing-order race proof. Native readiness requires reviewed membership non-resurrection, private resource/native-profile provenance, real adapter evidence and010 admission integration. No child implementation should proceed on this document's status alone.
