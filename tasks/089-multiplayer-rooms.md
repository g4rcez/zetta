# RFC-089: Multiplayer rooms

- **Module:** Multiplayer rooms
- **Status:** In progress (RFC-089a done); see [root index](../TASKS.md#22-multiplayer-rooms).
- **Type:** Design / parent of RFC-089a to RFC-089f
- **Dependencies:** [RFC-001](001-approve-domain-and-ownership-contracts.md), [RFC-023](023-create-bot-teams-and-sidebar-groups.md), [RFC-035](035-build-team-read-only-snapshot-viewer.md)
- **Size target:** Design only. Each phase below is one focused session and gets its own child file when it starts.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/multiplayer-rooms.md), [ownership decisions](../docs/decisions/ownership.md) and [the isolation matrix test](../apps/server/src/modules/isolation-matrix.integration.test.ts). Inspect the source anchors below before editing. Proposed names are not existing contracts. This RFC authorizes no install, schema, auth, API change, external call, build or deployment by itself. Every schema change needs approval first.

State today (observed):

- Rooms, teams, turns, proposals, attention items and connections each have one `owner_user_id`.
- `discussion_member` and `team_member` hold bots only. There is no human member.
- `message` has no author user. Every human message has `role: "user"` under the owner.
- A room turn always runs as the room owner: the worker calls `issueBackgroundActor(lookup, c.turn.ownerUserId)`.
- A run takes credentials from the acting user, never from the bot owner (`connections.envFor(actor, bot)`).
- The only cross-user sharing is a team-visible bot (configuration only) and a read-only snapshot.

## Goal

Make rooms multiplayer, as described in the confirmed intent: human team members, authored messages, owner approval with per-room trust for personal bots, Team Bots on team accounts with team memory, and a way to fork a chat into a team room.

## Non-goals

Multiplayer 1:1 chats, presence and typing indicators, co-editing artifacts or the wiki, cross-user bot calls outside rooms, push or email notifications, per-tool-call approval. No change to the installation model: one admin, one membership set, no organizations.

## Source anchors and planned changes

Existing code to reuse:

- `apps/server/src/modules/identity/access.ts:69` `requireOwned`, `:58` `issueBackgroundActor`: the access pattern. `requireTeamMember` goes next to them.
- `apps/server/src/modules/discussions/store.ts:115` `loadOwned`, `:387` `gate()`, `:889` `postAsOwner`: owner-only room access, the turn gate, and the owner-only post.
- `apps/server/src/modules/discussions/worker.ts:38`: where the acting user is chosen.
- `apps/server/src/modules/chat/service.ts:4172` `decideProposal`: resolves a proposal for its owner.
- `apps/server/src/modules/features/attention.ts:22` `raiseAttention`: creates an item for a user, keyed by `sourceKey`.
- `apps/server/src/modules/integrations/mcp.ts:121` `secretOwner`: the existing "team" principal swap for an admin-shared plugin server.
- `apps/server/src/modules/chat/pipeline.ts:67` (memory comes from the requesting user) and `:113` `codeEnabled` (code runs only for the bot owner).
- `apps/server/src/modules/features/snapshots.ts:22` `build`: the safety pass for shared content.
- `apps/web/src/features/discussions/discussions-page.tsx:472`: every `role: "user"` row shows as "me".

Planned changes (all proposed):

- `packages/db/src/schema/teams.ts`: `team_person`.
- `packages/db/src/schema/chat.ts`: `message.author_user_id`, `bot.usage`, `bot.team_id`.
- `packages/db/src/schema/discussions.ts`: `discussion_turn.requested_by_user_id`, `discussion_turn.runs_as`, `room_grant`.
- `packages/db/src/schema/connections.ts`: `connection.scope`, `connection.team_id`.
- `apps/server/src/modules/teams/`, `discussions/`, `connections/`, `chat/`, `features/`: store, route and service changes.
- `apps/web/src/features/teams/`, `discussions/`, `attention/`: member management, author display, approval card.

## Contract and implementation steps

Follow the project rules in [CLAUDE.md](../CLAUDE.md): string enums, not booleans; UUID v7 only; migrations generated and applied with the schema change and no data loss; no permanent database triggers; bot mentions render the bot identity. Filters live in the URL.

### RFC-089a: Team human members (Done)

1. `team_person (team_id, user_id, role, activation_revision)` with `role` in `owner | member`. The team creator gets the `owner` row; the migration backfills one for every existing team. A person counts only while the installation membership is active under the same `activation_revision`, so removing a member ends their access at once and enrolling again does not bring it back (the owner adds them again).
2. `requireTeamMember(actor, resource, isMember)` sits next to `requireOwned`. The membership check itself is `teams/people.ts` (`isPerson`, `teamIds`).
3. Read paths for a person of the room's team: room `get`, `steps` and `list`; conversation `getConversation` and `listMessages`, for a conversation of kind `discussion` only. Every write keeps the owner check.
4. The team owner adds people (from active installation members; names only, no email) and removes them: `GET/POST /api/teams/:id/people`, `GET /api/teams/:id/candidates`, `DELETE /api/teams/:id/people/:userId`. The owner cannot be removed. A person can list the people of their own team.
5. Web: a People panel in team settings; the room page shows a member who is not the owner a read-only room (no composer, no room actions, the owner's name on human messages, no live stream).

Deferred from the first plan:

- **Team-scoped unique indexes.** Only the team owner opens team rooms today, so the per-owner room-name and `openKey` indexes still guard one creator. Move them to team scope in the phase where a member can open a room.
- **Turn stream for members** (`/api/conversations/:id/stream`). It stays owner-only and moves to RFC-089b. A member sees new messages by polling.

Known limits of this phase: a member does not see attachment bodies or reactions on the owner's messages, and does not see the owner's routines for the room (those lookups are owner-scoped).

### RFC-089b: Authored messages and acting user

1. Add `message.author_user_id`. Backfill from `owner_user_id` for existing rows. New human messages store the real author.
2. Add `discussion_turn.requested_by_user_id` and `discussion_turn.runs_as` with values `owner | team`.
3. The worker issues the actor from the bot's runner: the bot owner for a personal bot, the team principal for a Team Bot. It no longer uses the room owner.
4. Add `postAsMember` next to `postAsOwner`. It checks team membership. Attachments must belong to the author.
5. The web shows each human message with its author. "Me" is only the current user's own messages.
6. Room polling and the turn stream accept any team member. The in-memory turn key no longer starts with the room owner.

### RFC-089c: Cross-user approval and room trust

1. Trigger: a member mentions another member's personal bot and has no grant from the bot owner in that room.
2. The turn goes to `awaiting_approval` through `gate()`. No part of it runs.
3. A proposal of new kind `room_request` is owned by the bot owner, so `decideProposal` needs no change. It stores `requested_by_user_id`, the room and the trigger message.
4. `raiseAttention` creates an item for the bot owner. `resultLink` points to the room. `sourceKey` is `proposal:<id>`.
5. The card says what the bot may reach (its accounts) and that the answer is visible to the whole room.
6. Decisions: approve once, approve and always allow, or decline. "Always allow" writes `room_grant (discussion_id, grantor_user_id, grantee_user_id)`. It covers all personal bots of the grantor in that room. The grantor can revoke it.
7. A decline posts a system note in the room. A grant ends when either user leaves the team or the room.

### RFC-089d: Team accounts and Team Bots

1. Add `bot.usage` with values `personal | team`, and `bot.team_id`. Only a team owner can set a bot to `team`, and only for a bot the owner owns. A chief stays personal.
2. Add `connection.scope` with values `user | team`, and `connection.team_id`. The team owner manages team connections. The secret is sealed under the team owner's key, and a call swaps the owner at call time (same pattern as `secretOwner`).
3. `envFor`, `runConfig` and `tokenOf` use team bindings when `runs_as` is `team`. They fail closed with the existing `ConnectionRequiredError`. A Team Bot never uses a personal connection.
4. A request to a Team Bot from a team member needs no approval.
5. Code workspace stays owner-only (`codeEnabled`). A Team Bot has no code workspace in this phase.

### RFC-089e: Team memory

1. A Team Bot turn loads memory and instructions scoped to `team_id`. It never loads a member's private memory.
2. Members can read, correct and delete team memory with the existing memory correction flow.
3. A personal bot turn keeps today's rule: memory comes from the user that runs it, which is the bot owner.

### RFC-089f: Fork a chat into a room, and the nudge

1. "Continue in a team room" copies the chat history up to a cutoff into a new conversation of a team room. The original chat stays private and unchanged.
2. The copy runs the snapshot safety pass (`build`): it refuses file references and browsing results, and removes text that looks like a credential. The user sees a preview and confirms before the room is created.
3. The nudge: when a room has more than one human and a personal bot, raise one attention item for the bot owner. `sourceKey` is `team-bot-nudge:<room>:<bot>`. It links to the bot's setup. It does not repeat after the owner dismisses it.

## Acceptance criteria

- [ ] A team member reads every team room, posts, and mentions bots. A non-member and a removed member get `NOT_FOUND` or `401/403`, with no data in the response.
- [ ] Every human message in a room shows its real author. Existing messages show the room owner.
- [ ] Y's request to X's personal bot does not start until X decides. With "always allow", the next request starts at once. After revoke, it waits again.
- [ ] X's accounts are never used for a turn that X did not approve or grant.
- [ ] A Team Bot turn uses only team connections and team memory. With a missing team connection, it fails closed and does not fall back to a personal connection.
- [ ] A forked room contains no file reference, browsing result or credential-looking text. The source chat is unchanged.
- [ ] A removed member loses team access, and the grants they gave or received stop working.

## Verification

Proposed commands (confirm the names when a phase starts):

- Extend `apps/server/src/modules/isolation-matrix.integration.test.ts`: member reads a team room, a non-member gets 404, a removed member is denied. Update the "published snapshots are the only deliberately shared artifact" case, because a team room is now a second shared artifact.
- `bun test apps/server/src/modules/discussions/` for the author, the approval gate and the grant.
- A connection test: a Team Bot with and without a team connection.
- A web check with a fake fetch for the author display and the approval card (see the DOM-check script already used for the web).

Use synthetic data and fake values (`@example.invalid`). Use a scratch database for database tests, not `zetta_test`. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

Documents to update when a phase ships:

- [ownership](../docs/decisions/ownership.md): the permission table for member B, and the snapshot rule.
- [glossary](../docs/wiki/glossary.md): add Room and Team Bot. Split "Team" (the human audience) from the bot team.
- [privacy and sharing](../docs/wiki/user-guide/privacy-and-sharing.md): shared rooms and what an approval shares.

## Definition of done

- [ ] All acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Each phase ships alone, leaves the app working, and has its migration applied and tested without data loss.
- [ ] Failure and privacy behavior, exact validation, changed paths and remaining blockers are recorded below.

## Small-model handoff and stop rules

Implement one child RFC at a time after its prerequisites and approvals are accepted. Reuse the contracts named above rather than redesigning neighbor modules. Stop and give the coordinator the smallest concrete decision needed when:

- the evidence contradicts this plan,
- a new dependency is needed,
- a change would let a user run a bot with another user's accounts without a recorded approval or a Team Bot setup,
- a migration could lose data.

## Open decisions

- Whether a team owner can remove a Team Bot's team connection while a turn is running. Proposed: the running turn finishes, and later turns fail closed.
- Whether a member can leave a team and take their fork with them. Proposed: a fork stays in the team room; the member keeps the original chat.
- Retention of grants and room history after a member is removed. Proposed: keep the history, delete the grants. This follows the open retention decision in [ownership](../docs/decisions/ownership.md).

## Completion record

### RFC-089a (2026-11-03)

**Status: Done.** The user approved implementation of the phase, including the schema change.

- Changed paths: `packages/db/src/schema/teams.ts`, `packages/db/src/migrations/20261103193738_team_person/`, `packages/db/src/query.ts` (export `notInArray`), `apps/server/src/modules/teams/{people.ts,store.ts,routes.ts}`, `apps/server/src/modules/identity/access.ts`, `apps/server/src/modules/discussions/store.ts`, `apps/server/src/modules/chat/service.ts` (`getConversation`, `listMessages`: the `message.owner_user_id` row filter is gone, access is proven on the conversation), `apps/server/src/test-support/db-cleanup.ts`, `apps/web/src/features/teams/{team-people.tsx,team-settings.tsx,teams-api.ts}`, `apps/web/src/features/discussions/{discussions-page.tsx,discussions-api.ts}`, and the ownership decision and the glossary.
- Migration: tested on a scratch database with old-shaped rows (backfill copies the owner's revision; 1 when the owner has no membership row), then applied to the dev database after a `pg_dump` backup. It is additive.
- Tests: `apps/server/src/modules/teams/people.integration.test.ts` (7 tests: owner-only start, read before and after add, no write or team management for a member, outsider denied, owner cannot be removed, removed member denied and not restored by re-enrollment). With the existing teams, discussions, chat and isolation-matrix suites: 100 pass, 0 fail, 15 skipped (real-model suite needs `ZETTA_LAYA_TEST=1`).
- Diagnostics: `tsc --noEmit` clean for `apps/server` and `packages/db`; no type error in the changed web files (4 existing errors in `proposals-panel.test.tsx` and `packages/ui` `skeleton.tsx`); `oxlint` clean; `oxfmt --check` clean on the changed files; web guard tests (`in-app-links`, `free-text`) pass.
- Not checked: the web screens in a real browser.
- Unblocks: RFC-089b.
