# RFC-008b: Define launch spec and fixture recipe

- **Parent:** [RFC-008](008-implement-isolated-process-supervision.md)
- **Status:** Done for pure LaunchSpec/recipe after008b1 correction and independent CLEAR/APPROVE review; operational launcher remains incomplete.
- **Decision:** [Runtime supervisor ADR](../docs/decisions/runtime-supervisor.md), accepted for this bounded slice through [008a independent review](../docs/verification/reviews/runtime-008a-review.md).

## Goal and scope

Provide a closed immutable launch request and one fixed no-network fixture recipe without journal, Docker/control transport or execution. Coordinator authorization permits the pure synthetic slice using accepted RFC-006 and RFC-007 storage/schema contracts; full RFC-007 dispatch and RFC-008 operational acceptance remain incomplete.

Owned files: launch-spec.ts, launch-recipe.ts, launch-spec.test.ts, launch-recipe.test.ts under apps/server/src/modules/runtime; this child; unique active-attempt evidence. Existing runtime files and root TASKS were not edited.

## Completion record

Implemented strict version-1 fixture-v1 LaunchSpec using the existing RunContext schema; fixed safe error codes; trusted clock/server-deadline/policy admission; readonly copied nested input; a canonical fixed-tuple digest containing every semantic field and explicit null optional context IDs. Admission does not extend absolute expiry on reconnect.

Implemented trusted FixtureLaunchPolicy construction for installation identity, exact lowercase sha256 image and policy version. expandFixtureRecipe produces an immutable Docker-shaped expected configuration with fixed Bun entrypoint, bounded fixture-case argv, fixed environment, non-root UID, private scratch, read-only root, dropped capabilities, no-new-privileges, finite CPU/RAM/PID/scratch policy and network none. No caller path/mount/env/CLI choice is admitted. identityDigest additionally binds installation/image/policy; it is not an authentication token.

Exports:

- launch-spec.ts: LaunchSpec, LaunchAdmission, LaunchSpecError, parseLaunchSpec, digestLaunchSpec.
- launch-recipe.ts: FixtureLaunchPolicy, createFixtureLaunchPolicy, expandFixtureRecipe, FixtureLaunchRecipe.

## Acceptance evidence

Final-source acceptance: [008b1](008b1-fix-writable-fixture-bootstrap.md) corrects the independently reproduced unwritable initial cwd. The initial directory is now `/scratch`; the trusted fixed fixture must create owned0700 home/work and change into work before untrusted input. Root and [independent reviewer](../docs/verification/reviews/runtime-008b-review.md) observed62tests90assertions, strict diagnostics and pure driver pass. Root also independently repeated actual old/fixed container controls: old directory unwritable, fixed owned/private work/home writable, cleanupVerified true and quarantineRequired false, exit0. Recipe SHA256 `b71067c2cf05258b2f4ae72e97f02e8f0e67559efd7e6fb06a1257cbb97cbb64`. This accepts descriptor policy, not the unbuilt final image/bootstrap or a running supervisor. Historical62/88 evidence below predates that correction.

Exact scenario matrix, commands, source hashes, tooling limits and cleanup.

- Red first: missing modules, exit 1.
- Final: `bun --no-env-file test apps/server/src/modules/runtime/launch-spec.test.ts apps/server/src/modules/runtime/launch-recipe.test.ts` => 62 pass, 0 fail, 88 assertions.
- Strict TypeScript no-emit passes; LSP on all four files reports no diagnostics.
- Native pure driver: seven checks plus injection/expiry/secret rejection all true, exit 0.
- Pure LOC: launch-spec 44, launch-recipe 50, spec tests 93, recipe tests 80; all below 250.
- Production hashes: launch-spec 0a64ef91ceca1a1764f90a10897e5b907035307c4eed8a0ddf6697717108807d; launch-recipe e083d1a59b230677cd0d469060318129b9155280fb94aa29014fb1ba193490bd.

## Next consumer and limits

The separately assigned journal worker calls parseLaunchSpec(raw, trustedAdmission), then expandFixtureRecipe(spec, trustedPolicy), and persists spec/identityDigest before effects. It owns actual receipt/name/ownership labels, stale-fence and duplicate/state handling, historical-record validation and crash reconciliation. No queue or capability-ready result is exported here.

The actual backend must establish scratch/work/home directories before process execution, reject unexpected image defaults, inspect daemon configuration, verify Linux/systemd capabilities and prove containment/cleanup. This slice creates no image or resource and does not establish Docker acceptability or native provider compatibility.

No raw HTTP/duplicate-key parsing, authorization, DB/grant resolution, journal, real clock/reboot confidence, Docker/systemd/service, environment modification, provider call, credential read, installation or Git mutation occurred. Native proof is pure-library evidence only. All in-memory work settles; no external cleanup is needed. JSON artifact Biome unavailable and the known optional skill checker/TS-version incompatibility are recorded without treating either as a pass.
