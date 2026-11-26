# Zetta wiki

Zetta is a server-backed bot manager. Your personal chief coordinates specialists; you can also talk directly to any bot you can use. The goal is useful work with understandable setup, visible results, and clear requests for your attention.

## User guide

Start with a job, not a technical component:

| I want to…                                                 | Read                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| Set up a useful bot and know when it is ready              | [Your first useful bot](user-guide/getting-started.md)                     |
| Delegate work, find results, or resolve a blocker          | [Work and attention](user-guide/work-and-attention.md)                     |
| Correct a mistake or repeat a successful task              | [Learning, routines, and workflows](user-guide/learning-and-automation.md) |
| See who leads what and which bots work together            | [Organization chart](user-guide/organization-chart.md)                     |
| Understand what is private and what publication shares     | [Privacy and sharing](user-guide/privacy-and-sharing.md)                   |
| Let a bot use websites or a computer, including login help | [Browser and computer use](user-guide/browser-and-computer.md)             |

You do not need to read the architecture section to follow these journeys. Use the [glossary](glossary.md) when a term is unfamiliar.

## Architecture

For developers and operators:

- [System overview](architecture/system-overview.md): the workspace, where each responsibility lives, and the boundaries that stay separate.
- [Execution and access](architecture/execution-and-access.md): actor identity, readiness, durable work, attention, and recovery rules.

## Which document owns what?

| Question                                            | Where to look                                    |
| --------------------------------------------------- | ------------------------------------------------ |
| What does the product do, and for whom?             | [README](../../README.md)                        |
| What does a machine need to run it?                 | [Infrastructure](../../README.md#infrastructure) |
| How do I install, update, scale or set up a plugin? | [Operations](../operations)                      |
| Which settings exist?                               | [Settings reference](../operations/settings.md)  |
| Why was a part built this way?                      | [Decisions](../decisions)                        |
| How do I work on the code?                          | [TECH.md](../../TECH.md)                         |
| How do the experiences fit together, and why?       | This wiki                                        |

The wiki explains; it is not an API specification. If a page disagrees with the product, correct the page.

## Maintain this wiki

- Keep guides organized around user outcomes and recovery, not a copy of every settings field.
- Update the affected explanations in the same change that alters the behavior.
- Do not add credentials, private conversations, live account details, or sensitive screenshots to examples.
- Keep the wiki as repository Markdown. No separate publishing service, generated site, or dependency is required.
