# Zetta wiki

Zetta is a server-backed bot manager. Your personal chief coordinates specialists; you can also talk directly to any bot you can use. The goal is useful work with understandable setup, visible results, and clear requests for your attention.

> **Status: intended v1, not a released user manual.** These pages explain confirmed product behavior and proposed architecture. They do not claim the features are implemented. Check [TASKS.md](../../TASKS.md) and RFC completion evidence for delivery status. Example wording is illustrative, not a promise of exact screen labels.

## User guide

Start with a job, not a technical component:

| I want to… | Read |
| --- | --- |
| Set up a useful bot and know when it is ready | [Your first useful bot](user-guide/getting-started.md) |
| Delegate work, find results, or resolve a blocker | [Work and attention](user-guide/work-and-attention.md) |
| Correct a mistake or repeat a successful task | [Learning, routines, and workflows](user-guide/learning-and-automation.md) |
| Understand what is private and what publication shares | [Privacy and sharing](user-guide/privacy-and-sharing.md) |
| Let a bot use websites or a computer, including login help | [Browser and computer use](user-guide/browser-and-computer.md) |

You do not need to read the architecture section to follow these journeys. Use the [glossary](glossary.md) when a term is unfamiliar.

## Architecture and decisions

For developers and implementation agents:

- [System overview](architecture/system-overview.md) — current code anchors versus proposed responsibilities.
- [Execution and access](architecture/execution-and-access.md) — actor identity, readiness, durable work, attention, and recovery rules.
- [Integration and delivery gates](architecture/integrations-and-gates.md) — required capabilities, unresolved technical choices, and evidence needed before release.
- [Product refinement](product-refinement.md) — alternatives considered, assumptions, trade-offs, and a proposed validation exercise.

## Which document owns what?

| Question | Authority |
| --- | --- |
| What behavior and scope did the user confirm? | [Product intent](../intent/zetta-v1.md) |
| How do the experiences fit together, and why? | This wiki |
| What architecture and approval constraints guide implementation? | [Implementation plan](../../tasks/plan.md) |
| What should be implemented next, and what is its status? | [TASKS.md](../../TASKS.md) |
| What must a specific implementation prove? | Its numbered RFC and completion record |
| How should an implementation worker proceed? | [RFC execution contract](../../tasks/README.md) |

The wiki is an explanation layer, not another backlog or an API specification. Proposed designs and unresolved assumptions are labeled. If a page conflicts with confirmed intent, correct the page; do not treat it as permission to change product scope.

## Maintain this wiki

- Keep guides organized around user outcomes and recovery, not a copy of every settings field.
- Link to the owning RFC instead of copying its task checklist, status, or dependency list.
- Keep planned behavior separate from observed implementation and verified runtime support.
- Update affected explanations when an approved product decision changes. Record technical decisions and evidence in the owning RFC's handoff.
- Do not add credentials, private conversations, live account details, or sensitive screenshots to examples.
- Keep the wiki as repository Markdown. No separate publishing service, generated site, or dependency is required.
