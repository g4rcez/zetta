# RFC-008b1: Fix writable fixture bootstrap

- **Parent:** [RFC-008b](008b-define-launch-spec-and-recipe.md)
- **Status:** Done for descriptor/bootstrap policy; coordinator accepts independent CLEAR/APPROVE review and independently repeated actual controls/cleanup. Production image and launcher remain unverified.
- **Scope:** launch-recipe.ts, launch-recipe.test.ts, this task and unique evidence only.

## Problem and correction

The actual pinned Bun base-image control showed that Docker creates `/scratch/work` root-owned 0755 when it is selected as the initial working directory beneath the scratch tmpfs. UID 65534 starts there but cannot write. The descriptor now starts the fixed trusted entrypoint in `/scratch`, the writable tmpfs mount itself. The future fixed fixture bootstrap must create fresh `/scratch/home` and `/scratch/work` with mode 0700 and change into `/scratch/work` before reading untrusted input or executing fixture behavior. Existing children must cause bootstrap failure, not be adopted. This task does not implement or build that fixture image.

## Validation

[Evidence report](../.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/runtime-008b1/report.md) records exact commands, source hashes and cleanup.

- Red first: updated recipe expectations fail against the old descriptor, 60 pass / 2 fail.
- Actual Docker control: old cwd is root-owned 0755 and unwritable by UID 65534.
- Actual Docker correction: `/scratch` bootstrap creates UID 65534-owned mode0700 home/work; chdir and both synthetic writes succeed. Exact disposable container names/label are absent after completion; isolated CLI home is removed.
- Focused suite: 62 pass, 0 fail, 90 assertions. Strict TypeScript and four-file LSP pass; native pure launch proof passes.
- Recursive freezing remains enforced; replacing initial cwd is rejected. Changing the admitted policy version changes both spec and identity digests.

## Policy identity and next consumer

The existing identity digest binds spec, installation, policy version and exact image. It does not hash recipe source or Docker configuration. A recipe change therefore requires a new trusted operator policy version; reusing the old policy version with the same spec/image would preserve the old digest despite changed code. No new runtime version mechanism is introduced. There are no deployed receipts in this source-only slice. Future provisioning must pin the launcher build/recipe implementation together with the operator policy version and final fixture image, and reject incompatible historical policy records.

Exports remain FixtureLaunchPolicy, createFixtureLaunchPolicy, expandFixtureRecipe and FixtureLaunchRecipe. The journal/backend consumer calls expandFixtureRecipe on an admitted spec and trusted policy. The image/bootstrap consumer must implement and prove the private-directory sequence before any untrusted input. The exact final image, image-default checks, daemon verification and Linux/systemd supervision remain future work; this synthetic proof establishes only the corrected cwd/bootstrap policy on the existing local Linux Docker engine.

No launch-spec, journal, launcher, ADR, shared task status or existing probe was edited. No image build/pull, install, provider, credential, DB or Git operation occurred.
