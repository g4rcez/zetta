# Zetta v1 — confirmed intent

Status: confirmed by the user in the product interview and subsequent UX refinement. The refinement adds visual workflows, browser/computer use and an attention kanban to v1. Implementation details remain proposals until the relevant RFC gate is accepted.

## Outcome and users

Zetta is a server-backed web app for autonomous bots, with friendly configuration for nontechnical users. Each user signs in with an individual local account and has one personal chief, acting as the manager of their bots. Authentication and authorization are enforced by Zetta. The chief coordinates work and delegates to specialists. Direct bot chats and advanced configuration remain accessible without being the default burden. There is one installation admin.

Users give bots tasks and account access. Bots execute without repeated action approvals. Intended uses are daily briefings, newsletters from email newsletters, blogs, Reddit and X timelines, financial research, code review, and security research. These uses guide acceptance scenarios; they do not authorize financial transactions or security testing against arbitrary targets.

## Ownership

- Bots are visible to the team by default and can be private to their owner.
- Each chief is personal to one user, not a shared team chief.
- Chats and connected accounts belong to users. Sharing a bot does not share its users' conversations or credentials.
- Interactive work uses the requesting user's connections. Scheduled work uses the routine owner's connections. Delegation preserves that identity.
- Basic privacy and locally enforced authentication/authorization are required in v1. A configurable per-bot action permission system is deferred.
- Workspaces are visual teams/groups of bots, not access-control boundaries. Moving bots between workspaces does not share accounts, chats or knowledge, and does not create another chief.
- Onboarding evidence and execution readiness are user/bot/configuration-specific; a shared bot's successful setup cannot grant another user account readiness.

## Required v1 capabilities

1. Friendly bot configuration through forms or chat with any bot: personality, instructions, harness/model selection, skills, hooks, and assigned integrations. Onboarding completes only after real harness conversation and explicit positive user satisfaction.
2. All six harnesses: Pi, Codex, OMP, Claude Code, OpenCode, and Cursor.
3. Schedules and routine actions, with a calendar-oriented interface.
4. Workspaces (visual bot teams) and sidebar organization, including inner groups.
5. A full private bot chat experience.
6. Jev and Laya integration for decisions; not a replacement decision engine built by Zetta.
7. Hooks that can add context, transform/redact messages, stop a model call, and start owned background work.
8. Self-learning bots and a reusable instruction library.
9. Hermes-style persistent memory across chats, tasks, and server restarts.
10. A common in-app attention model in sidebar/activity surfaces and a dedicated attention kanban with task attribution, partial completion, repair actions and durable result links.
11. Visual conditional workflows, with a bounded graph model, visual editor, execution and inspectable results.
12. Browser and computer use with isolated sessions, per-user browser profiles, and secure human takeover/hand-back when needed.

## Onboarding and connected journeys

The onboarding sequence is configure → working harness/account/model → initial conversation → bot asks whether the user is satisfied → explicit positive confirmation → ready. A negative response returns to refinement; silence, a reaction or a model's assertion cannot complete it. Allow an authorized setup/test conversation before readiness, but do not admit ordinary delegated/scheduled/workflow work before the user has completed onboarding. Recheck access and credentials at dispatch; meaningful configuration or account changes require readiness revalidation.

Forms and chat use the same authorized, versioned configuration services. Any bot may assist with an authorized bot or routine configuration; this is not a chief-only privilege. Bot-proposed changes use visible diffs and explicit user approval. User-requested setup must not depend on automatic self-learning having run first.

Connect the journeys: successful task → reusable instruction → routine; incorrect result → inspect relevant knowledge → correction → improved later context; blocked task → repair → return to retained work → deliberate next attempt. A routine summary explains its task, owning bot, timezone/next run, context mode, accounts and result destination before activation.

Attention is separate from execution state. Acknowledging an item cannot mark a run successful or approve a change. The kanban focuses on pending tasks needing the user's attention, with responsible bot, completed/remaining/uncertain work, safe next action and result links. Workspace placement never grants access to a card. External notifications remain out of scope.

## Chat experience

- Private conversations with each bot, including multiple chats per bot.
- Markdown support in the composer and rendered messages.
- Mention bots, attach files to context, and reference authorized server files.
- Reply in message threads and react to messages.
- Publish an entire conversation as an immutable, read-only snapshot for the team.

A snapshot contains the conversation content at publication time. Later private messages are not included. It does not grant access to connected accounts, bot configuration, underlying memory, or referenced server resources. Attachments and tool output need a content-safe representation; source handles and credentials must not be copied into the publication. If any part lacks a safe representation, block publication with a clear reason instead of silently omitting it or leaking a capability. Team visibility is not public internet visibility.

## Self-learning

- **Memory:** facts, preferences, decisions, corrections, and relevant context retained persistently.
- **Instructions:** reusable procedures learned from completed tasks and retrieved for similar work.
- **Configuration:** a bot may propose changes to itself or help configure another resource the user may edit. The user must see the exact diff or creation summary and explicitly approve before bot-proposed changes take effect. Forms and chat share validation and version/conflict rules.

Shared bots must not leak one user's private memory or instructions to another user. Self-learning is not model training. The exact Hermes implementation and compatibility strategy require a source-backed integration decision.

## Design direction

The supplied references establish a chat-first layout, bot sidebar, routine calendar, team grouping, app connection catalog, and harness/model setup cards. Prefer existing shared UI primitives. The user identifies `@g4rcez/components` as the source of the calendar component; verify its availability and API before adding a dependency.

The repository's older visual draft describes a team chief. This intent supersedes that point: the chief is per user, and workspaces only organize bots. The README explains this product direction; TASKS.md owns implementation order.

## Non-goals for v1

- Configurable per-bot action permissions or approval on every tool call.
- App marketplace and visual team-map canvas. The visual workflow editor is required in v1; it is distinct from the deferred team-map canvas.
- Model training, billing, public SaaS tenancy, or a new native desktop client. Isolated computer-use execution is required; a standalone desktop app is not.
- Automatically treating every integration named in the README as a required bespoke connector.

Browser/computer use is required in v1. Profiles may be dedicated per bot or explicitly shared among the same user's bots; never across users or implicitly through a workspace. The chosen runtime, provider, supported versions, safe takeover and isolation still need evidence. This is a technical selection gate, not a gate on whether to include the feature.

The initial connector set and concrete Hermes/Jev/Laya products/protocols still need compatibility decisions. Full n8n parity, a separate artifact-management product and external push/email/mobile notifications are not required.

## Next artifacts

- [Wiki: user journeys and architecture](../wiki/README.md)
- [Refinement and assumptions to validate](../wiki/product-refinement.md)
- [Implementation plan](../../tasks/plan.md)
- [Ordered RFC backlog](../../TASKS.md)

This document records product intent. The backlog records proposed implementation slices; neither authorizes dependency installation, production changes, or deployment.
