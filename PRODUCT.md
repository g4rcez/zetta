# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Enterprise teams mixing technical and non-technical people. Non-technical members want useful work done (briefings, newsletters, research) without administering a technical system. Technical members (code review, security research on authorized targets) need advanced controls. Each user has a local Zetta login and one personal chief. One installation admin per install.

## Product Purpose

Zetta is a web app for managing autonomous bots. A user gives their personal chief an outcome, the chief coordinates specialist bots, and the user returns to results or to work that needs their attention. Success: work completes on the server without the user watching, and attention is requested only when something truly needs them.

## Positioning

Bot management for people, not for operators: configuration is understandable without knowing what a harness, MCP server, or hook is, with advanced controls still available. Autonomy is real (no approval on every ordinary action), but never fakes success: missing info, expired logins, blocked tools and uncertain outcomes are surfaced.

## Operating Context

Self-hosted, one admin per installation. The server runs six harnesses (Pi, Codex, OMP, Claude Code, OpenCode, Cursor) and executes work independently of an open browser tab. Server-enforced authentication and authorization. Interactive work uses the requesting user's connections; routines use their owner's. Also ships a desktop app (`apps/desktop`).

## Capabilities and Constraints

- Bot configuration via guided forms or conversation; onboarding completes only after a verified real conversation and explicit positive confirmation.
- Chat: multiple private conversations per bot, markdown, mentions, attachments, threads, reactions, durable multi-turn context, immutable read-only conversation snapshots, group discussions.
- The chief is named "Zetta" by default, so the app and the bot people talk to share one name; the user can rename it. "Chief" stays the name of the role.
- Chat-first shell: one sidebar with the chief first and the other bots in the order each user sets (drag or keyboard, saved per user); each bot lists its own chats. See docs/intent/redesign.md.
- Attention model shared by sidebar, activity and task kanban: working/queued, needs input, blocked, new results; kept separate from execution status.
- Routines, agenda, studio, computer (VM) use, folders as visual teams of bots.
- Bots are team-visible by default, may be private; sharing a bot never shares conversations, credentials, files or memories.
- In-app notifications only for now; no external push/email.
- Vocabulary: chief, bots, folders, routines, attention.
- Web navigation must use TanStack Router links (see CLAUDE.md).

## Brand Commitments

Name "Zetta". "Chief" terminology is binding. Default flows avoid technical jargon (harness, MCP, hooks).

## Evidence on Hand

Product definition in README.md, docs/intent/zetta-v1.md and docs/wiki/. No customer testimonials, benchmarks or pricing exist; do not fabricate them.

## Product Principles

1. Outcomes over configuration: users ask for results, not system setup.
2. Honest autonomy: never invent success; surface uncertainty, blocks and missing access.
3. Attention is scarce: interrupt only when the user is needed, with a safe next action.
4. Plain language by default, advanced controls on demand.
5. Sharing never leaks identity: access, credentials and memories stay with their owner.

## Accessibility & Inclusion

WCAG 2.2 AA required, with AAA color contrast: every text and background pair is 7:1 or more.
