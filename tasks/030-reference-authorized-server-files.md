# RFC-030: Reference authorized server files

- **Module:** Chat
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-002](002-prove-multi-user-execution-isolation.md), [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-029](029-attach-owned-files-as-run-context.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Resolve server-file references from explicitly authorized roots without exposing the host filesystem.

## Non-goals

No arbitrary absolute path browser, access to .env/credential files, symlink escape or implicit access for snapshot readers.

## Source anchors and planned changes

- `apps/server/src/modules/files/server-references.ts (new)`
- `apps/web/src/features/chat/server-file-picker.tsx (new)`

## Contract and implementation steps

1. Use the accepted isolated workspace/root mapping; derive root ownership from the actor, not the submitted path.
2. Canonicalize and safely open files with traversal/symlink/race defenses and size/type limits; snapshot bounded content for the run.
3. Expose scoped search/select and readable rejection reasons without revealing inaccessible paths; record content hash/version provenance.

## Acceptance criteria

- [ ] Traversal, alternate encodings, symlink escape and unauthorized roots fail before any content enters context.
- [ ] File changes between selection and execution follow an explicit version policy; context is tied to a recorded hash.
- [ ] A snapshot of a conversation contains only allowed copied content, never a live server-file capability.

## Verification

Proposed command: `bun test apps/server/src/modules/files/server-references.test.ts`. Pure path-policy tests plus approved filesystem probes for symlink/TOCTOU, changed file and A/B roots.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Export the described module behavior with focused tests and a short contract handoff for dependent RFCs. Do not leave mock success paths in production code.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Not started. The implementing worker records approvals, changed paths, exported contracts, acceptance evidence, exact commands/diagnostics, skipped checks, remaining risks and newly unblocked RFCs here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Server file references inside me/<user> and shared only, realpath containment, credential-file denylist, handle-based read with sha256 recorded.

Evidence: apps/server/src/modules/chat/experience.integration.test.ts.
