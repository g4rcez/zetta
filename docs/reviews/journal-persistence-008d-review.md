# 008d journal persistence independent design review

Decision: **CLEAR, design scope only.** No blocking mismatch found with the accepted 008a/b/c launcher and journal contracts. This review does not approve operational readiness or claim that filesystem/process experiments ran.

Reviewed ADR SHA-256: `6803575f6f42bbfe7db4ae5f873a2c18eafae04915d6e06a1c0ce5a77c1de356`. Read the task, author design report, accepted journal/spec/recipe/transition sources, and the primary references below. Independently checked all four accepted source files against the author's before hashes: all matched. Author evidence was treated as reported design work, not Linux execution proof.

## Findings

No blocking findings. The corrected design resolves the installation-wide lifetime-lock conflict:

- `docs/decisions/launch-journal-persistence.md:52`: only installation→receipt nesting; receipt owners never reacquire installation ownership. Allocation releases both locks before starting a unit. Independent runners retain their own receipt lock, so control death and inventory cannot prevent their cancellation/deadline/fact writes. Live control commands go through the runner; post-exit reconciliation waits for the runner and relevant children, then reloads and closes admission before acting.
- `docs/decisions/launch-journal-persistence.md:21`: permanent lock inodes, exact owner/mode/link checks and protected ancestor assumptions are explicit. Final-component O_NOFOLLOW is not presented as protection against a hostile same-UID ancestor replacement. Existing FIFO opens are nonblocking and rejected after descriptor validation.
- `docs/decisions/launch-journal-persistence.md:37`: descriptor-form flock has no shell, pathname acquisition or unlock operation. The source supports the helper algorithm; shared-description duplication and ordinary-child noninheritance remain exact-binary Linux gates. Parent death while a duplicate survives does not authorize inode replacement or takeover.
- `docs/decisions/launch-journal-persistence.md:68`: bounded inventory treats busy-owner staging as expected; immutable identity snapshots confer no writer/effect authority. Unstable snapshots deny new admission. Only an exclusive receipt owner diagnoses stale staging; partial allocation and corruption remain retained. At 1024 records, existing owners can reconcile while new admission is denied.
- `docs/decisions/launch-journal-persistence.md:78`: canonical bounded serialization, exclusive staging, full write, file sync, observed close, atomic rename, directory sync and readback precede acknowledgement. Post-mutation failures poison the owner and remain unknown, including timeout followed by late successful I/O. Locks remain held until pending I/O settles; no staging promotion, replay token or absence-based cleanup proof is created.
- `docs/decisions/launch-journal-persistence.md:102`: L1–L4, F1–F3, P1–P2, R1–R2 and C0–C8 specify executable synthetic observables, descriptor inheritance controls, actual process death, fault seams, concurrent receipts, cancellation gaps and exact cleanup. The five proposed implementation/test files at line124 are concrete; exceeding the module/scope bounds requires explicit rescoping rather than compression.

## Primary-source cross-check

The util-linux v2.41.3 [descriptor parsing and success path](https://github.com/util-linux/util-linux/blob/v2.41.3/sys-utils/flock.c#L311) calls the lock operation and returns without the command branch or explicit unlock. Its [exit stream handler](https://github.com/util-linux/util-linux/blob/v2.41.3/include/closestream.h#L65) handles stdout/stderr. This supports the proposed CLI protocol, not an installed binary claim.

Linux [flock(2)](https://man7.org/linux/man-pages/man2/flock.2.html) specifies shared open-file-description ownership and release on explicit unlock or last close. [open(2)](https://man7.org/linux/man-pages/man2/open.2.html) confirms final-component-only O_NOFOLLOW. [fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html) requires a separate directory sync for the directory entry. [Bun subprocess documentation](https://bun.com/docs/runtime/child-process) documents descriptor stdio, but does not establish the exact pinned Linux runtime's duplication/inheritance behavior. These sources were inspected independently; no local helper or filesystem experiment was run.

## Required later acceptance gates

Before claiming persistence works, provision the separately authorized Linux/ext4/dedicated-UID environment, pin and record Bun/flock binary identities, and execute every stated scenario with retained artifacts. In particular, L1/L2/L3 must establish descriptor sharing and SIGKILL release with an unrelated child still alive, and F1/F2/F3 must establish directory-sync and unknown-outcome behavior. Process-crash tests do not establish power-loss guarantees. Later authenticated control transport, once-only effect submission and systemd/Docker lifecycle integration remain separate operational gates. RFC008 and RFC010 remain incomplete.

Evidence: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/journal-persistence-008d-review/`.
