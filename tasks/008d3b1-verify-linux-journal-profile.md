# RFC-008d3b1: Verify actual Linux journal filesystem profile

Status: accepted after [coordinator actual Linux proof](../docs/reviews/journal-profile-008d3b1-review.md). Worker prepared source only; coordinator executed and verified exact cleanup.

Parent [008d3b](008d3b-implement-journal-layout-and-snapshot.md). Own only this task and new current-attempt runtime-008d3b1 evidence. Frozen product modules unchanged.

Tiny read-only no-child fixture imports actual journal-layout implementation. Fixed dedicated-VM paths place inputs outside separately provisioned journal/ roots. Actual ext4 must pass descriptor-bound profile inspection; actual protected /run/user/1000 tmpfs must deny capability. Exact runtime guard,8second watchdog/10second external deadline,1024byte closed stdout, descriptor close and namespace/inode readback are required.

Proposal spells out fixed UUID paths, exclusive fixture provisioning/sync, one invocation, three success rows, process settlement, evidence capture and exact authorized cleanup. No new mount, service, Docker, network, provider or installation. Actual Linux jobE11C50FA-FB4F-4DAF-8EDD-67F958E88EDE passed all three rows/exit0; separate namespace/inode/hash/process readback and cleanup/absence passed. Parent008 remains incomplete.

Build/strict exit0, source LSP clean, local guarded bundle exit1 with only guard denied. Source/bundle/frozen imported-source hashes recorded. Evidence: `local evidence`.
