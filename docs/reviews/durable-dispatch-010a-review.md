# RFC-010a independent design review

codeQualityStatus: CLEAR
recommendation: APPROVE for the bounded design and next source-contract assignment
blockers: [] for design acceptance
Operational acceptance: NOT established.

## Findings by severity

CRITICAL: none. HIGH: none. MEDIUM: none. LOW: none.

## Reviewed authority and storage boundaries

Read full durable-dispatch ADR,010a task/evidence and accepted007 connection,009 run/store and008 supervisor/journal handoffs. Rechecked actual005 WeakSet provenance and007 membership/connection/key-check ordering. The proposal is a design; no API, grant table, execution-authority issuer or transport is assumed implemented.

The separate ExecutionAuthority proposal does not forge ActiveActor or grant authority from a structural owner tuple. It must be issued only inside a trusted transaction factory from locked current rows, verify supported producer provenance and active membership, and expire when that callback ends. The module-private verifier/constructor ports and lifetime mechanics are concrete010b proof requirements. A transaction token alone is not permission to send after commit: only the newly committed action's private once-delivery command can cross that boundary. No public callback or transport selection is accepted.

Three proposed tables have distinct purposes: a capacity mutex/policy, one immutable claim per attempt and single-use grants. Runs/attempts remain the sole runnable queue and existing attempt lease/generation remain authoritative. Claim identity copies require locked correspondence and cannot become a second renewable lease. Canonical fixed-array action encoding includes owner/run/attempt/generation/lease/action, launcher/policy/receipt, kind/sequence, nullable pinned credential/version, expiry and closed descriptor. Input binds exact byte digest/count/EOF; exact canonical equality remains authoritative. No secret bytes enter these records.

Fixture-only activation/input and empty credential bindings make the next foundation startable before native transports exist. At most one pinned key per later action is explicitly gated; tool, scheduled, multi-key and native/GUI behavior are not silently admitted. Budget intersections between009 and008 must deny unsupported promises before prepare rather than truncate.

## Lock graph and occupancy reasoning

The complete order gate→membership→sorted connections→key-check→runs→attempts→claims→grants is coherent with inspected007/009 source. Claim rows are now explicit in every receipt/resource/revision/release mutation. Candidate scanning is nonlocking; actual eligibility is rechecked after acquiring earlier locks. Optional SKIP LOCKED is applied only at the correct stage. No batch owner claims or late capacity acquisition.

Connection revoke/replace locks grants after its existing connection/key-check work and does not acquire run/attempt/claim afterward. A separate worker transaction consumes those facts in the forward order. Membership removal keeps its accepted identity prelude and then locks runtime rows; later integration must audit all multi-membership paths and retain no runtime locks while acquiring another membership. These are not claims that current removal code already performs this integration.

Count-all-unreleased claims under the occupancy-increase gate is a sound conservative design under its stated invariants. Every increase serializes; one READ COMMITTED aggregate statement gives consistent global/per-actor counts. Concurrent unreleased/uncommitted-release rows remain counted, while a committed release can disappear only after authoritative cleanup. Ungated monotonic release can therefore cause stale overcount/denial, not unsafe undercount. This depends on never clearing releasedAt, transferring owner/installation, deleting unreleased claims or otherwise increasing occupancy outside gated insertion.010c must encode and prove these restrictions. Expiry, logical completion and missing receipts do not release capacity.

## Once-only effects and recovery

Prepare intent and issued action state commit before IO. Unknown commit sends nothing; repair uses the same pre-generated operation identity and returns status, not a new command. A crash after confirmed admission but before send may sacrifice availability and must not replay. Unknown prepare/input/start delivery stays occupied/quarantined even if later persistence fails. Stable operation IDs cannot be replaced to escape uncertainty.

For the future credential extension, checks/decrypt occur in the ordered bounded transaction; only confirmed issuance permits the same live invocation to call its construction-bound transport once, with owned buffer wiped in finally. The post-commit revoke/delivery race is accurately identified with issuance as linearization. Later transport retention/disposal and byte-copy behavior require actual proof; the design makes no recall guarantee.

Removal denies new execution/grants and atomically cancels eligible queued work/active admission before releasing membership. Safety reconciliation after removal is limited to exact stop/cleanup facts, never decrypt/renew/new input. Re-enrollment must not revive queued work; the atomic cancellation integration is required for fixtures, while membership-epoch/scheduled provenance remains a separately reviewed extension.

Cancellation precedence follows009: cancellation committed first prevents terminal success; completed-first remains terminal. Backend cancellation reasons require an explicit extension rather than pretending owner_requested. Resource cleanup and external-effect uncertainty remain separate. Lost prepare response with no receipt requires the explicitly missing authenticated exact-attempt lookup/inventory handshake; until then keep unknown occupancy. No invented endpoint or automatic resend is assumed.

008d alignment specifies a short installation allocation/inventory lock and per-receipt lifetime writer ownership, no broker or queue. No DB transaction spans launcher/file locking, and no launcher-held lock may call back into DB acquisition. Busy receipt cannot be adopted or treated absent. The actual authenticated command/authorization handoff must respect these boundaries when implemented.

## Startable next slice and required gates

010b can implement only closed action/state/capacity contracts and the private transaction-authority seam with controlled trusted constructor dependencies. Tests must prove structural forgery, cross-factory/cross-transaction substitution, use after callback completion (including rejected/aborted callbacks), exact all-field canonical changes and no executable command on replay. No claim loop, crypto resolver or real transport belongs in that slice.

010c owns capacity/claim/grant schema through one migration writer plus real PG checks: two workers/one attempt, two-owner limits, unknown commit, terminal-stopping occupancy, removal/renewal order and monotonic release. Shared identity/007 changes must be separately serialized.010d initially admits only secret-free fixture actions; native credential issue-and-deliver is a later bounded extension.010e waits for accepted008 operational transport/deadline/locking and009 store proof.

Missing-receipt lookup, actual transaction-token invalidation, membership removal/re-enrollment wiring, bound transport delivery/disposal, provisioning and fault-injected DB/launcher proof are mandatory operational gates. They do not prevent approval of this fixture-only source design, and this review marks none of them passing.

## Verification and skill perspective

Documentation/source inspection only. Independently checked all six local document links resolve and recomputed current hashes. Writer verify.ts/report is a source/link inventory, not implementation or concurrency evidence; no test-count confidence is attributed to it. No product source, DB, filesystem backend, provider, service, install or Git mutation performed.

Previously loaded programming/TypeScript,remove-ai-slops and code-review perspectives applied. The design uses bounded records and private seams for specific authority/lifecycle responsibilities; it does not require an event platform, second queue, generic broker or new credential engine. Future source tests must exercise effects/authority and actual transactions rather than match ADR prose. No needless-framework blocker found.

Source SHA256:
- docs/decisions/durable-dispatch.md: 09b10f5215112a0fcebee178f0571365148d3ff9a16d3dcfe3c1e2e116cd5796
- tasks/010a-design-durable-dispatch.md: 19e17b1d604b46dc6f685b6b249a969b6984547ebeb9222b83ef4f825a9a2ee9

Evidence context: current G002a1/durable-dispatch-010a/report.md and verification.json. Parent010 remains incomplete.

