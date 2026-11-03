# Zetta v1 — ordered RFC backlog

> Progressive implementation has started with foundation decisions. RFC-001 policy is accepted; no application feature is delivered by that acceptance. Product intent is confirmed; technical decisions and sensitive changes still need the gates in the plan.

## Start here

- **Current delivery path:** [release readiness](docs/release/release-readiness.md) and the per-RFC audits in [docs/audit](docs/audit/). Statuses below were re-assessed on 2026-10-23 against the simplified v1 implementation: 73 Done, 8 Review (implemented with a stated limit), 1 Blocked (external access or infrastructure). Each RFC file has a dated completion record.

- [Wiki: user journeys and architecture](docs/wiki/README.md)
- [Confirmed intent](docs/intent/zetta-v1.md)
- [Redesign intent](docs/intent/redesign.md) and the target [DESIGN.md](DESIGN.md)
- [Implementation plan and architecture gates](tasks/plan.md)
- [Small-model execution contract and definition of done](tasks/README.md)

Assign one RFC at a time. Read prerequisites and completion records before work. There are **88 RFCs across 21 modules**. IDs are stable identifiers, not execution ranks. RFC-069/070 own durable chat/context; RFC-071–082 cover the approved management, browser/computer and visual-workflow scope; RFC-083–088 cover the chat-first redesign.

**Global dependency-safe order** (independent ready tasks may run in parallel):

```text
001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020
074 071 022 023 024 025 069 070 026 021 027 028 029 030 031 032 033 034 035
036 037 059 038 039 040 041 042 043 044 045 046 047 048 049 050 051 052 053
054 055 056 057 058 060 061 062 063 064 075 076 077 078 079 080 081 073 072
082 065 066 067 068
083 084 085 086 087 088
```

Onboarding is intentionally **configuration services 020 → shell/chat 024/026 → real conversation and satisfaction 021**. A bot can enter a bounded setup conversation before it is admitted to ordinary work. RFC-024 must not depend on completed onboarding.

Module grouping below is for ownership; explicit dependencies determine readiness and safe parallel work. Status changes require evidence in the RFC completion record.

## Execution rules

- RFC-001/002/003 establish ownership, isolation and test seams before real multi-user execution.
- Research RFCs require accepted evidence and decisions before their implementation consumers start. Keep unsupported/ambiguous integrations blocked.
- Run focused checkpoints after every 2–3 completed tasks and at each module boundary below. Do not infer approval for builds, full suites, external accounts or deployment.
- Proposed paths in RFCs are handoff targets, not existing APIs. Coordinate shared schema barrels, migrations, manifests, server wiring and route generation with one owner.
- Parallel candidates: RFC-013–018 after prerequisites; RFC-046 and RFC-048 research; independent chat slices once their dependencies are done. Do not overlap shared integration writes.
- Status vocabulary: Proposed, Blocked, Ready, In progress, Review, Done. Update rows only with evidence in the RFC completion record.

## Module order and checkpoints

### 1. Foundation

| RFC                                                            | Task                                   | Prerequisites | Status |
| -------------------------------------------------------------- | -------------------------------------- | ------------- | ------ |
| [RFC-001](tasks/001-approve-domain-and-ownership-contracts.md) | Approve domain and ownership contracts | None          | Done   |
| [RFC-002](tasks/002-prove-multi-user-execution-isolation.md)   | Prove multi-user execution isolation   | RFC-001       | Done   |
| [RFC-003](tasks/003-establish-focused-test-seams.md)           | Establish focused test seams           | RFC-001       | Done   |

**Module checkpoint:** Ownership matrix is approved; isolation design and synthetic proof requirements are explicit; test imports have no infrastructure side effects.

RFC-002 is accepted as supported no-network research/design with13 actual synthetic scenarios and independent readiness review. It unblocks the pure RFC-006 contract. Real egress, secret resolution, native harness and browser/computer proofs remain required in their owning implementations and final release gate.

### 2. Identity

| RFC                                                                       | Task                                              | Prerequisites    | Status |
| ------------------------------------------------------------------------- | ------------------------------------------------- | ---------------- | ------ |
| [RFC-004](tasks/004-implement-approved-enrollment-and-admin-bootstrap.md) | Implement approved enrollment and admin bootstrap | RFC-001, RFC-003 | Done   |
| [RFC-005](tasks/005-enforce-actor-and-resource-access-boundaries.md)      | Enforce actor and resource access boundaries      | RFC-004          | Done   |

RFC-004 is implemented through its [bounded 004a–004f child documents](tasks/004-implement-approved-enrollment-and-admin-bootstrap.md#bounded-child-slices). This parent row remains the status authority; a source-only child is not complete enrollment or proven database concurrency.

The integrated identity scope passed actual operator CLI, public-auth/DB and [browser journeys](docs/verification/identity-browser/walkthrough.md), followed by independent WATCH/APPROVE review. RFC-005 supplies the session/current-membership and ownership contract; each later resource module must prove its actual scoped queries rather than inheriting automatic protection. No user/pi work was staged or committed. No production deployment, real native harness or complete v1 readiness is implied.

**Module checkpoint:** Two-user/member/admin allow-deny matrix passes; bootstrap and removed-member behavior are verified.

### 3. Execution runtime

**Cross-module order:** RFC-006 → Connections RFC-007 below → RFC-008–011. Do not finish this module before its connection prerequisite.

| RFC                                                                 | Task                                        | Prerequisites             | Status |
| ------------------------------------------------------------------- | ------------------------------------------- | ------------------------- | ------ |
| [RFC-006](tasks/006-define-harness-contract-and-fixture-adapter.md) | Define harness contract and fixture adapter | RFC-002, RFC-003          | Done   |
| [RFC-008](tasks/008-implement-isolated-process-supervision.md)      | Implement isolated process supervision      | RFC-002, RFC-006, RFC-007 | Review |
| [RFC-009](tasks/009-persist-run-lifecycle-and-idempotency.md)       | Persist run lifecycle and idempotency       | RFC-005, RFC-006          | Done   |
| [RFC-010](tasks/010-dispatch-and-recover-durable-work.md)           | Dispatch and recover durable work           | RFC-008, RFC-009          | Done   |
| [RFC-011](tasks/011-expose-owned-run-events-with-replay.md)         | Expose owned run events with replay         | RFC-009, RFC-010          | Done   |

**Module checkpoint:** Fixture run survives reconnect; cancellation cleans up; crash recovery does not duplicate or silently retry uncertain effects.

### 4. Connections

| RFC                                                            | Task                                   | Prerequisites    | Status |
| -------------------------------------------------------------- | -------------------------------------- | ---------------- | ------ |
| [RFC-007](tasks/007-store-user-owned-connection-references.md) | Store user-owned connection references | RFC-002, RFC-005 | Done   |

**Module checkpoint:** User-owned connection references survive restart and revoke without leaking or falling back to global credentials.

### 5. Harness adapters

| RFC                                                             | Task                                    | Prerequisites             | Status |
| --------------------------------------------------------------- | --------------------------------------- | ------------------------- | ------ |
| [RFC-012](tasks/012-research-six-harness-compatibility.md)      | Research six-harness compatibility      | RFC-002, RFC-006          | Done   |
| [RFC-013](tasks/013-implement-pi-execution-adapter.md)          | Implement Pi execution adapter          | RFC-008, RFC-010, RFC-012 | Done   |
| [RFC-014](tasks/014-implement-codex-execution-adapter.md)       | Implement Codex execution adapter       | RFC-008, RFC-010, RFC-012 | Done   |
| [RFC-015](tasks/015-implement-omp-execution-adapter.md)         | Implement OMP execution adapter         | RFC-008, RFC-010, RFC-012 | Done   |
| [RFC-016](tasks/016-implement-claude-code-execution-adapter.md) | Implement Claude Code execution adapter | RFC-008, RFC-010, RFC-012 | Done   |
| [RFC-017](tasks/017-implement-opencode-execution-adapter.md)    | Implement OpenCode execution adapter    | RFC-008, RFC-010, RFC-012 | Done   |
| [RFC-018](tasks/018-implement-cursor-execution-adapter.md)      | Implement Cursor execution adapter      | RFC-008, RFC-010, RFC-012 | Done   |
| [RFC-019](tasks/019-build-harness-and-account-setup-ui.md)      | Build harness and account setup UI      | RFC-007, RFC-012, RFC-013 | Done   |

**Module checkpoint:** All six adapter contracts pass; real compatibility stays blocked until approved smoke evidence exists. UI readiness matches reality.

### 6. Bots and teams

| RFC                                                           | Task                                  | Prerequisites                      | Status |
| ------------------------------------------------------------- | ------------------------------------- | ---------------------------------- | ------ |
| [RFC-020](tasks/020-implement-versioned-bot-configuration.md) | Implement versioned bot configuration | RFC-005, RFC-006, RFC-007          | Done   |
| [RFC-022](tasks/022-provision-one-personal-chief-per-user.md) | Provision one personal chief per user | RFC-004, RFC-020                   | Done   |
| [RFC-023](tasks/023-create-bot-teams-and-sidebar-groups.md)   | Create bot teams and sidebar groups   | RFC-001, RFC-020                   | Done   |
| [RFC-024](tasks/024-build-chat-first-navigation-shell.md)     | Build chat-first navigation shell     | RFC-020, RFC-022, RFC-023, RFC-071 | Done   |
| [RFC-021](tasks/021-build-bot-onboarding-and-settings.md)     | Build bot onboarding and settings     | RFC-019, RFC-020, RFC-026, RFC-071 | Done   |

**Module checkpoint:** Configure a bot, receive a real selected-harness response, answer the satisfaction question explicitly, and only then admit ordinary work. No/adjust/retest and A-ready/B-unready cases pass. One personal chief remains stable across visual workspace moves.

### 7. Chat

| RFC                                                                   | Task                                          | Prerequisites                      | Status |
| --------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------- | ------ |
| [RFC-025](tasks/025-persist-private-conversations-and-messages.md)    | Persist private conversations and messages    | RFC-005, RFC-009, RFC-020          | Done   |
| [RFC-069](tasks/069-persist-assistant-and-tool-output.md)             | Persist assistant and tool output             | RFC-011, RFC-025                   | Done   |
| [RFC-070](tasks/070-build-private-multi-turn-run-context.md)          | Build private multi-turn run context          | RFC-013, RFC-025, RFC-069          | Done   |
| [RFC-026](tasks/026-connect-private-chat-composer-to-runs.md)         | Connect private chat composer to runs         | RFC-011, RFC-024, RFC-025, RFC-070 | Done   |
| [RFC-027](tasks/027-render-streaming-history-and-reconnect-states.md) | Render streaming history and reconnect states | RFC-011, RFC-026, RFC-071          | Done   |
| [RFC-028](tasks/028-add-safe-markdown-composition-and-rendering.md)   | Add safe Markdown composition and rendering   | RFC-026                            | Done   |
| [RFC-029](tasks/029-attach-owned-files-as-run-context.md)             | Attach owned files as run context             | RFC-007, RFC-025, RFC-026          | Done   |
| [RFC-030](tasks/030-reference-authorized-server-files.md)             | Reference authorized server files             | RFC-002, RFC-025, RFC-029          | Done   |
| [RFC-031](tasks/031-add-message-threads.md)                           | Add message threads                           | RFC-025, RFC-027                   | Done   |
| [RFC-032](tasks/032-mention-and-route-to-visible-bots.md)             | Mention and route to visible bots             | RFC-020, RFC-025, RFC-026          | Done   |
| [RFC-033](tasks/033-add-message-reactions.md)                         | Add message reactions                         | RFC-025, RFC-027                   | Done   |

**Module checkpoint:** Private chat with streaming, Markdown, attachments, server references, threads, mentions and reactions passes scoped success/failure checks.

### 8. Chat publication

| RFC                                                              | Task                                     | Prerequisites                                        | Status |
| ---------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------- | ------ |
| [RFC-034](tasks/034-capture-immutable-conversation-snapshots.md) | Capture immutable conversation snapshots | RFC-025, RFC-029, RFC-030, RFC-031, RFC-033, RFC-032 | Done   |
| [RFC-035](tasks/035-build-team-read-only-snapshot-viewer.md)     | Build team read-only snapshot viewer     | RFC-024, RFC-034, RFC-028                            | Done   |

**Module checkpoint:** Entire multi-page chat freezes at a cutoff; team readers cannot mutate it or resolve original resources.

### 9. Chief delegation

| RFC                                                          | Task                                 | Prerequisites                                                 | Status |
| ------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------- | ------ |
| [RFC-036](tasks/036-dispatch-an-owned-specialist-subtask.md) | Dispatch an owned specialist subtask | RFC-010, RFC-020, RFC-022, RFC-025, RFC-013, RFC-070, RFC-021 | Done   |
| [RFC-037](tasks/037-aggregate-bounded-specialist-work.md)    | Aggregate bounded specialist work    | RFC-036, RFC-027, RFC-071                                     | Done   |

**Module checkpoint:** Chief delegates with initiator connections and bounded fanout. Partial results identify responsible bots and durable outputs; blockers map to one attention item with repair-and-return, not automatic replay.

### 10. Routines

| RFC                                                                   | Task                                          | Prerequisites                               | Status |
| --------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------- | ------ |
| [RFC-038](tasks/038-define-owned-schedules-and-routine-actions.md)    | Define owned schedules and routine actions    | RFC-009, RFC-020, RFC-025, RFC-070, RFC-021 | Done   |
| [RFC-039](tasks/039-dispatch-timezone-aware-scheduled-occurrences.md) | Dispatch timezone-aware scheduled occurrences | RFC-010, RFC-038                            | Done   |
| [RFC-040](tasks/040-build-routine-calendar-and-editor.md)             | Build routine calendar and editor             | RFC-024, RFC-038, RFC-039, RFC-059          | Done   |
| [RFC-041](tasks/041-show-routine-run-history-and-outcomes.md)         | Show routine run history and outcomes         | RFC-011, RFC-027, RFC-039, RFC-040, RFC-071 | Done   |

**Module checkpoint:** Successful task/instruction → understandable routine summary → first occurrence → durable result works. Timezone/DST, readiness, overlap/pause/restart and attention attribution agree across calendar/history/kanban.

### 11. Application integrations

| RFC                                                                | Task                                       | Prerequisites                      | Status |
| ------------------------------------------------------------------ | ------------------------------------------ | ---------------------------------- | ------ |
| [RFC-042](tasks/042-approve-mcp-and-source-connection-contract.md) | Approve MCP and source connection contract | RFC-007, RFC-012                   | Done   |
| [RFC-043](tasks/043-implement-scoped-mcp-tool-sessions.md)         | Implement scoped MCP tool sessions         | RFC-008, RFC-042                   | Done   |
| [RFC-044](tasks/044-configure-bot-integration-bindings.md)         | Configure bot integration bindings         | RFC-021, RFC-043, RFC-027, RFC-071 | Done   |
| [RFC-045](tasks/045-prove-source-to-briefing-context-flow.md)      | Prove source-to-briefing context flow      | RFC-037, RFC-041, RFC-044          | Done   |

**Module checkpoint:** Approved sources feed scoped context; MCP sessions close; selected real source gaps remain visible.

### 12. Decisions

| RFC                                                          | Task                                 | Prerequisites             | Status |
| ------------------------------------------------------------ | ------------------------------------ | ------------------------- | ------ |
| [RFC-046](tasks/046-identify-and-verify-jev-integration.md)  | Identify and verify Jev integration  | RFC-007                   | Done   |
| [RFC-047](tasks/047-implement-jev-decision-adapter.md)       | Implement Jev decision adapter       | RFC-046, RFC-007, RFC-009 | Done   |
| [RFC-048](tasks/048-identify-and-verify-laya-integration.md) | Identify and verify Laya integration | RFC-007                   | Done   |
| [RFC-049](tasks/049-implement-laya-decision-adapter.md)      | Implement Laya decision adapter      | RFC-048, RFC-007, RFC-009 | Done   |
| [RFC-050](tasks/050-configure-bounded-decision-routing.md)   | Configure bounded decision routing   | RFC-047, RFC-049, RFC-020 | Done   |

**Module checkpoint:** Jev and Laya identities/protocols are verified; typed results cannot trigger unconfigured actions; account/data egress is approved.

### 13. Hooks

| RFC                                                              | Task                                     | Prerequisites                               | Status |
| ---------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------- | ------ |
| [RFC-051](tasks/051-define-ordered-hook-contracts.md)            | Define ordered hook contracts            | RFC-006, RFC-009, RFC-020                   | Done   |
| [RFC-052](tasks/052-execute-bounded-hooks-around-model-calls.md) | Execute bounded hooks around model calls | RFC-010, RFC-025, RFC-050, RFC-051, RFC-070 | Done   |
| [RFC-053](tasks/053-configure-and-inspect-bot-hooks.md)          | Configure and inspect bot hooks          | RFC-021, RFC-051, RFC-052                   | Done   |

**Module checkpoint:** Ordered transforms, stop and owned background actions work; dry-run previews have no side effects.

### 14. Persistent memory

| RFC                                                          | Task                                 | Prerequisites                      | Status |
| ------------------------------------------------------------ | ------------------------------------ | ---------------------------------- | ------ |
| [RFC-054](tasks/054-select-hermes-memory-mechanism.md)       | Select Hermes memory mechanism       | RFC-001, RFC-002                   | Done   |
| [RFC-055](tasks/055-persist-scoped-memory-records.md)        | Persist scoped memory records        | RFC-005, RFC-054                   | Done   |
| [RFC-056](tasks/056-retrieve-bounded-relevant-context.md)    | Retrieve bounded relevant context    | RFC-055, RFC-006, RFC-025, RFC-070 | Done   |
| [RFC-057](tasks/057-expose-controlled-memory-write-tools.md) | Expose controlled memory write tools | RFC-055, RFC-056, RFC-006, RFC-013 | Done   |
| [RFC-058](tasks/058-inspect-correct-and-forget-memories.md)  | Inspect correct and forget memories  | RFC-021, RFC-055, RFC-056, RFC-059 | Done   |

**Module checkpoint:** Knowledge survives restart, stays scoped, supports correction/deletion and cannot bypass privacy through native harness memory.

### 15. Instructions and learning

| RFC                                                           | Task                                  | Prerequisites                                        | Status |
| ------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- | ------ |
| [RFC-059](tasks/059-build-versioned-instruction-library.md)   | Build versioned instruction library   | RFC-005, RFC-020                                     | Done   |
| [RFC-060](tasks/060-resolve-instruction-and-skill-context.md) | Resolve instruction and skill context | RFC-012, RFC-056, RFC-059                            | Done   |
| [RFC-061](tasks/061-learn-reusable-procedures-after-tasks.md) | Learn reusable procedures after tasks | RFC-037, RFC-057, RFC-059, RFC-060, RFC-040, RFC-058 | Done   |

**Module checkpoint:** Reusable procedures are versioned and scoped; repeated completion does not duplicate learning or cause reflection loops.

### 16. Self-configuration

| RFC                                                              | Task                                     | Prerequisites                                                          | Status |
| ---------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- | ------ |
| [RFC-062](tasks/062-propose-and-display-configuration-diffs.md)  | Propose and display configuration diffs  | RFC-020, RFC-021, RFC-071                                              | Done   |
| [RFC-063](tasks/063-apply-only-explicitly-approved-versions.md)  | Apply only explicitly approved versions  | RFC-062                                                                | Done   |
| [RFC-073](tasks/073-configure-resources-through-any-bot-chat.md) | Configure resources through any bot chat | RFC-020, RFC-021, RFC-026, RFC-038, RFC-063, RFC-075, RFC-079, RFC-081 | Done   |

**Module checkpoint:** Exact diffs require explicit authorized approval; stale/replayed approval cannot overwrite newer versions.

### 17. Attention and task management

| RFC                                                          | Task                                 | Prerequisites                                                 | Status |
| ------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------- | ------ |
| [RFC-071](tasks/071-define-common-in-app-attention-state.md) | Define common in-app attention state | RFC-005, RFC-009, RFC-011                                     | Done   |
| [RFC-072](tasks/072-build-user-attention-kanban.md)          | Build user-attention kanban          | RFC-071, RFC-024, RFC-027, RFC-037, RFC-041, RFC-044, RFC-063 | Done   |

**Module checkpoint:** Sidebar/activity/kanban agree on private source-linked pending items. Attribution, durable results and repair-return work; reading or moving a card cannot authorize or complete work.

### 18. Browser and computer use

| RFC                                                                   | Task                                          | Prerequisites                               | Status |
| --------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------- | ------ |
| [RFC-074](tasks/074-select-required-browser-and-computer-backends.md) | Select required browser and computer backends | RFC-002, RFC-012                            | Done   |
| [RFC-075](tasks/075-manage-scoped-browser-profiles.md)                | Manage scoped browser profiles                | RFC-007, RFC-008, RFC-074, RFC-020          | Done   |
| [RFC-076](tasks/076-expose-isolated-browser-automation-tools.md)      | Expose isolated browser automation tools      | RFC-006, RFC-013, RFC-075, RFC-029          | Done   |
| [RFC-077](tasks/077-run-isolated-computer-use-sessions.md)            | Run isolated computer-use sessions            | RFC-006, RFC-008, RFC-013, RFC-074, RFC-030 | Done   |
| [RFC-078](tasks/078-provide-secure-takeover-and-hand-back.md)         | Provide secure takeover and hand-back         | RFC-027, RFC-071, RFC-076, RFC-077          | Done   |

**Module checkpoint:** Both real browser and desktop tasks work under isolated user identity. Profile sharing is explicit and same-user only; takeover protects credentials and hands control back without replaying uncertain actions.

### 19. Visual workflows

| RFC                                                                  | Task                                         | Prerequisites                      | Status |
| -------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------- | ------ |
| [RFC-079](tasks/079-define-versioned-conditional-workflow-graphs.md) | Define versioned conditional workflow graphs | RFC-005, RFC-009, RFC-020          | Done   |
| [RFC-080](tasks/080-execute-durable-workflow-steps.md)               | Execute durable workflow steps               | RFC-010, RFC-039, RFC-050, RFC-079 | Done   |
| [RFC-081](tasks/081-build-visual-workflow-editor.md)                 | Build visual workflow editor                 | RFC-024, RFC-079, RFC-080          | Done   |
| [RFC-082](tasks/082-inspect-workflow-progress-and-repair-paths.md)   | Inspect workflow progress and repair paths   | RFC-027, RFC-071, RFC-081, RFC-072 | Done   |

**Module checkpoint:** A nontechnical user can configure a conditional graph, understand its branches, publish/test it and inspect partial results. Workflow blockers use the same attention/repair path; published versions and actor identity survive restart.

### 20. Operations and release

| RFC                                                                      | Task                                             | Prerequisites                                                                                                                                                    | Status  |
| ------------------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| [RFC-064](tasks/064-add-privacy-safe-execution-audit-views.md)           | Add privacy-safe execution audit views           | RFC-011, RFC-041, RFC-052, RFC-057, RFC-063, RFC-071                                                                                                             | Done    |
| [RFC-065](tasks/065-document-and-verify-recovery-boundaries.md)          | Document and verify recovery boundaries          | RFC-010, RFC-039, RFC-055, RFC-064, RFC-075, RFC-077, RFC-080                                                                                                    | Done    |
| [RFC-066](tasks/066-verify-cross-user-isolation-end-to-end.md)           | Verify cross-user isolation end to end           | RFC-013, RFC-014, RFC-015, RFC-016, RFC-017, RFC-018, RFC-035, RFC-037, RFC-044, RFC-053, RFC-058, RFC-060, RFC-063, RFC-064, RFC-072, RFC-073, RFC-078, RFC-080 | Review  |
| [RFC-067](tasks/067-verify-representative-v1-user-workflows.md)          | Verify representative v1 user workflows          | RFC-028, RFC-032, RFC-033, RFC-035, RFC-037, RFC-041, RFC-045, RFC-050, RFC-053, RFC-058, RFC-061, RFC-063, RFC-021, RFC-072, RFC-073, RFC-078, RFC-082          | Done    |
| [RFC-068](tasks/068-gate-release-on-real-compatibility-and-readiness.md) | Gate release on real compatibility and readiness | RFC-013, RFC-014, RFC-015, RFC-016, RFC-017, RFC-018, RFC-047, RFC-049, RFC-065, RFC-066, RFC-067                                                                | Blocked |

**Module checkpoint:** All-six-harness and both-decision-provider real evidence, privacy, recovery and user-workflow gates produce an explicit go/no-go.

### 21. Redesign

| RFC                                                                   | Task                                                  | Prerequisites                      | Status |
| --------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------- | ------ |
| [RFC-083](tasks/083-apply-redesign-tokens-and-contrast-guard.md)      | Apply redesign tokens and contrast guard              | —                                  | Done   |
| [RFC-084](tasks/084-rebuild-sidebar-shell-for-chat-first-redesign.md) | Rebuild the sidebar shell for the chat-first redesign | RFC-083, RFC-024, RFC-071          | Done   |
| [RFC-085](tasks/085-persist-per-user-bot-order.md)                    | Persist a per-user bot order                          | RFC-084, RFC-023                   | Done   |
| [RFC-086](tasks/086-restyle-chat-surface-and-context-panel.md)        | Restyle the chat surface and add the context panel    | RFC-083, RFC-084, RFC-026, RFC-071 | Done   |
| [RFC-087](tasks/087-restyle-remaining-pages-to-tokens.md)             | Restyle the remaining pages to the tokens             | RFC-083, RFC-084                   | Done   |
| [RFC-088](tasks/088-verify-redesign-accessibility-and-finish.md)      | Verify the redesign's accessibility and finish        | RFC-083–087                        | Done   |

**Module checkpoint:** Every text pair is 7:1 or more in light and dark (the token test passes), components use only tokens, the sidebar order follows the user on every device, and the finish review says "ship".

### 22. Multiplayer rooms

Intent: [multiplayer rooms](docs/intent/multiplayer-rooms.md). The phases are defined in RFC-089; each child file is written when its phase starts.

| RFC                                       | Task                                            | Prerequisites      | Status      |
| ----------------------------------------- | ----------------------------------------------- | ------------------ | ----------- |
| [RFC-089](tasks/089-multiplayer-rooms.md) | Design multiplayer rooms (parent of 089a–089f)  | RFC-001, RFC-023   | In progress |
| RFC-089a                                  | Team human members                              | RFC-089            | Done        |
| RFC-089b                                  | Authored messages and acting user               | RFC-089a           | Proposed    |
| RFC-089c                                  | Cross-user approval and room trust              | RFC-089b           | Proposed    |
| RFC-089d                                  | Team accounts and Team Bots                     | RFC-089b           | Proposed    |
| RFC-089e                                  | Team memory                                     | RFC-089d           | Proposed    |
| RFC-089f                                  | Fork a chat into a room, and the Team Bot nudge | RFC-089c, RFC-089d | Proposed    |

**Module checkpoint:** A team member reads and posts in every team room and a non-member cannot. A request to another member's personal bot waits for that owner, and "always allow" is per teammate and per room. A Team Bot uses only team accounts and team memory. A forked chat leaves the source chat unchanged and carries no file reference or credential-looking text.

## Requirement coverage

| Confirmed requirement                                            | Owning RFCs                      |
| ---------------------------------------------------------------- | -------------------------------- |
| Login, admin and private data isolation                          | 001–005, 007–008, 066            |
| Six harnesses and account setup                                  | 006, 012–019, 068                |
| Bot onboarding/configuration and personal chief                  | 020–022                          |
| Visual workspaces, inner groups and sidebar                      | 023–024                          |
| Private chat, durable bot/tool history and multi-turn context    | 025–027, 069–070                 |
| Markdown, files, references, threads, mentions, reactions        | 028–033                          |
| Read-only full-conversation team snapshot                        | 034–035                          |
| Chief delegation                                                 | 036–037                          |
| Schedules, routine actions and calendar                          | 038–041                          |
| Per-user app/MCP access and source context                       | 007, 042–045                     |
| Jev and Laya decisions                                           | 046–050                          |
| Middleware-style hooks                                           | 051–053                          |
| Hermes-style persistent memory                                   | 054–058                          |
| Instructions, skills and self-learning                           | 059–061                          |
| User-approved configuration diffs and form/any-bot-chat setup    | 021, 062–063, 073                |
| Common in-app attention and task kanban                          | 024, 027, 037, 041, 064, 071–072 |
| Browser profiles, browser tools, desktop use and secure takeover | 074–078                          |
| Visual conditional workflows, execution and repair               | 079–082                          |
| Audit, recovery and acceptance evidence                          | 064–068                          |
| Chat-first redesign, user bot order and AAA color contrast       | 083–088                          |

## Open gates — not silent scope cuts

- Human membership cardinality, enrollment and shared-bot editing: RFC-001.
- OS/container boundary and native CLI state containment: RFC-002.
- Exact installed/supported harness protocols: RFC-012; all six are required.
- Markdown/calendar dependencies: RFC-028 and RFC-040; request approval, do not install.
- Initial source connections: RFC-042. Required browser/computer backends and isolation: RFC-074–078; research selects how to implement them, not whether to include them.
- Bounded visual workflow graph/node catalog: RFC-079. Editor/execution/inspection are required in RFC-080–082; full n8n parity is not implied.
- Exact Jev/Laya products and data egress: RFC-046/048.
- Exact Hermes mechanism, reuse/license and deletion semantics: RFC-054.
- Per-user bot order: RFC-085 stores it as `user_preference.bot_order` (applied 2026-11-01).
- Marketplace, team-map canvas, external notifications and configurable per-action permissions remain deferred. Visual workflows, browser/computer use, the attention kanban and local access enforcement are required in v1.
