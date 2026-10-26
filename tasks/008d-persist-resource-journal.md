# RFC-008d: Persist the protected resource journal

- **Parent:** [RFC-008](008-implement-isolated-process-supervision.md)
- **Status:** Design accepted after independent CLEAR review; bounded source children assigned separately. Operational proof remains incomplete.
- **Prerequisite:** Accepted [008c pure record/state core](008c-define-resource-journal-transitions.md).
- **Decision proposal:** [Protected launcher journal persistence](../docs/decisions/launch-journal-persistence.md).
- **Current ownership:** Only this task, the new decision document and unique evidence. No product source was edited.

## Proposed bounded outcome

A separately trusted Linux launcher uses a short installation lock for allocation/inventory and a permanent per-receipt file-descriptor flock held by its independent fixed runner. Private canonical records are bounded, closed-schema parsed and committed by staging write, file sync, rename, directory sync and readback. Any uncertain write poisons its owner; restart never replays pending effects. The protected root is the authority, so a lost application receipt response needs no second database/index lookup.

The selected helper is installed util-linux flock in descriptor-number form, with Bun retaining its FileHandle after the helper exits. Primary source inspection establishes that util-linux v2.41.3's normal descriptor path does not explicitly unlock. Actual Bun/Linux shared-descriptor and child-inheritance behavior remains unproved and gates readiness. Permanent lock inodes are never removed/replaced. Installation-to-receipt is the only nesting order; active receipt writers never need the global lock. Control hands off an inert record; the runner reloads cancellation/deadline after claiming it. Cleanup claims only after runner/children exit. No PID-age takeover, extra broker or macOS fallback is proposed.

## Acceptance before product code

- Independent review accepts the exact lock lifetime, protected-parent assumption, canonical disk format, poison/timeout behavior and deliberately conservative staging-file recovery.
- Coordinator accepts the five proposed implementation/test paths and current absence of effect execution, daemon integration or automatic repair.
- Linux provisioning remains separately gated; this design does not request or imply permission to create/start a VM, install dependencies or start services.

## Required implementation evidence

The decision's L1..L4, F1..F3, P1..P2 and R1..R2 scenarios are mandatory. Capture commands, binary booleans, exact runtime/binary/source hashes, cut-point receipts and cleanup for each. Red-first focused tests must exercise competing writers, post-helper lock retention, SIGKILL release without accidental child inheritance, symlink/hardlink/corrupt-record rejection, partial/error writes and crash cuts C0..C8. Reuse all accepted pure spec/recipe/journal tests; run strict TypeScript and LSP for the final changed source.

Use a disposable private owned root and synthetic records; tests never issue provider/daemon effects. An in-memory counter represents the point at which a future consumer could act. A macOS filesystem proof may establish only the filesystem operations it actually runs. Missing Linux lock/crash evidence is an explicit unfulfilled gate, never a skipped passing test or operational readiness claim. Power-loss/hardware durability is a separate deployment assumption/proof from SIGKILL.

## Current design evidence

[Independent review](../docs/reviews/journal-persistence-008d-review.md) is CLEAR for the corrected per-receipt ownership design. Coordinator accepted the same scope after correcting the original global-lock conflict. Implementation is split by actual responsibility:008d1 bounded codec/protected file commit primitives,008d2 Linux descriptor locks/cross-process proof,008d3 installation/per-receipt store. Each child retains a small explicit path boundary; no full five-path monolith or framework is required. No child may claim deployment readiness without all selected Linux capability and matching-surface proofs.

[Design verification report and primary-source inventory](../.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/runtime-008d-design/report.md).

This assignment researched and specified the protocol only. It did not run filesystem persistence experiments, Linux flock, process-crash tests, Docker, systemd, DB, provider calls, dependency installation, VM provisioning or Git mutation. Existing product source hashes were captured for scope verification. Implementation and operational evidence remain future work.
