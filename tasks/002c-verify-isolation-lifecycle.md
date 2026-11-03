# RFC-002c: Verify bounded isolation lifecycle

- Parent: [RFC-002](002-prove-multi-user-execution-isolation.md).
- Prerequisites: [002a](002a-define-execution-isolation-boundary.md), [002b](002b-verify-synthetic-execution-containment.md).
- Status: bounded runtime evidence verified by worker and coordinator; independent integration review and parent gates remain incomplete.

## Scope and authority

The user's continuation through remaining v1 and coordinator assignment authorize this synthetic disposable check. Only the existing local pinned Bun image, fixed local daemon and network=none policy are used. No accounts, image pulls, installs, builds, identity work or application integration.

## Acceptance and contract

1. A full 15-second attachment deadline must follow actual TERM-resistant child readiness. Deadline output is discarded. A must still be running before Docker stop delivers TERM with a one-second grace; stopped state must have PID 0, exit 137 and OOMKilled=false. Whole container removal follows. B must remain running with a fresh heartbeat.
2. Finite committed memory pressure (24 allocations of 8 MiB, at most 192 MiB requested) must produce attachment exit137 and inspected OOMKilled=true, Running=false, PID0, exit137 under the unchanged 128 MiB memory+swap boundary. B must remain healthy.
3. Existing policy, isolation, freshness, overflow and cancellation behavior stays passing; exact owned resources must be absent after cleanup.

Deadline case budgets: 15 seconds to attachment cancellation, one-second TERM grace, A fallback-removal watchdog at 22 seconds, independent B control watchdog at 24 seconds. B is a synthetic control, not an autonomous attempt. Other cases retain 15-second watchdogs. These are bounded best-effort daemon operations, not a real-time guarantee. The 120-second total ceiling remains.

## Completion record

Changed paths: the three existing isolation script/test/payload files, this handoff, verification record and safe JSON/cleanup receipts. Exported contract remains synthetic-only; nothing is imported into application startup.

Baseline: native12 tests/83 assertions passed before edits. Final: native14 tests/91 assertions passed; installed strict no-emit TypeScript exited0. Exact invocations and actual runtime stdout are linked in [verification](../docs/verification/execution-isolation.md#rfc-002c-lifecycle-extension). Offline tests distinguish observed readiness from cancellation and reject live/stale-PID/graceful/wrong-OOM termination states. Runtime evidence separately observes daemon enforcement. No web surface changed; LSP not used, installed tsc supplies diagnostics.

Failure: any missing readiness, early deadline, graceful stop, incorrect OOM cause, unhealthy B or uncertain cleanup fails closed. First sandbox-restricted invocation could not access the socket and returned blocked/cleanup:false; it never reached prelaunch binding or CREATE. Its exact empty config/root directories were inspected and removed with rmdir. Authorized external-sandbox execution passed; failures are not counted as proof.

Remaining: CPU and PID adversarial pressure (limits only inspected), restart/SIGINT/SIGTERM/crash and delayed-create orphan reconciliation, real egress controls, six native harness/state compatibility, secret storage, browser/desktop/takeover. Next worker must keep network=none until a separately evidenced egress design exists, and must not label parent RFC-002 or production execution complete.

Coordinator independently reran 14 tests/91 assertions and the actual seven-case probe; full deadline elapsed16302ms, memory-pressure exit137, overall exit0/cleanup:true. Exact safe receipt and working-source SHA256 values: local evidence No parent status was promoted and no commit/staging occurred.
