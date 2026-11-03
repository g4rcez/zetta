# RFC-008d1 independent review

codeQualityStatus: CLEAR
recommendation: APPROVE
blockers: none within the protected codec/file primitive scope

## Findings and scope

CRITICAL: none. HIGH: none. MEDIUM: none. LOW: none.

Reviewed journal-codec.ts, journal-files.ts and both focused tests against task008d1, launch-journal-persistence.md and accepted008c parser/transition ownership. Reviewed author runtime-008d1 report and frozen source hashes. No product changes or platform/service provisioning performed.

- journal-codec.ts:14–35 bounds disk bytes to16KiB, copies caller bytes, uses fatal UTF8, explicitly rejects BOM, invokes the accepted historical parser and requires byte-for-byte canonical reserialization including the final newline. This rejects duplicate keys and alternative encodings without introducing a redundant generic JSON validator. Encoding validates before filesystem mutation. Historical validity is not fresh admission.
- journal-files.ts:28–54 validates protected ancestors, exact owner/mode/type and named/descriptor identity. Existing opens use NOFOLLOW/NONBLOCK and directories use DIRECTORY. Files require one link; root/receipt/record devices are checked. The read path bounds allocation and validates initial/final size, timestamps and identities. Protected ancestry and trusted UID are genuine prerequisites; these checks do not promise race-proof defense against malicious root/same-UID writers.
- journal-files.ts:62 onward copies/validates trusted policy before suspension, retains verified directory handles and excludes overlapping read/commit/close. Commit compares the complete canonical expected record, refuses existing staging, creates only fixed record.next exclusively, handles partial writes, syncs/closes the file, rechecks namespace/current bytes, renames, syncs the receipt directory and verifies intended bytes through the bounded read path. It never truncates the old record in place.
- Once creation can have occurred, rejection conservatively poisons the instance and reports fixed journal_durability_unknown with a closed stage. No automatic retry, deletion, promotion or rollback restores apparent success. Finally closes a retained staging handle and preserves uncertainty on close failure. A pending operation keeps active ownership until settlement; close rejects instead of releasing handles early.
- These are trusted low-level snapshot helpers, not the future transition-only store. read() alone does not inventory foreign entries or classify leftover staging. The caller must own external locks, validate the complete layout and namespace provisioning, and refuse recovery-required layouts before granting an owner. This matches the explicit child task/report boundary, not a complete openJournalStore implementation.

## Independent evidence

Reviewer ran the actual focused macOS file suite:31 tests,147 assertions, zero failures. Strict TypeScript with noUncheckedIndexedAccess/exactOptionalPropertyTypes/noUnused checks passed. Exact commands/output: focused.log and strict.log alongside this report. No .journal-008d1-* fixture directories remained after execution. Source hashes independently recorded in source-hashes.json match the author's frozen manifest:

- journal-codec.ts: d082cfa24bf0dd270727ec9d34cd4fa96a2510774c1520e55a5960db67196a5c
- journal-files.ts: 3cf982de377552459f05787d9aeb8aa2f61ad4677fdfe7708c363bc4d338dd79
- journal-codec.test.ts: 8a5c10935ebc0a02c967ee2648fcfd0a7fadffce95cc102375cf4ec2c4e2a359
- journal-files.test.ts: c919242207bc5aa3069f1a3e2d44506a59ab89ab05cd94f04b65d39b03beeeef

The actual fixtures exercise insertion/replacement, canonical reads, conflicts, symlink/hardlink/FIFO, metadata/ancestor rejection, bounded corrupt reads and unrelated-byte preservation. Fault hooks demonstrate fixed failure/poison semantics before and after actual operations, partial/zero writes, changed readback and held I/O. They are not actual ENOSPC/EIO, process-crash or power-loss evidence. No distinct defect warranted an additional reproduction probe.

## Quality and remaining gates

Code-review, programming and remove-ai-slops perspectives were consulted/applied. Tests exercise observable behavior and real files; no deletion-only, requested-removal or tautological tests were identified. Boundary parsing is justified by the untrusted persisted-byte boundary. Trusted syscall hooks are constructor-only test seams, not request-controlled runtime escape hatches. No unnecessary production abstraction was found.

Approve only008d1. Permanent-inode Linux descriptor locks/inheritance, Linux/ext4 directory durability, bounded inventory/allocation, transition-only serialized owners, timeout poison and retained lock lifetime, restart/crash cuts and operational composition remain008d2/008d3 or later. A successful local commit returns void, not execution authority. Mac fsync success does not establish Linux readiness or power-loss durability.

Evidence directory: `local evidence`.
