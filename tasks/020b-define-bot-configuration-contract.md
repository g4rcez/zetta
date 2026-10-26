# RFC-020b: Pure bot configuration contract

Status: pure implementation accepted after [coordinator independent review](../docs/reviews/bot-contract-020b-review.md),2026-10-22. Parent020 remains incomplete. Approved source slice follows [020a](020a-design-versioned-bot-configuration.md) and the [bot configuration decision](../docs/decisions/bot-configuration.md). Coordinator separately authorized the model-selector correction after reproducing rejection of dotted model IDs.

## Scope and exported contract

Owned product paths: apps/server/src/modules/bots/bot-contract.ts, bot-canonical.ts and their two focused tests. No existing product file was edited. This task and unique bot-020b evidence complete the owned scope.

bot-contract.ts exports BotContractError, BotDefinition, BotBinding, BotMutation, BotSummary, parseBotDefinition, parseBotBinding, parseBotMutation and projectBotSummary. Definitions carry explicit version1/visibility, one of six native harness names, nullable provider/model, intentional personality/instructions, empty-only catalog references, sorted unique006 capability names and bounded api-key integration requirements. Configuration parsing conveys no supported/runtime-ready capability claim.

Bindings are immutable private structural snapshots with actor, bot, binding version and sorted unique requirement-key/connection/version selections. nativeProfile must be null and privateResources empty. Resource ownership, existence, requirement completeness, provider agreement and freshness remain future service obligations. No default shared account, readiness result, consent token or evidence issuer exists.

Eight closed mutation variants cover create_specialist, ensure_chief, edit_presentation, append_definition, change_visibility, archive, restore and update_bindings. They retain operation UUID and required version/revision CAS arguments; binding expectedVersion=null means absence. They contain no caller actor, approval or readiness flag. These are arguments, not applied transitions or human authorization. Chief creation requires private visibility. Specialist visibility is explicit in the normalized contract; a future human-facing form/service chooses the accepted team default before parsing.

bot-canonical.ts exports canonicalBotDefinition, decodeBotDefinition, fingerprintBotDefinition, canonicalBotBinding, decodeBotBinding, fingerprintBotBinding, canonicalBotMutation and decodeBotMutation. Canonical UTF-8 is a domain/version tuple containing the complete normalized closed object. Decoding re-parses and requires byte-for-byte re-encoding; hashes cover every accepted field. Summary projection copies only declared public fields after caller authorization and cannot derive canEdit itself.

Model selector is a dedicated1..128 ASCII string: `[A-Za-z0-9][A-Za-z0-9._:/-]*`, excluding `://` and exact slash-delimited `.`/`..` segments. This supports dotted, provider-prefixed and colon-versioned opaque model selectors while denying URLs, traversal, controls, leading options and absolute paths. It never grants URL/path/command authority. Bot/resource IDs retain existing009 UUID/ASCII schemas. Future native009 integration must preserve real model selectors through its separately reviewed producer contract; this slice does not change fixture-only009 admission.

## Completion record

- Focused final command: `bun --no-env-file test apps/server/src/modules/bots/bot-contract.test.ts apps/server/src/modules/bots/bot-canonical.test.ts apps/server/src/modules/runtime/run-contract.test.ts` —145 pass,0 fail,256 assertions. The two new test files contribute132 tests/165 assertions.
- Initial missing-module red and semantic-field omission mutation are retained. A separate model-selector red has5 failures, including four rejected valid selectors and an accepted leading-option selector; the corrected parser passes all19 selector scenarios.
- Strict installed TypeScript6.0.3 succeeds for four product/test files and both evidence drivers. LSP reports no diagnostics on all four source paths; changed model files were rechecked. Native Bun pure oracle records13 true checks and explicit false ownership/readiness/native-execution claims.
- The optional skill audit script failed to resolve its TypeScript dependency from both root and server working directories; no install was attempted and no audit pass is claimed. Strict compiler/LSP results are independent and recorded.
- All runtime values are copied/frozen through readonly schemas. Unsupported slots, malformed Unicode, byte overflow, duplicate keys, unknown fields, altered canonical bytes and invalid CAS arguments fail with fixed BotContractError codes without input/cause metadata.

Evidence and exact commands: [bot-020b report](../.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/bot-020b/report.md). Source hashes and bounded line counts are retained there.

Next consumer: a separately assigned020c schema design may use these value types/canonical encodings; future020d must enforce actual issued actors, membership/owner visibility, resource queries, transactional CAS and same-operation repair. Epoch, normalized identity locking, actual native evidence, human satisfaction, same-transaction009 producer and010 action gates remain blocked until separately implemented/proved. No DB/schema, routes/UI, provider/credential, environment, VM/service, package or Git work occurred; no runtime resources require cleanup.
