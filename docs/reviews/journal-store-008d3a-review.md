# Coordinator review of journal-store composition008d3a

Verdict: CLEAR for the revised bounded design,2026-10-22. No store or crash durability is claimed implemented. The coordinator read the entire initial proposal, compared actual existing exports and required three corrections before acceptance.

The revised design makes Linux filesystem inspection real and descriptor-bound: statfs plus bounded fdinfo/mountinfo and kernel block-device checks, exact ext4/writable profile and retained/named identity rechecks. EXT magic alone, same device and caller capability booleans do not suffice. Actual Bun/proc behavior remains a Linux proof gate; deployment still owns storage backing and privileged mount assumptions.

Existing transitionJournal has a typed event union but no strict whole-event parser. The proposal now explicitly assigns a new journal-event.ts with closed nested validation, immutable copying and tests rather than claiming a nonexistent export. The owner discards effects, commits before returning immutable records, preserves exact no-op/staging checks and never returns an execution token. Its queue/deadline design retains locks/descriptors through actual pending I/O settlement; late completion cannot undo poisoning or authorize a subsequent action.

The selected allocation order synchronizes permanent lock→receipt directory→root before initial record publication. Only admission→receipt nesting exists. Attempt-key historical replay is checked before fresh admission; changed same-attempt specs conflict, and expired/uncertain exact replay is inert. Inventory is bounded, treats busy-writer staging observationally, but rejects idle staging/incomplete allocation/unknown namespaces for new admission. Existing receipt writers can continue without installation admission. No lock unlink, stage promotion, PID takeover, second index or automatic effect replay is introduced.

The VM suite now keeps bundles/policy/logs outside the separate journal/ root, whose namespace permits only admission lock and UUID receipts. This corrects the earlier lock-fixture layout. C0–C8 and fault/queue/profile/replay scenarios distinguish real SIGKILL/syscall boundaries from injected disk failures and power-loss claims. Each actual suite needs separately reviewed fixed inputs, bounded process/output ownership and final copied evidence/empty-group cleanup.

Accepted next scope is008d3b layout/snapshot only, four named files. The following five-file event/owner/store slice and actual Linux crash fixture remain separate assignments. Accepted008d1 behavior/tests must be repeated after snapshot extraction. No transport, mTLS/systemd, application queue, database, provider or native-harness readiness follows from this design review.

Reviewed revised decision hash:a548d648618915628360f18b06b069db98bb53ab8cf5ba08ba40658c859571df. Acceptance status/link may be added afterward; implementation changes need their own review and real matching-surface proof.
