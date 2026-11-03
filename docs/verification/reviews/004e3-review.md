# RFC-004e3 independent code review

Date: 2026-10-22. Scope: existing-account operator CLI proof and the recorded runtime receipt. No product source changed. No Docker, database proof, auth proof, browser, staging, commit, worktree or production action performed.

- codeQualityStatus: WATCH
- recommendation: APPROVE
- reportPath: local evidence
- blockers: None. M1 resolved in followup below; M2 remains nonblocking.

## Findings

### CRITICAL

None found.

### HIGH

None found.

### MEDIUM

**M1 — Forbidden-operation exceptions can satisfy the missing-target test.** `apps/server/src/modules/identity/admin-operator.integration.test.ts:8` installs throwing hooks, then lines 17–23 assert only the runner's fixed failure output. `admin-operator.integration.ts:6–8,188–190` catches exceptions while the phase is still `target validation`. A regression that calls `setTimeout` or a hooked network operation inside that try before the target check therefore throws, is caught, and produces exactly the expected result. The current source does put the target check first; this is a regression-test weakness, not evidence of current unwanted I/O. Track attempted forbidden operations independently of their thrown error and assert zero after import and after the runner returns. Keep the exact denial/exit assertion. This matters for this verification slice because the test specifically claims to establish no I/O before target validation. Both required skill perspectives reject this false-positive test structure. Request changes for this narrow verification gap; no live rerun is needed to repair it.

**M2 — Existing launcher source-string pins provide weak behavioral coverage.** `scripts/verify-identity-auth.test.ts:52–57` checks source substrings for Compose flags, mutation acknowledgement and shell tracing rather than the arguments/environment actually used. Commented or unreachable copies can keep these checks green, while harmless shell restructuring can break them. The adjacent subprocess fixtures already offer a better seam for observed Docker arguments and proof-child environment. This is a nonblocking inherited-test follow-up, not a demonstrated 004e3 runtime regression. The metadata cases at lines 111–133 do exercise the extracted real predicate against adverse inputs, although the regex extraction couples them to shell layout. No deletion-only or natural-language prompt tests found.

### LOW

The reviewed working files contain pre-existing non-null assertions in `packages/db/src/identity-proof-client.ts:74,90,99` and `scripts/verify-identity-auth.test.ts:129`, contrary to the programming skill. The 004e3 completion record says no _new_ assertions were introduced; no pre-slice Git baseline was supplied to independently determine introduction. Do not conflate these existing style issues with a correctness failure in the ownership-helper reuse.

## Evidence inspected and scope limits

Read `tasks/README.md`, `tasks/004e3-verify-existing-account-admin-command.md`, `docs/checkpoints/identity-foundation.md`, `docs/operations/identity-admin.md`, `docs/verification/identity-auth.md`, and `/tmp/zetta-rfc004e3-plan.md`. Read the complete six scoped source/test files and relevant target guard, CLI entry point and ownership tests. No explicit notepad path was supplied; the task and checkpoint records were the available handoff context.

All six scoped source/test files are untracked in this working tree. `git diff` therefore cannot provide an isolated before/after 004e3 patch. This review assesses their full current contents and the claimed slice boundaries; it does not certify an unavailable historical diff. Unrelated tracked and untracked changes were preserved.

The durable runtime receipt is the `Actual runtime verification` section of `tasks/004e3-verify-existing-account-admin-command.md`: command, exit 0, six assertion labels, post-close summary and dedicated teardown. Its SQL claims match the inspected runner: full row snapshots for denials/rollback; an insert-rejecting audit constraint removed in finally; deliberate replacement with selected-session deletion and unrelated-session preservation; two actual CLI contenders observed blocked by the owner before release; one winner and matching singleton/membership/audit counts. This reviewer inspected the recorded receipt, not the prior live execution. No separate raw 004e3 transcript was present among the referenced artifacts; this limits independent historical corroboration and is not a fresh live-pass claim.

Installed `node_modules/.bun/pg-pool@3.14.0+5e0609b09ae208c8/node_modules/pg-pool/index.js` confirms pool removal can empty the client list before the client's asynchronous end callback, and emits `connect` before handing out the reserved client. Reusing `createAdminOperatorClientOwner` for all three pools is warranted; its end listener is installed before reservation and close awaits both shutdown and reserved termination. The proof awaits all owners and checks final health. The runner settles tracked children before fixture cleanup and retains its deadline through close.

No claim is made about credentials, login, effective cookie/cache revocation, browser transport, production permissions, invitation/replacement races or complete RFC-004 acceptance. The records appropriately leave those gates unfinished. The accepted auth and SQL proofs were not rerun after the shared proof-client change; their evidence remains historical.

## Independent checks

Executed:

```sh
bun --no-env-file test apps/server/src/modules/identity/admin-operator.integration.test.ts apps/server/src/modules/identity/admin-operator.test.ts packages/db/src/admin-operator-client.test.ts scripts/verify-identity-auth.test.ts
```

Result: Bun 1.3.14, 27 pass, 0 fail, 366 assertions, four files. These are offline checks; the shell fixtures replace Docker/Bun and the ownership tests use EventEmitter seams.

```sh
packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/identity/admin-operator.integration.ts apps/server/src/modules/identity/admin-operator.integration.test.ts packages/db/src/identity-proof-client.ts scripts/verify-identity-auth.test.ts
bash -n scripts/verify-identity-auth.sh
git diff --check
```

Result: no diagnostics/output. LSP, broad lint/build/suite and security scanner not run in this bounded read-only review; no claim of those gates passing. Whitespace check covers tracked differences only.

## Required skill perspectives

Loaded `omo:programming` SKILL.md and its TypeScript reference, and `omo:remove-ai-slops` SKILL.md before judging tests/maintainability. Review-only application: no cleanup agents or implementation edits. The overfit/slop pass found M1 and M2; programming also identified the existing non-null assertions noted above. No needless new production parsing, extraction, normalization or speculative abstraction found. Target/service checks are justified destructive-test boundaries; SQL snapshots and bounded UTF-8 capture serve actual proof requirements. Lifecycle helper reuse removes reliance on an insufficient pool-only shutdown signal.

## Acceptance boundary

Source/runtime design is otherwise suitable for the bounded proof, and no CRITICAL/HIGH issue was found. Fix M1 and rerun its focused offline check before accepting the independent verification gate. M2 and existing assertion cleanup are nonblocking follow-ups. Historical runtime evidence remains scoped to its recorded execution; neither this review nor passing offline tests completes parent RFC-004/004e.

Artifact placement: `omo-agent-toolkit ulw-loop status --json` reported evidence-layout v1 with no `currentAttemptDir`; this report is mirrored to the fallback `local evidence` as required.

## Followup acceptance, 2026-10-22

M1 RESOLVED. Independently read the corrected test: a sticky counter increments before every forbidden hook throws, with zero-attempt assertions after import and after runner return. Read `docs/verification/reviews/004e3-guard-fix.md`, its mutation harness, baseline/strengthened mutation JSON and copied-source descriptions. The baseline mutant exits 0 despite a timer before target validation; strengthened mutant exits 1 with observed count 1 versus expected 0. These artifacts substantiate the exact regression, rather than merely pinning new test text. Current actual-source test independently passed in the six-file followup run (66 tests, 345 assertions). Prior initial M1 wording above is historical and superseded by this section. Source acceptance: APPROVE / WATCH, no blockers; M2 remains a nonblocking inherited followup. No historical live proof was rerun.
