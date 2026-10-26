# RFC-008d3b: Protected layout and observational snapshots

Status: accepted after [coordinator independent review](../docs/reviews/journal-layout-008d3b-review.md); Linux profile execution remains unproved.

Parent [008d3a](008d3a-design-launch-journal-store.md), accepted [store decision](../docs/decisions/launch-journal-store.md).

Owned exactly runtime/journal-layout.ts, journal-layout.test.ts, journal-files.ts and journal-files.test.ts. No owner/store/event parser or operational integration. Source modules remain below250 nonblank/noncomment lines.

openJournalLayout({root,uid}, trustedFaults?) retains a protected root descriptor and exposes scanRoot, inspectReceipt(receiptId,idle|busy), allocate(receiptId), verifyLinuxProfile and close. These are internal primitives: caller holds admission for scan/allocation and receipt for idle inspection, and handles deadline/poison lifecycle. Allocation only publishes the permanent empty receipt lock after lock fsync, directory fsync and root fsync; it does not publish an initial record. Errors after allocation starts retain names and poison the layout. No lock replacement/deletion/repair or effect authority.

verifyLinuxProfile is a real Linux-only descriptor-bound statfs/proc/sysfs probe: exact ext4/writable mount selected by retained descriptor mnt_id, same local block device and root identity rechecks. Mac tests verify capability_unavailable rather than override platform. Actual pinned Linux execution is separately reviewed future work; this task makes no Linux readiness/durability/systemd claim.

readJournalSnapshot shares the accepted bounded canonical file reader, returns only an immutable record, and closes every retained handle. Concurrent identity change reports inventory_busy where observed; malformed bytes remain invalid. Caller still checks bounded busy namespace and manages one retry/deadline. Staging is not read or promoted. The exclusive openJournalFiles commit API remains unchanged.

Validation:48 focused tests/243 assertions pass, including original31 file/codec cases; strict TypeScript exit0 and four source LSP checks clean. Actual Mac filesystem fixtures record exact paths, unrelated-byte preservation and confirmed removal in tests.log. Fault observers simulate failures around real syscalls, not real EIO/power loss. Red-first missing-module failure captured. No VM/Docker/DB/install/Git/environment operations.

Evidence: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/runtime-008d3b/`.

## Coordinator race correction

Real rename between record open and named verification reproduced the busy misclassification before fixing it. Busy record/staging replacement now returns inventory_busy; idle/permanent-lock verification remains strict. Future inventory must retry busy layout inspection plus snapshot once within its budget, then deny the call if still unstable without treating the transient as corruption. Regression includes changed inode/new complete bytes, idle rejection and stable retry. Latest50tests/257assertions and strict/LSP pass; frozen hashes and busy-race logs are in the same evidence directory. No Linux proof yet.
