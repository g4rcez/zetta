# RFC-008b independent review

## Current verdict — RFC-008b1 delta

codeQualityStatus: CLEAR
recommendation: APPROVE for the pure descriptor and corrected bootstrap policy
blockers: none for this bounded slice

H1 is resolved on the current hashes below. The historical BLOCK report is preserved below and superseded by this section. No final image, production launcher, native provider or linux-systemd-v1 readiness is approved.

Current findings: CRITICAL none; HIGH none; MEDIUM none; LOW none.

`launch-recipe.ts:47-48` now starts the non-root fixed entry program in the existing writable /scratch mount. Its comment requires trusted bootstrap to create private home/work and chdir before input. The task explicitly requires fresh children (fail rather than adopt existing paths). No UID, mount, network, environment, resource or command authority is relaxed. The final fixture program remains future work, accurately stated.

Inspected runtime-008b1/report.md, verify-cwd.ts, docker-proof.log, task handoff and changed assertions. The actual old-policy control reproduces unwritable root-owned0755 cwd. The corrected synthetic guest creates fresh UID65534-owned0700 home/work, changes to work and writes both files: all eight required positive checks pass, exit0. Cleanup reports true, quarantineRequired=false and isolatedCliHomeRemoved=true. This is executor/coordinator-run actual Docker evidence; this reviewer did not run Docker. It substitutes a synthetic guest for the unbuilt final fixture entrypoint and does not establish that image's defaults or behavior.

The proof is bounded to the pinned existing local image, exact names/label, isolated CLI config and read-only/no-network/non-root scratch policy. Its retained unknown-mutation marker blocks another invocation; timeout/overflow/abnormal mutation outcomes remain sticky rather than allowing an empty inventory to establish cleanup. Source inspection and a synthetic preexisting-marker refusal are the evidence for that guard; no delayed-daemon/actual unknown-outcome fault was exercised. This evidence helper is not the durable production journal planned in 008c.

Independently repeated focused tests: 62 pass, 0 fail, 90 assertions. Independently repeated the report's strict TypeScript command including verify-cwd.ts: exit0, no diagnostics. Current hashes independently match:

- launch-recipe.ts: b71067c2cf05258b2f4ae72e97f02e8f0e67559efd7e6fb06a1257cbb97cbb64
- launch-recipe.test.ts: 0ae632b2bd460c2bfd8724813a7d0305824a96a31aba9d27ac9b31046d3dc161
- launch-spec.ts unchanged: 0a64ef91ceca1a1764f90a10897e5b907035307c4eed8a0ddf6697717108807d
- launch-spec.test.ts unchanged: e96f12061862a24b46aa825ecf581e53ec772fad7bab56c733b11aac1acb75b2

Programming/remove-ai-slops perspectives reapplied: cwd/freeze assertions protect an external descriptor contract, while actual guest writes establish the behavior those assertions cannot. Policy-change test checks changed admitted policy changes both digests. No removal/prose assertion or unnecessary abstraction found.

Semantic recipe changes require advancing trusted policyVersion and pinning the corresponding launcher implementation/image. Digest construction does not hash implementation source. Refreshed ADR line59 confirms initial /scratch, fresh owned0700 children and chdir into /scratch/work before input; the task and current ADR agree. Exact next 008c journal contract remains as described in the historical report below. Final-image bootstrap, cache/config setup and containment must be proven before operational acceptance.

## Historical RFC-008b review (superseded verdict)

codeQualityStatus: BLOCK
recommendation: REQUEST_CHANGES
blockers: H1 — the selected non-root working directory is unwritable on the probed daemon
Scope: apps/server/src/modules/runtime/launch-{spec,recipe}.ts and adjacent tests; tasks/008b-define-launch-spec-and-recipe.md; runtime-008b evidence; accepted runtime-supervisor ADR. Approval is source-only, not launcher or image readiness.

## Findings by severity

- CRITICAL: none.
- HIGH H1: launch-recipe.ts:47 selects /scratch/work for UID/GID 65534:65534, but the daemon creates this child of the fresh tmpfs as root-owned 0755. The coordinator’s actual write probe fails there while successfully creating/writing a sibling home directory. The fixed policy therefore does not supply the intended writable workspace. Correct the descriptor to start in /scratch, require trusted bootstrap to create private owned work/home children and chdir before accepting input, and prove a write with the same non-root/bounded policy. Amend the ADR and the test expectation at launch-recipe.test.ts:64 accordingly. Evidence: current-attempt coordinator-cwd-probe.md, inspected by this reviewer; the actual Docker probe was coordinator-run.
- MEDIUM: none.
- LOW: none.

## Contract assessment

launch-spec.ts:7-37 rejects unknown top-level/nested authority, invalid IDs, unsafe integers, unsupported cases and malformed budgets. Trusted admission is separately parsed; remaining lifetime must be positive, within requested wall budget and 60 seconds, and no later than the server-authorized absolute deadline. Re-admission does not extend expiry. The caller must derive this admission from current DB authorization and a trusted clock: this pure parser does not authenticate actors, validate active leases/fences or query DB.

launch-spec.ts:40-48 uses a domain-separated fixed tuple containing every semantic descriptor field, including all eight context identities, lease/fence, policy, fixture case, absolute deadline and four budgets. Optional identities use explicit null. Recipe identity additionally binds installation, exact image and deployment profile (launch-recipe.ts:41-43). Digests are identity checks, not MACs or authorization. Future changed fixed recipes must change their policy/recipe version.

Zod parsing clones current nested context/budget input and freezes each object. Policy parsing similarly clones/freezes its primitive fields. Expanded arrays, nested Docker-shaped objects and returned descriptor are frozen. The trusted branded expansion API has no request-time authority extension: the sole image comes from trusted policy, entrypoint/environment/resource policy are fixed, case is a finite positional argument, and no shell, caller path, mount, network or environment is accepted.

The recipe specifies network none, non-root UID/GID, read-only root, dropped capabilities, no-new-privileges, bounded resources and dedicated scratch. These are expected configuration values, not evidence that a daemon enforces them. Unexpected image defaults and exact daemon inspection remain backend gates.

## Verification and test quality

Independently executed from repository root, all exit 0:
- `bun --no-env-file test apps/server/src/modules/runtime/launch-spec.test.ts apps/server/src/modules/runtime/launch-recipe.test.ts`: 62 pass, 0 fail, 88 assertions.
- The exact strict no-emit invocation in runtime-008b/report.md, including both source files, both tests and verify-pure-launch.ts: zero diagnostics.
- `bun --no-env-file run .omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/runtime-008b/verify-pure-launch.ts`: all seven checks, injectionExpirySecretDenied and passed true.

Read the actual pure driver and tests, not just receipts. The driver only imports pure modules and hashes/describes synthetic requests. Writer LSP receipts are recorded in lsp.json; not independently rerun here.

Programming, TypeScript and remove-ai-slops skill perspectives were consulted, along with code-review-and-quality. No independent slop/abstraction violations found for this scope; the concrete recipe correctness failure H1 remains. Tests exercise denial boundaries with valid baseline inputs, exact deadline positive controls, mutation isolation, semantic digest changes and fixed externally consumed recipe properties. The fixed config assertions are appropriate contract tests, not runtime enforcement proof. No brittle prose/removal tests, unnecessary generic runner, unsafe escape hatch or needless boundary normalization was found.

## Operational gates and next bounded slice

WorkingDir /scratch/work (launch-recipe.ts:47) lies under the tmpfs mount. The inferred OCI startup failure is DISPROVED: the coordinator’s first actual Docker29.5.2 probe started successfully. Its second probe instead establishes H1: UID65534, cwdOwner0, cwdMode493 (0755), cwdWritable=false, homeWritable=true. I inspected the retained coordinator-cwd-probe.md with pinned local image, command flags, probe outputs and empty cleanup readback. I did not execute Docker. This evidence identifies a current fixed-policy incompatibility; it is not final-image or linux-systemd-v1 validation.

The smallest fix is WorkingDir /scratch plus trusted fixed fixture bootstrap creating owned private work/home children and changing directory before input/work. Do not weaken the non-root user, root filesystem or mount isolation. Repeat the actual write probe for the corrected bootstrap and update the descriptor assertion/ADR before approval. Final-image entry program, inherited defaults, architecture and containment remain additional unexecuted gates.

Next RFC-008c should remain a journal contract/transition slice with injected I/O:
1. Closed versioned historical record containing immutable context, lease/fence, spec and recipe identities, exact generated name, random ownership token, acknowledged full resource ID, runner unit, deadline, pending operation identity, cancellation, input sequence, terminal and cleanup facts.
2. Closed phases intent/creating/prepared/starting/running/stopping/stopped/quarantined; terminal-once and retained tombstones. Same attempt plus same identity is idempotent; mismatches and stale fences deny.
3. Durable intent-before-effect contract (atomic write, file fsync, rename, directory fsync for the later persistence adapter), exclusive writer and validated historical records without bypassing fresh launch admission.
4. Response loss, late acknowledgments after cancellation and unresolved create/start remain uncertain/quarantined. No caller-supplied settled boolean, replay, wildcard cleanup or claim that one absent query proves no effect.
5. Exact ownership verification before cleanup; stopped and cleanup-confirmed remain separate. Journal is a resource ledger, never a second DB queue, grant issuer or lease renewer.

No systemd/daemon/control transport/DB/native provider/credential execution was performed or approved by this review.

## Source identity

SHA256 independently checked against writer source-sha256.txt:
- launch-spec.ts: 0a64ef91ceca1a1764f90a10897e5b907035307c4eed8a0ddf6697717108807d
- launch-recipe.ts: e083d1a59b230677cd0d469060318129b9155280fb94aa29014fb1ba193490bd
- launch-spec.test.ts: e96f12061862a24b46aa825ecf581e53ec772fad7bab56c733b11aac1acb75b2
- launch-recipe.test.ts: 31a0411be7ddfc808388b384c0e098c8962fdb7617c99c2813bfa9043d82090a

Evidence root: .omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/runtime-008b. Current attempt resolved with omo-agent-toolkit ulw-loop status --json. This unique scoped copy does not replace the aggregate G002 lane.

