# RFC-008c independent review

codeQualityStatus: CLEAR
recommendation: APPROVE
blockers: []
Scope: pure resource journal record/transition core and historical LaunchSpec parsing. No filesystem, Docker, systemd or operational acceptance.

## Findings by severity

CRITICAL: none. HIGH: none. MEDIUM: none. LOW: none.

## Contract assessment

Read launch-journal.ts, journal-transitions.ts, both focused tests, parseStoredLaunchSpec addition, accepted supervisor ADR,008c task and full evidence/native proof.

The strict historical parser reconstructs frozen spec/policy through their existing schemas, checks trusted installation/image/policy and optional receipt, recomputes spec/recipe/ownership identities and requires generated name/unit formats. State checks couple operation sequence, pending/latest acknowledgment, full container ID, fact digest, input metadata, terminal and cleanup fields. A container ID without an acknowledged ownership operation is rejected. Historical parsing deliberately omits fresh-clock admission; construction still calls parseLaunchSpec. Loading an old record grants neither execution nor renewed expiry.

Unkeyed digests detect inconsistent identity/corruption, not authentic hostile-host rewrites. The trusted private storage boundary is explicit. Coherently forged trusted records and arbitrary JavaScript casts are not capabilities defended by this pure module;008d must authenticate/restrict persistence and parse every loaded record. transitionJournal consumes typed internal records/backend facts, not raw HTTP events.

Before a new effect, begin returns a new immutable record with pending exact operation ID/type/sequence and a separate effect. The input remains unchanged. The consumer must serialize and durably commit this draft before executing; returning it does not claim that any write occurred. Repeating retained pending/latest operation is inert, differing same-ID operation conflicts, and older sequences fail closed. Full receipt/attempt/lease/fence precede transition work. Acknowledgments also require exact full container ID/name/label/recipe identity, correct operation ID/sequence and expected fact type.

Unknown outcomes retain the pending operation and close admission with sticky uncertainty/cancellation. Absence does not settle an operation or authorize retry. Late affirmative acknowledgments can establish exact ownership and progress cleanup, but do not reopen activation/input. New stop/remove effects cannot bypass an unsettled pending operation. A late stop acknowledgment confirms process_stopped with cleanup pending; only exact removal confirms cleanup. Unsubmitted intent alone can become not_started/cleanup-confirmed. No journal transition claims logical run success.

Input receipt/sequence is the identity boundary, with ID bound to that admission. Metadata is copied/frozen before returning. Next sequence, positive non-EOF size, max frame/aggregate and EOF closure are enforced; bytes are charged on admission once, not acknowledgment. Unknown delivery cannot resend. The bounded last/pending history intentionally rejects old sequences rather than storing an unbounded receipt ledger. Actual byte validation/forwarding remains the backend's responsibility.

## Independent verification

All exit0:
- bun --no-env-file test apps/server/src/modules/runtime/launch-spec.test.ts apps/server/src/modules/runtime/launch-recipe.test.ts apps/server/src/modules/runtime/launch-journal.test.ts apps/server/src/modules/runtime/journal-transitions.test.ts: 121 pass,0 fail,235 assertions.
- Exact strict no-emit invocation from runtime-008c/report.md, including native proof: zero diagnostics.
- bun --no-env-file .omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/runtime-008c/verify-pure-journal.ts: all nine named checks true; daemonEffectsIssued=false,durableWritesClaimed=false.
- Recomputed all five source hashes; exact matches below.

Writer's LSP receipts are not independently rerun; strict diagnostics were. Tests invoke the actual pure functions and include positive controls, changed identity/fact rejections, late unknown acknowledgments, input accounting, cleanup separation, immutability and historical roundtrips. A fixed fixture acknowledgment is only a synthetic backend fact; it is not proof of daemon completion.

Programming, TypeScript, remove-ai-slops and code-review perspectives applied. The finite parser checks protect a persisted boundary; the two modules separate record validation from transitions without introducing a generic queue/reconciliation framework. No deletion-only/prose test, needless normalization, production type escape or unsupported success claim warrants a finding.

## Required next008d handoff

Review the persistence/locking design before implementation: protected root/private modes, no symlink traversal, exclusive single-writer ownership, atomic write/file-fsync/rename/directory-fsync and crash receipts. Persist drafts before effects and acknowledgments before replies; on recovery never execute a loaded pending effect. Keep unknown submission/response quarantined until authoritative operation settlement. Trusted Docker adapter facts must verify actual exact ownership/configuration and tree stop/removal; no caller boolean or single empty query substitutes for settlement. Clock confidence and independent deadline enforcement remain separate operational gates.

Add actual crash/failure proof at the filesystem and daemon boundaries when those adapters exist. HTTP authentication/strict event decoding, fresh app authorization, image bootstrap, actual byte transport, Linux/systemd support and containment are not certified by this review. No filesystem writer, DB, provider or real resource was started here.

## Source identity

- launch-spec.ts: 9816acd2da62b0a9345bcdf599f343b94a7a28e2179e465985fe7f1add2715b8
- launch-journal.ts: d0e13849973fcb3c0b4d5fe264a4f5602ef066add78dc24169eb61969a5584a2
- journal-transitions.ts: f2dfbbcccb9b7c433246a5e086d1cc0c643d12334e7313054b279112ce6cef0a
- launch-journal.test.ts: c2e4c16152824cbaf185b7f4fcf4bb5d1c0a15629c850c4d091290d91091e419
- journal-transitions.test.ts: a4af0f9958a59fd6b7de3718f8aa41b731a4e23d038b8cf8c367ba9c8fe77018

Evidence: current G002a1/runtime-008c/report.md, tests.log, strict.log and verify-pure-journal.ts/native-pure.log. This scoped approval does not complete parent008 or supersede unrelated review lanes.

