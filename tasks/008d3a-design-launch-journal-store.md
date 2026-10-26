# RFC-008d3a: Design journal store composition

Status: revised design accepted after [coordinator independent review](../docs/reviews/journal-store-008d3a-review.md),2026-10-22; design only. Implementation children require their own bounded assignments.

Parent: [008d](008d-persist-resource-journal.md). Decision: [launch-journal-store](../docs/decisions/launch-journal-store.md).

Concrete outcome: compose accepted canonical record/transitions, protected file commits and verified Linux descriptor locks into bounded installation allocation/inventory plus independent receipt owners. The proposal closes missing permanent-lock provisioning/sync ordering, busy read-only snapshot semantics, persistent staging gates, queued-call deadlines/poison and exact historical idempotency. All returns remain inert; no effects, queue/index/broker or PID takeover.

Only this task, decision and unique evidence are edited. Implementation children008d3b layout/snapshot,008d3c owner/store,008d3d Linux crash proof each name at most five source/test files. They require review and explicit execution scope. C0..C8/F/P/R fixtures remain unexecuted. Existing VM descriptor L1..L4 evidence is scoped to its pinned tuple, not fsync durability/systemd.

Acceptance: independent review of exact API/lock graph, fresh-vs-historical admission, staging recovery and late-I/O ownership; coordinator accepts child scopes. Actual store implementation and Linux crash proof follow, not part of this design task.

Evidence: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/runtime-008d3a-design/`.

## Root review corrections

Factory verifies the retained root’s actual Linux statfs EXT magic plus exact fdinfo mount ID/mountinfo ext4 and local block device; no caller assertion substitutes for this gate. Generic layout tests remain separate from Linux store construction. New journal-event.ts supplies the missing strict runtime event parser, bringing008d3c to five source/test paths with parser tests in owner.test. Future VM bundles/policy/logs live in a private suite outside the separately provisioned/synced journal/ root; the old lock-fixture layout is not reused. All corrections are design-only and require review before implementation.
