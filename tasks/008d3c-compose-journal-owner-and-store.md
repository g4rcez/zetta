# RFC-008d3c: Compose journal event, owner and store

Status: source accepted after [coordinator independent review](../docs/reviews/journal-store-008d3c-review.md). Actual Linux store composition/crash proof remains008d3d.

Parent [store design](../docs/decisions/launch-journal-store.md); prerequisite [actual profile review](../docs/reviews/journal-profile-008d3b1-review.md).

Owned only runtime/journal-event.ts, journal-owner.ts, journal-store.ts, journal-owner.test.ts and journal-store.test.ts, this task and unique evidence. Frozen lock/layout/files/codec/transitions are unchanged. All modules remain below250 nonblank/noncomment lines.

parseJournalEvent copies/deep-freezes closed variants and nested authority/operation/fact fields before queuing. openJournalStore uses actual Linux profile/layout/locks/files, complete bounded inventory, one busy-layout+snapshot retry, attempt-key historical replay before fresh admission, exclusive permanent allocation and inert initial commit. claimReceipt transfers a real retained lock to openJournalOwner. apply validates current canonical bytes and idle staging, commits transitionJournal.record, discards effect and returns no runnable authority.

Each journal queue bounds32 outstanding calls with5second admission-time budget. An unstarted expired call is dropped; a started timeout poisons/rejects immediately but retains outstanding work until it settles. No late success/current-state publication after timeout or close. Explicit close seals immediately, rejects waiting calls and drains before resource release. Private fixed errors omit raw causes and contents.

Coordinator found and required reproduction of admission-poison cleanup closing healthy owners. The failing pure queue/lifecycle composition control is retained. Fixed createJournalStoreLifetime now separates admission cleanup from whole-store close: poisoned admission closes only its own layout; separately owned valid receipts continue. store.settled does not resolve while owners remain; explicit close seals owners synchronously and waits for every resource, including claims still initializing or another owner's close failure.

Constructor limitation accepted by coordinator: openJournalStore waits for initial-failure cleanup before rejecting. Stuck startup kernel I/O can therefore delay construction failure beyond5seconds; trusted parent-process supervision supplies the operational bound. No invented factory-attempt API. Returned store/owner calls have the specified5second response deadline while settled/close may wait for real I/O settlement.

Validation:73focused tests/223assertions across new boundary/queue/lifecycle tests and accepted journal/transition controls; strict TypeScript exit0 and all five source LSP checks clean. Real5second timeout exercised; unstarted-expiry control uses a restored test-only monotonic-clock observer. No fake Linux lock/profile, VM, filesystem composition, DB/provider/daemon/install/environment/Git operations. Pure lifecycle tests prove serialization/disposal logic, not real descriptor exclusion. Whole-store Linux read/write, simultaneous inventory/owner behavior, failure seams and C0..C8 remain008d3d gates.

Evidence: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/runtime-008d3c/`.
