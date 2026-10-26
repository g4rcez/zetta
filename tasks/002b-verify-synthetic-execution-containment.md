# RFC-002b: Verify synthetic execution containment

- **Parent:** [RFC-002](002-prove-multi-user-execution-isolation.md).
- **Prerequisite:** [accepted boundary](002a-define-execution-isolation-boundary.md).
- **Status:** accepted bounded synthetic subset after source/readiness reviews, coordinator runtime/diagnostics and final compatibility/evidence review. Parent/root remain incomplete.

## Bounded exception and implementation

This standalone synthetic research fixture is authorized under RFC-002 only. It does not implement the production launcher, app integration or RFC-008, and does not unblock downstream dependencies. No services, providers, real accounts, native sessions, browser or desktop are used.

Paths:
- `scripts/execution-isolation-probe.ts`: trusted fixed Docker policy, inspect-before-start, actor/state exclusive binding, bounded private capture and exact owned cleanup.
- `scripts/fixtures/execution-isolation-payload.ts`: synthetic hostile A and positive-control B; never imported into app startup.
- `scripts/execution-isolation-probe.test.ts`: native offline Bun tests; importing the probe cannot launch Docker.
- [Verification record](../docs/verification/execution-isolation.md): exact commands, expected evidence and limits.

## Acceptance gates

- [x] Source fixes already-local image/entrypoint, no pulls/builds, no caller mount/image/command API, private empty Docker config and trusted local Unix endpoint.
- [x] Offline tests cover argument policy, missing/mismatched local image rejection, exact inspection/weakening rejection, foreign/busy binding rejection, output overflow, explicit cancellation and finite child process-group deadline termination. P1 regression coverage additionally blocks cancellation-before-readiness and missing/invalid readiness, checks the readiness output budget, and positively exercises delayed A startup with its actual IPC-signaling child.
- [x] Independent source/readiness reviews accepted runtime preparation; compatibility corrections await final review.
- [x] Coordinator ran the bounded Docker fixture, all five cases passed, overall exit0/cleanup:true, with no labelled containers or generated roots remaining.
- [x] Independent final correction/runtime-evidence review accepted the tested subset with no issues; parent evidence may record this subset, never RFC-002 Done.

Expected runtime subset: successful A/B own-state controls; denial of B/fake-host absolute paths, traversal and chained symlinks; read-only root/input; foreign environment/process/fd visibility and namespace-local signaling denial; finite child completion; scratch ENOSPC; new-attempt scratch freshness; bounded overflow and cancellation armed only after A acknowledges its child's actual startup, with B still healthy; removal of exact owned containers and temp root. Source preparation and offline helper tests are **not** any of these Docker results.

Pending even after a successful run: a full 15-second Docker deadline/escalation proof while an independent B control remains healthy, restart/interruption and delayed-create orphan reconciliation, resource-pressure/OOM/PID/CPU adversarial enforcement (beyond inspected configuration and finite child/scratch checks), real egress/native harness state/browser/desktop/takeover/credential-store proof. Real autonomous account execution stays blocked.

## Implementation-only validation

Readiness-fix offline Bun: 12 focused tests passed, 81 assertions (final receipt in verification record). Installed TypeScript 6 requires `--ignoreConfig` for explicit file arguments; the first implementation no-emit invocation without it was rejected, then the explicit isolated check passed. The readiness fix also passed the installed strict no-emit check and scoped whitespace checks. The readiness fix subsequently passed independent review and coordinator tests. Docker compatibility required omitting unsupported `--pid=private` while asserting exact default-private empty PidMode, and nullable selection of absent optional inspection fields without relaxing mandatory policy. New PID regressions first failed2 cases; final offline run passed12 tests/83 assertions and strict no-emit diagnostics. No dependencies installed, builds or Docker/DB/network commands run by this worker. LSP unavailable; installed no-emit TypeScript is the source diagnostic check.

Coordinator runtime receipt: `/tmp/zetta-rfc002b-live.md`. Exact command `bun --no-env-file ./scripts/execution-isolation-probe.ts` returned all fixed cases passed, exit0, cleanup:true. Normal/fresh attachment exits0; overflow/cancel exits137 only with exact respective capture reasons, child-ready gating for cancel, whole-container removal and unaffected fresh B control. Initial blocked attempts were cleaned by exact owned resource/root verification, not counted as proof. Final additional check found no probe-labelled containers and zero generated roots. Final independent review `/tmp/zetta-rfc002b-final-review.md` found no issues and accepts the corrections and recorded subset. Coordinator accepts this child; reviewer did not rerun Docker. Parent remains incomplete.

Two separate coordinator-requested PostgreSQL fixture corrections in `docker-compose.identity-test.yml` (parent tmpfs mode `0700` to `0755`; dedicated network `internal: true` to `driver: bridge` for Colima loopback-port reachability) are **not containment evidence** and do not change this task's scope/status. The DB fixture retains its separate project/network and loopback-only published port; it does not require deny-egress. The execution probe remains `network=none`.
