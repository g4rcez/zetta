# RFC-002 synthetic containment verification

## Status and authority

**Bounded subset accepted after independent source/readiness/final evidence review, coordinator Docker execution and cleanup.** Nothing here completes [RFC-002](../../tasks/002-prove-multi-user-execution-isolation.md), RFC-008 or production launch acceptance. The [accepted design](../decisions/execution-isolation.md) trusts the operator, launcher, daemon and Linux kernel; this is VM-backed Linux isolation on macOS, not native macOS containment or protection against kernel exploits.

The original RFC-002b run required coordinator execution after source acceptance. RFC-002c was subsequently authorized for this assigned executor by the user continuation and coordinator assignment. This worker started no containers, services, DB or networks and installed no dependencies. Two coordinator-requested identity Compose corrections were separately source-prepared: parent tmpfs permission `0700` to `0755`, and dedicated network `internal: true` to `driver: bridge` for Colima loopback-port reachability. They preserve the separate DB project/network and loopback-only published port; the DB proof does not require deny-egress. Neither edit is evidence for this proof and neither changes sandbox `network=none`.

## Source and commands

- `scripts/execution-isolation-probe.ts` (standalone, no application imports or env loader)
- `scripts/fixtures/execution-isolation-payload.ts` (synthetic A/B payload only)
- `scripts/execution-isolation-probe.test.ts` (offline Bun tests)

Run offline from repository root, with no environment-file autoload:

```sh
bun --no-env-file test ./scripts/execution-isolation-probe.test.ts
./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target ESNext --module Preserve --moduleResolution Bundler --types bun --skipLibCheck scripts/execution-isolation-probe.ts scripts/execution-isolation-probe.test.ts scripts/fixtures/execution-isolation-payload.ts
```

Coordinator-only, **after source review**:

```sh
bun --no-env-file ./scripts/execution-isolation-probe.ts
```

Do not invoke via an app launcher, env wrapper or Compose. No image build/pull, package install or extra Docker arguments are needed or supported. The code pins the coordinator-observed local Colima Unix socket and isolates Docker configuration in an empty, private temporary directory, without inheriting host HOME, contexts, credentials, daemon/TLS/proxy environment or arbitrary executable arguments. This endpoint is an environment-specific trusted operator choice, not an app/model input. If unavailable, the probe must block; no context discovery or fallback is authorized. It never mounts that socket into a container.

Coordinator-supplied observations: Linux Docker Engine **29.5.2**, Compose **5.6.0**, already-local `oven/bun:1.3.14` image **`sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4`**. These facts are not containment results. Bun offline version: **1.3.14**. Missing/mismatched local image fails before any container create; every create also has `--pull=never`.

## Enforced source policy

Before starting each created container, selected bounded JSON inspection must match: fixed image/entrypoint/arguments, UID/GID **65534:65534**, dropped **ALL** capabilities, **no-new-privileges**, read-only root, **network=none**, private PID/cgroup namespaces, IPC none, no privileged/host namespace/device/socket/extra group/port/link/broad mount privileges, one read-only selected actor input bind with private propagation, no restart, disabled healthcheck and Docker log driver **none**. Environment matches the pinned image defaults plus explicitly synthetic per-actor token, fixed PATH and scratch HOME. No host environment is inherited by Docker CLI or the container. Docker represents its default private PID namespace as an empty `PidMode`; omit the unsupported `--pid=private` argument and require the inspected empty value. Host/shared-container/unsupported modes are rejected. Nullable map selection handles absent optional inspection keys without relaxing mandatory checks. No unsupported required setting is relaxed.

Budgets: **1 CPU**, **128 MiB RAM and total memory+swap** (no additional swap), **32 PIDs**, **16 MiB scratch** tmpfs (`noexec,nosuid,nodev`), **64 KiB combined stdout/stderr capture per command/attached attempt**, **15,000 ms per running attempt**, no more than **two containers** concurrently, **120,000 ms total** including cleanup. Normal CLI commands have at most 3-second deadlines, main dispatch stops at 95 seconds, cleanup has a reserved remaining window to 118 seconds. The hard 120-second ceiling kills only launcher-created CLI process groups and exports failure with `cleanup:false`; daemon failure may prevent resource removal. Container removal is best-effort at an expired running-attempt deadline; no claim of a hard host/daemon real-time guarantee is made.

A private mode-0700 `mkdtemp` child named `.zetta-isolation-test-...` under this repository contains only newly created A/B/fake-host canaries and empty Docker configuration. Invoke from the repository root as shown above. The approved repo-local location avoids assuming macOS `/var/folders` is shared by Colima; actual share availability is still a positive-control gate, not a source claim. Only an actor-specific input directory is mounted; no parent directory, host HOME, app/config, real account or secret is read/mounted. Synthetic ownership plus exclusive state lease is checked before create. A known reference to B does not authorize A. This is fixture logic, not production app authorization or native-session lease proof.

## Accepted coordinator cases (bounded subset only)

| Fixed case name | Required condition | Actual |
| --- | --- | --- |
| `foreign-and-busy-state-denied-prelaunch` | Foreign actor binding and duplicate live state lease rejected before Docker create | Passed |
| `filesystem-process-env-fd-child-scratch` | A authorized read succeeds; B authorized read/heartbeat succeeds; foreign/fake-host absolute/traversal/symlink reads fail; input/root writes fail; no foreign canary in namespace env/proc/fds; B host-namespace PID absent and signal gets ESRCH within A's private namespace; one finite child exits; 17 MiB write gets ENOSPC | Passed, exit0 |
| `fresh` | A second new container cannot see the prior attempt's scratch marker; same normal assertions and fresh B positive control hold | Passed, exit0 |
| `overflow` | Finite 512 KiB output exceeds 64 KiB capture, raw capture is discarded, whole A container is removed; B heartbeat remains fresh | Passed, attachment exit137 |
| `cancel` | A's actual child signals startup over private IPC; only then A emits the fixed readiness acknowledgement. Observing that stdout acknowledgement arms attachment cancellation 500 ms later; private output discarded, A and its single child removed with container; B heartbeat remains fresh | Passed, attachment exit137 |
| `cleanup` (top-level boolean) | Exact owned resources absent following bounded labelled reconciliation; private created temp root removed | Passed, cleanup:true |

Synthetic foreign PID comes only from the owned B container's inspected Linux host PID. A first requires that PID absent in its own private `/proc`, then attempts SIGUSR1 only inside A's namespace. Neither launcher nor payload signals a host/unrelated process. B's SIGUSR1 handler would stop its heartbeat; B must remain running with a fresh heartbeat after A removal. No host process or environment enumeration occurs. The first B input read is a positive control, not a denial-only inference. B's canary value is deliberately present as an A comparison marker, not an actual hidden credential.

Cancellation never starts a timer merely because `docker start --attach` was invoked. The private readiness acknowledgement is a fixed stdout prefix, parsed across chunks and counted within the existing combined 64 KiB capture budget; stderr, malformed or incomplete acknowledgements cannot arm cancellation. Passing cancellation evidence requires both observed readiness and the cancellation reason. Missing readiness remains blocked at the existing attempt/total deadlines, with no readiness timeout fallback that could pass. No acknowledgement or child IPC message is exported or logged.

The probe exports only fixed case names, booleans, numeric exit status and cleanup status. A nonzero attachment exit can be expected for overflow/cancel and is not independently a failure if its exact reason matches. Unsupported policy, failed positive control, timeout, foreign data or Docker errors produce a fixed blocked case and nonzero overall exit. Raw stdout/stderr, env, canaries, host paths and daemon errors remain private; Docker log storage is disabled. Keep any separate debugging output private and do not put it into application/Axiom logs.

## Cleanup and failure limitations

Register random names before CREATE. Use an unguessable run label and inspect it again, with expected exact name and full ID, before `container rm --force <exact-ID>`. Partial-create cleanup lists only that exact owned label, validates IDs/known names, retries bounded reconciliation and checks no labelled leftovers. It performs no wildcard removal, prune, volume deletion, Compose or unrelated project action. Only after verified container deletion, recursively remove the exact root returned by this invocation's `mkdtemp`. If container cleanup cannot be verified, preserve the synthetic root and report `cleanup:false`; it is not a permanent artifact or an authorization to delete other matching paths.

Docker/daemon timeouts or failed CREATE commands make creation uncertain; even if two short reconciliation passes find no containers, the probe must report `cleanup:false` and preserve the synthetic root, because a later daemon create cannot be disproved by polling. `cleanup:false`, process crash, SIGINT/SIGTERM/host restart and hard total deadline require operator investigation of **this run's owned resources only**; do not interpret them as clean containment proof. Persistent orphan reconciliation and restart recovery remain pending. A 15-second A deadline that outlasts the paired B control cannot be accepted as a passing B-unaffected proof; the normal fixture does not deliberately exercise that full-duration path.

## Offline evidence and remaining gates

Readiness-fix final offline run: **12 passed, 0 failed, 81 assertions**; existing policy/subprocess tests plus cancellation-before-readiness rejection, absent/partial/malformed/stderr-only readiness deadline blocking, readiness output-budget enforcement, and a delayed-start positive control executing the actual A payload and its IPC-signaling child. The owned child delayed-write non-survival assertion after deadline remains covered. These tests use native Bun only, do not invoke Docker and are not evidence that Docker supports or enforces the configuration. The installed strict no-emit TypeScript check passed with `--ignoreConfig`; an earlier implementation invocation without that required TypeScript 6 flag failed with TS5112 before checking sources. LSP unavailable. Scoped whitespace checks passed. The P1 readiness fix was independently reviewed and accepted for coordinator runtime. Two compatibility corrections followed: Docker rejects `--pid=private`, so the probe omits it and asserts exact default-private `PidMode`; absent optional fields in strict Go templates now use nullable map selection, while mandatory policy checks stay strict. PID regressions reproduced two failures before the correction; final coordinator offline run passed **12 tests/83 assertions**, strict installed diagnostics and whitespace checks. The earlier81-assertion results above refer to the readiness-only revision.

Coordinator ran `bun --no-env-file ./scripts/execution-isolation-probe.ts`, exit0: all five fixed cases passed (`normal`/`fresh` exits0; `overflow`/`cancel` attachment exits137 with their exact expected reasons), top-level `cleanup:true` and `passed:true`. Initial failed attempts were not counted as evidence: invalid PID argument created no container; missing optional template field left one stopped owned B, removed only after exact ID/name/label/image/synthetic-root verification. Final successful run reconciled exact owned resources; coordinator additionally confirmed no probe-labelled container and zero generated synthetic roots. No network/provider/real-account data or raw hostile output was used. Receipt: `/tmp/zetta-rfc002b-live.md`. Final correction/evidence review found no issues (`/tmp/zetta-rfc002b-final-review.md`) and supports bounded acceptance. Coordinator accepts this child; reviewer did not independently repeat Docker execution.

Remaining after this accepted synthetic subset: full-duration Docker timeout/escalation and restart/delayed-create reconciliation; adversarial CPU/RAM/PID pressure enforcement beyond policy inspection; real network/egress controls; six native harness sessions/profile/lease compatibility; real credential-store acceptance; distinct browser/full desktop/takeover evidence. Real autonomous account execution remains blocked. Parent/root status must not be changed before independent acceptance, and this limited proof cannot make the full parent Done.


## RFC-002c lifecycle extension

The preceding RFC-002b record is historical. This extension supersedes its full-duration timeout and RAM-pressure gaps only. [RFC-002c](../../tasks/002c-verify-isolation-lifecycle.md) remains in review; RFC-002 remains incomplete.

Actual safe stdout: [runtime receipt](execution-isolation-lifecycle-runtime.json). Independent post-run absence check: [cleanup receipt](execution-isolation-lifecycle-cleanup.txt). These are actual local Docker execution, not mocked results. Invocation: `bun --no-env-file scripts/execution-isolation-probe.ts`; exit recorded in `.omo/evidence/isolation-lifecycle/runtime-exit.txt`. Fixed image, socket, no-pull policy, all inspected restrictions and network=none are unchanged.

| Scenario | Binary observable | Artifact |
| --- | --- | --- |
| Full deadline and escalation with healthy independent B | `deadline.passed=true`, elapsedMs >=15000, overall passed=true; requires child readiness, A alive after attachment deadline, stop grace1s, stopped PID0/exit137/non-OOM, removal and B health | runtime JSON |
| Finite memory pressure with healthy B | `memory-pressure.passed=true`, exit137; requires inspected OOMKilled=true, PID0, stopped exit137, A removal and B health | runtime JSON |
| Existing containment cases | Every previous fixed case passed=true | runtime JSON |
| Exact owned cleanup | cleanup=true and post-run zero matching containers/roots | runtime JSON and cleanup receipt |
| Local readiness/termination guard regressions | 14 pass, 0 fail, 91 assertions | `.omo/evidence/isolation-lifecycle/tests.txt` |
| Strict source diagnostics | exit=0 | `.omo/evidence/isolation-lifecycle/types.txt` |

Offline invocation: `bun --no-env-file test scripts/execution-isolation-probe.test.ts`. Diagnostics invocation: `./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target ESNext --module Preserve --moduleResolution Bundler --types bun --skipLibCheck scripts/execution-isolation-probe.ts scripts/execution-isolation-probe.test.ts scripts/fixtures/execution-isolation-payload.ts`. Baseline12/83 receipt: `.omo/evidence/isolation-lifecycle/baseline.txt`.

A deadline run explicitly reserves a full15-second attachment window before launch and asserts elapsed time at least15000ms. Readiness is observed without arming cancellation. Both A parent and its one child ignore TERM. Docker stop waits one second before forced termination; selected stopped-state evidence rejects OOM as the cause. A's fallback watchdog allows22 seconds; B's independent control lifetime allows24 seconds, preserving enough time for post-deadline heartbeat verification. Other attempt watchdogs remain15 seconds; total120-second ceiling and main95-second budget remain unchanged. Elapsed receipt includes stop/inspection/cleanup/health checks, so is longer than the attachment deadline itself.

Memory payload requests at most192 MiB through24 committed8-MiB buffers under the128-MiB memory+swap limit; it fails explicitly if all allocations survive. This is finite isolated memory pressure, not a host allocation or unbounded fork bomb. CPU/PID adversarial enforcement is still unproved beyond exact configuration inspection.

Initial sandbox socket denial produced blocked/cleanup:false before CREATE. Its empty owned config/root were inspected and removed with exact rmdir. No failed attempt is counted as runtime evidence. Subsequent authorized runs passed. Restart/interruption and delayed-create reconciliation, real egress, native harness state, credentials and browser/desktop/takeover remain blocked proof areas; this extension does not implement a production supervisor.
