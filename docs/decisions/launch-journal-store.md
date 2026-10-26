# Launch journal store composition

Status: revised design accepted after [coordinator independent review](../reviews/journal-store-008d3a-review.md),2026-10-22. Design only. Extends [persistence](launch-journal-persistence.md) without changing the accepted record or transitions. No daemon effects, systemd transport, queue, index, environment setting or automatic repair. Only this acceptance status was added after the reviewed freeze.

## Evidence and boundary

Accepted exports exist: `createLaunchJournal`/`parseLaunchJournal` in launch-journal.ts; `transitionJournal` and JournalEvent in journal-transitions.ts; `encodeJournal`/`decodeJournal`/JOURNAL_BYTE_LIMIT in journal-codec.ts; `openJournalFiles` with read/commit/close in journal-files.ts; `parseJournalLockPolicy`/`beginJournalLock` in journal-lock.ts. These are actual names, not proposed adapters. File open/read currently requires exclusive receipt ownership; its private verifiedOpen/readBytes helpers are not exports.

The coordinator's retained runtime-008d2-vm-run1 outer-status and stdout show all eight Linux descriptor scenarios passed, normal exit0, settled streams, empty owned process group, and final zero-child/no-orphan cleanup. The selected tuple is Linux arm64 UID1000, Bun1.3.14 revision0d9b296af33f2b851fcbf4df3e9ec89751734ba4 and Ubuntu flock2.39.3 SHA256b991f23fbc6a3928a86977d87a6c4fd14acc44cfe90ce7cb8f5dcab4d8a49fbf. This author read those receipts; it did not independently rerun the VM. Descriptor capability is accepted for that tuple. Directory-sync, store crashes, hardware durability and systemd lifecycle are separate gates. Source support for2.41.3 does not prove an untested binary tuple.

## Concrete trusted API

Proposed TypeScript shapes below are internal launcher interfaces, not routes or serialized user commands. All construction data is copied/strictly validated; fixed errors contain no raw OS causes, paths or journal contents.

```ts
type StoreOptions = Readonly<{
  lock: Omit<JournalLockPolicy, "scope">;
  policy: FixtureLaunchPolicy;
}>;
type ReceiptSummary = Readonly<{
  receiptId: string;
  availability: "idle" | "busy";
  identityDigest: string;
  specDigest: string;
}>;
type JournalOwner = Readonly<{
  snapshot(): LaunchJournal; // immutable private launcher data, no application logging
  apply(event: unknown): Promise<LaunchJournal>; // strict internal-event parser, no public transport
  close(): Promise<void>; // seals immediately; drains before releasing locks
  settled: Promise<void>; // resolves only after all work and descriptor cleanup
}>;
type JournalStore = Readonly<{
  inventory(): Promise<readonly ReceiptSummary[]>;
  createIntent(spec: unknown, admission: LaunchAdmission): Promise<Readonly<{
    receiptId: string; disposition: "created" | "existing";
  }>>;
  claimReceipt(receiptId: string): Promise<JournalOwner>;
  close(): Promise<void>;
  settled: Promise<void>;
}>;
// Proposed factory; owns no lifetime installation lock.
// openJournalStore(options: StoreOptions): Promise<JournalStore>
```

Factory validates the pinned Linux policy and the actual filesystem profile described below, acquires admission briefly, validates root layout and canonical inventory, then releases it. Success means storage inspection completed; not application or systemd readiness. Empty root still needs preprovisioned admission lock. Construction never creates/adopts the installation root or its admission lock. No test platform override. Trusted construction-only I/O/cut-point observers may be supplied separately in tests; they are not parsed options.

The Linux factory must fail closed before admission if the actual filesystem profile cannot be established. In journal-layout.ts add an internal Linux-only verification operation over its retained, verified root directory descriptor: call node:fs/promises statfs on `/proc/self/fd/<fd>` (bigint result), require EXT-family magic0xef53, then resolve that exact descriptor’s bounded `/proc/self/fdinfo/<fd>` mnt_id against a bounded `/proc/self/mountinfo` snapshot. Require exactly one matching mount ID, filesystem type exactly ext4, a local block-device major/minor matching the root descriptor’s device, and a writable mount. EXT magic alone is insufficient because ext2/ext3 share it. Reject overlay/tmpfs/NFS/FUSE, missing/ambiguous mount records, malformed/oversize proc data and unsupported statfs. Use64KiB mountinfo and4KiB fdinfo caps with sentinel reads; parse kernel octal escapes rather than whitespace-decoding paths. Device locality is checked through the matching `/sys/dev/block/<major>:<minor>` kernel entry; absence denies capability. This establishes the mounted local ext4 profile, not physical persistence or hardware flush honesty.

Recheck retained/named root identity around this inspection and before each admission scan/allocation and receipt claim; receipt must match that root device. Recheck profile before each owner mutation as well. No caller-provided ext4Verified flag, arbitrary profile selector or test platform override. The profile probe is a required production gate distinct from generic layout primitives: platform-independent layout tests may exercise path/fsync behavior without constructing a Linux store. Add actual wrong-filesystem rejection on a separately approved tmpfs fixture to the Linux proof. Privileged remount/mount-namespace changes and dishonest storage remain outside the unprivileged launcher threat model; deployment still supplies documented persistent ext4 backing. Bun statfs/proc behavior on the pinned tuple must be demonstrated in008d3d, not inferred from typings.

createIntent parses historical syntax with parseStoredLaunchSpec, derives the recipe itself with expandFixtureRecipe, then takes admission and performs complete inventory. Idempotency key is installationId + spec.context.attemptId, NOT identityDigest (which includes the full spec). More than one record for that key is corruption. Existing key requires exact canonical spec and policy equality as well as both derived digests; changed actor/run/lease/fence/deadline/budgets conflicts. Identical expired/terminal/uncertain receipt returns existing inert ID; no fresh allocation or effect. Only a new key calls createLaunchJournal(recipe, admission), which applies fresh admission, before mkdir. Caller-supplied recipe hashes are never trusted. Admission must already originate from the trusted caller contract; storage does not mint an issued actor or verify live DB authority.

claimReceipt validates canonical lowercase UUID, acquires only its receipt lock, validates complete layout and loads the historical record. It creates no directory or lock, and returns no effect. A freshly claimed pending operation remains pending until an explicit recovery unknown event is committed. Before reconciliation, recovery must commit unknown for that exact pending operation, otherwise cancel(reason=recovery) for a nonterminal record. This policy belongs to the trusted recovery caller; mere claim/read never activates anything. Terminal data is inspectable and cannot be restarted.

The accepted transitionJournal accepts a typed JournalEvent but has NO closed runtime event parser. Add journal-event.ts with parseJournalEvent(raw: unknown): JournalEvent, using strict discriminated schemas for begin/ack/unknown/absent/cancel and strict nested owner/operation/fact fields. Reuse parseJournalOperation only for the operation semantics, not as a whole-event validator. Validate UUID/ID/digest/positive fence and safe timestamp/sequence bounds consistent with accepted transitions; preserve existing legal event behavior. Deep-copy/freeze the validated event before any await. Tests in journal-owner.test.ts cover every variant, unknown nested fields, mutable caller objects and payload-byte rejection. This parser is new implementation, not an existing export.

apply queues an owned immutable copy of the closed JournalEvent shape (including nested owner/operation/fact). Reject unknown fields, malformed values and bytes-bearing fields before queue insertion. It uses the actual current record when its turn starts, invokes transitionJournal, validates/canonicalizes the result, and discards JournalDraft.effect. Return only the committed LaunchJournal. No runnable token, callback or permission survives a delayed promise. Existing transition semantics, including owner identity, monotonic timestamps and replay behavior, stay unchanged. A semantic no-op still rereads/compares current canonical bytes and checks layout/lock; it cannot conceal record.next or a foreign rewrite. Later effect integration must separately serialize commit, fresh authority/deadline/cancel check, submission and fact persistence under this owner;008d3 supplies none of that integration.

## Layout and permanent allocation

Operator provisioning (outside normal store calls) creates protected ancestors, root0700 launcher-owned, and empty admission lock0600 nlink1 using exclusive creation. It opens/validates descriptors, fsyncs admission lock, fsyncs root, and fsyncs root's parent after initial root creation; newly created ancestor entries require their corresponding parent syncs. Receipt and root must be same local persistent ext4 filesystem. Existing files are validated, never chmod/chown/replaced to pass. Root/app/attempt UID separation remains mandatory deployment work.

Under admission, new allocation performs exactly:

1. Complete bounded inventory and idempotency check; reject a new key at1024 receipts. Construct fresh validated journal, canonicalize within16KiB before any mutation.
2. Exclusive mkdir of generated receipt UUID0700. Open directory O_DIRECTORY|O_NOFOLLOW; verify UID/mode/device/inode against root. Never adopt EEXIST.
3. Exclusively create empty .writer.lock O_CREAT|O_EXCL|O_NOFOLLOW|O_NONBLOCK0600; verify regular/nlink1/device/identity. fsync lock, observe close, fsync receipt directory, fsync root directory; recheck names/descriptors. Permanent lock inode is now published before the initial record.
4. Acquire that receipt's actual lock, consuming both ready and settled. No wait/retry on busy. Open accepted journal-files, commit(null, initial), recheck lock and layout. Close file handles, then receipt lock, then admission lock; observe every close before resolving receipt ID.

Only nesting is admission → receipt. Writers/close/recovery never acquire admission. On any failure after mkdir may have begun, return journal_durability_unknown, poison this store admission, retain all names and descriptors until work settles. Never undo mkdir, unlink lock/staging, or promote record.next. Incomplete allocation becomes a persistent inventory blocker even after restart. A close failure after a committed record also returns unknown; a later process may discover the inert record but the original caller receives no success.

## Inventory and live owners

Incremental opendir scan under admission: root permits only .admission.lock and up to1024 canonical UUID directories. Unexpected entry or receipt1025 denies admission; do not silently skip. Per receipt permit only .writer.lock, record.json and optional record.next. Use bounded directory iteration stopping on fourth entry. Every directory/file/lock has protected-path, no-symlink, exact-mode/UID/device/inode validation; no recursion or unbounded readdir. Retain at most1024 small summaries/identity keys; no retained index survives the call.

Try receipt lock nonblocking. Definite busy allows a NEW read-only snapshot helper, not unlocked openJournalFiles.commit access. Proposed `readJournalSnapshot(trustAndRoot)` reuses the bounded descriptor read/codec implementation via a narrow extraction in journal-files.ts, exposing read only. It opens verified record.json, caps16KiB+1, validates descriptor/name before and after. A concurrent rename is inventory_busy; retry snapshot once inside the overall five-second budget, then deny admission. Missing initial record, malformed canonical bytes or unstable paths deny admission. No snapshot is ownership authority.

For busy receipt, record.next presence is expected. Never read, delete, promote or call it corrupt; a bounded namespace scan may also race its creation/rename, so recheck once on instability. Validate any observed entry's safe type/mode without requiring staging to persist. The committed snapshot's immutable identity is sufficient for idempotency; state may change immediately afterward. For an acquired idle receipt, record.next in ANY state is recovery-required, even if record.json is valid or staging matches it. Missing record/lock or extra entries are recovery-required. Release receipt before continuing. Recovery-required scan fails the entire new-admission operation, but separately owned valid receipts continue writing without admission.

claimReceipt performs the same idle-layout check before load and before every apply. This is essential: current openJournalFiles.read alone does not check record.next, and commit only checks staging for mutations. No-op, close/reopen, or a new store instance must turn leftover staging into readiness. Busy inventory is the sole observational exception. Timeout followed by a late successful rename does not revive the poisoned owner; if no staging survives, a fresh claimant can inspect the inert durable record, not infer an external outcome.

## Queue, deadline and poisoning

Each store admission queue and each owner queue allows32 total outstanding calls including active; call33 rejects journal_busy before retaining event data. FIFO, no concurrent file operation. Deadline is five seconds from call admission, including queue time. An unstarted expired call is removed/rejected journal_busy without writing. Once an operation starts, deadline expiry poisons that owner/store, rejects with journal_durability_unknown and rejects queued calls; conservatively retain locks and handle references until the actual work settles. Timer never cancels a kernel promise, releases a lock, advances the queue, or permits late success.

Acquisition timeout consumes JournalLockAttempt.settled even when ready rejected; no reacquisition while unresolved. A started operation that completes after poison cannot publish new current state or fulfill its original response. It may finish its existing file protocol; no subsequent operation begins. A final close request seals admission synchronously, rejects queued work, awaits active work, closes file handles then lock, and settles; if I/O never settles, neither close nor settled claims completion. There is no Promise.race/finally unlocking pending work. Parent process supervision is the operational bound on stuck kernel I/O.

Pre-mutation syntax/conflict errors leave owner usable if all path and lock checks remain sound. Corrupt layout, lock identity failure, unknown commit, started timeout or cleanup failure poison it. Preserve only closed error code and safe stage: journal_invalid, journal_conflict, journal_capacity, journal_busy, journal_locked, journal_recovery_required, journal_durability_unknown, journal_closed, capability_unavailable. Map low-level errors explicitly; no raw cause/string interpolation. Persistent staging/incomplete namespace gates every future inventory; no additional poison file/index is introduced.

## Bounded implementation children

Each child requires review before execution; max250 nonblank/noncomment lines per cohesive module, no compression to evade the limit. Evidence/task files are separate. No transport/daemon/DB changes.

| Child | Exact source/test paths (under runtime unless noted) | Deliverable |
| --- | --- | --- |
|008d3b layout/snapshot | journal-layout.ts, journal-layout.test.ts, journal-files.ts, journal-files.test.ts | Protected bounded layout, descriptor-bound Linux statfs/mount profile verification, exclusive allocation/sync, separate read-only busy snapshot extraction; repeat accepted31 file/codec tests. No store or fake Linux lock. |
|008d3c owner/store | journal-event.ts, journal-owner.ts, journal-store.ts, journal-owner.test.ts, journal-store.test.ts | NEW strict event parser plus actual lock/file composition, queues/deadlines/poison, inventory/idempotency. Reuse accepted record/operation parsers and transitions, not a nonexistent event parser. No generalized filesystem or repository framework. |
|008d3d Linux proof | scripts/fixtures/journal-writer-child.ts, scripts/fixtures/journal-store-proof.ts, journal-store.integration.test.ts | Fixed finite subprocess protocol and C0..C8/F/P/R scenarios; source preparation first, exact VM launcher/cleanup review separately before execution. |

Factory and owner tests can test closed parsing/queue state with narrow trusted I/O faults. Injected success must never be called Linux lock evidence. Actual accepted lock primitive remains mandatory for full store integration. If boundaries cannot fit honestly, request a concrete file-scope amendment before adding files.

## Linux proof plan

Use a newly approved fixed UUID suite directory on the same pinned VM/ext4 profile, UID1000, network off, no daemon/provider/database. The fixed suite contains launcher/proof bundles, policy, output receipts and a SEPARATE journal/ subdirectory. Only journal/ is StoreOptions.lock.root; it contains solely .admission.lock and UUID receipt directories. Root provisions journal/0700 and its admission lock0600 separately, records lock fsync→journal directory fsync→suite parent fsync, and fixture allocates receipts. Suite inputs never reside inside journal/. The previous008d2 lock-fixture root layout cannot be reused as a store root. All suite and journal paths are fixed in reviewed bundles; no CLI/env path override. Fixed binaries/bundles/policy hashes; one bounded outer session, stdout+stderr64KiB cap, exact PID/PGID/start identities, finite per-case and overall deadline, awaited streams/reaping and independent final /proc scan. No retry after ambiguous mutation/settlement. Keep failed fixture for review. Remove an exact fixture only after acknowledged completion, no owned descendants, copied/hash-verified receipts and coordinator cleanup authorization.

A child sends bounded structured ready/cut messages only after the named actual syscall boundary. Parent records receipt and kills exact child, awaits termination and lock release before fresh-process inventory/claim. Trusted cut hooks pause the child at real calls; mocked syscall failures are labeled injected. Parent records synthetic effect messages in its bounded evidence channel: C0..C7 zero; C8 exactly one before kill. Recovery fixture contains no submission branch, so both message count and source inspection show no replay. This is synthetic persistence proof, not Docker behavior or power-loss simulation.

| Cuts/scenarios | Required observable |
| --- | --- |
|C0 before mkdir / before replacement stage | No new namespace / old canonical bytes; zero effects. |
|C1 mkdir before root sync | Retained partial allocation, admission denied; replacement counterpart is staging exclusive-create before write. |
|C2 root sync before initial staging | Durable permanent lock with missing record blocks admission. Replacement old record remains valid before staging. |
|C3 partial staging write | record.next survives; idle claim/new admission denied, never promoted. |
|C4 staging fsync, before/after close before rename | Old/missing record plus staging; recovery-required, zero effects. |
|C5 rename before receipt-dir sync | Complete old/new record or retained invalid condition; no success assertion about power loss; fresh load inert. |
|C6 directory sync before readback | Complete canonical new record, no returned success/effect; replay createIntent discovers same ID. |
|C7 readback before reply | Same inert receipt found after lost response; no duplicate or effect. |
|C8 commit reply, one synthetic effect, before fact commit/reply | Pending or fact record accepted inertly; effect count remains1 across restart, exact pending unknown/cancel committed before reconciliation. |
|F1/F2 | Real Linux sync/rename/readback and fresh reopen; injected short/zero write, ENOSPC, file-sync/close/rename/dir-sync/readback errors including success-then-reject: fixed unknown, poison, zero effects. |
|F3 | Deferred I/O beyond deadline: contender remains busy until settlement/close, queued mutation rejected, late success never returned. Actual disk EIO not claimed. |
|P1/P2 | Protected-path/link/FIFO/mode/foreign-entry/oversize/canonical negatives preserve unrelated bytes;1024 permits existing owner progress but denies new ID;1025 scan fails; call33 busy. |
|R1/R2 | Same attempt replay vs changed spec, duplicate corruption, historical expiry; busy runner stage does not block stable immutable snapshot; dead staging does block; control process death leaves independent owner progress; cancel gap then late claimant reads cancellation. |

C1/C2 apply specifically to insertion layout; replacement counterparts do not pretend to repeat mkdir/root publication. Record observed surviving names/bytes after every cut, not assumed outcomes. Linux directory fsync syscall success and SIGKILL survival establish only the tested surface; storage stack flush honesty, power loss, systemd children/ExecStopPost and authenticated commands remain independent deployment/integration gates.

## Decisions remaining

No product choice blocks this storage slice. Coordinator must accept the narrow snapshot extraction and child file boundaries. A reviewed operational profile must still bind real ext4 mount/storage assumptions and UID separation, authorize each fixed VM fixture, and later provide systemd runner/control transport. This proposal does not mark RFC008,009,010 or v1 operationally complete.
