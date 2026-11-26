# System overview

[Wiki home](../README.md) · [Glossary](../glossary.md)

## The workspace

Zetta is a Bun and TypeScript workspace: React with TanStack Router in the web app, Elysia on the server, Better Auth for sign-in, and Drizzle on PostgreSQL. The development setup is in [TECH.md](../../../TECH.md), and what a machine needs to run it is in the [README](../../../README.md#infrastructure).

| Part                                            | What it is                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`apps/web`](../../../apps/web)                 | The web app people use: chat, bots, tasks, routines, workflows, Studio.                            |
| [`apps/server`](../../../apps/server)           | The API and everything that runs: bot turns, routines, workflows, plugins, browsers and computers. |
| [`apps/desktop`](../../../apps/desktop)         | The desktop app. It opens a Zetta server, or runs a local one for one person.                      |
| [`apps/cli`](../../../apps/cli)                 | The `zetta` command line.                                                                          |
| [`apps/landing`](../../../apps/landing)         | The public site, [zettabot.app](https://zettabot.app).                                             |
| [`packages/db`](../../../packages/db)           | The database schema, the migrations and the Postgres that ships inside Zetta.                      |
| [`packages/auth`](../../../packages/auth)       | Sign-in, sessions and invitations.                                                                 |
| [`packages/core`](../../../packages/core)       | Types and rules the web app and the server share, such as the settings registry.                   |
| [`packages/harness`](../../../packages/harness) | The agents a bot can run on and the models of each.                                                |
| [`packages/laya`](../../../packages/laya)       | The built-in decision model.                                                                       |
| [`packages/ui`](../../../packages/ui)           | Shared interface components and styles.                                                            |

The server entry point is [`apps/server/src/index.ts`](../../../apps/server/src/index.ts), and [`services.ts`](../../../apps/server/src/services.ts) wires the database, sign-in and every domain service.

## Where each responsibility lives

| Responsibility                     | Location or boundary                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| User journeys and stateful views   | `apps/web/src/features/<domain>/` and authenticated routes, on the shared UI.          |
| Authorization and domain mutations | `apps/server/src/modules/<domain>/`. The server derives the actor's authority itself.  |
| Durable domain records             | `packages/db/src/schema/`, changed through incremental migrations.                     |
| Execution and integrations         | The server runtime: agent adapters, scoped connections and controlled host tools.      |
| Browser and desktop resources      | Isolated backends, with profiles and sessions bound to one user, and explicit cleanup. |

How work flows:

```text
Form or chat configuration → authorized domain services → versioned state
User task or routine occurrence → run admission → durable dispatch
  → isolated agent and scoped tools → retained messages/results
  → attention projection → sidebar, Catch up, task board
```

Chief delegation and visual workflow steps use the same execution and actor rules; there is no separate route around authorization or readiness. Scheduling uses the routine owner's identity.

## Boundaries that stay separate

- **Bot definition versus actor:** a shared bot can run for different users without sharing their credentials or private knowledge.
- **Folder versus membership:** grouping is presentation; human membership and resource authorization are separate.
- **Run events versus chat history:** replay supports reconnect; durable assistant and tool messages outlive event retention.
- **Attention versus audit:** attention describes what needs action now. Audit explains what happened. Neither can manufacture execution success.
- **Memory versus skills versus configuration:** facts, reusable methods, and behavior or setup have different write and approval rules.
- **Workflow graph versus layout:** executable published versions are distinct from visual placement and mutable drafts.
- **Snapshot content versus live capability:** publication copies safe frozen content, never an authority-bearing link to the original resource.

Forms and bot-chat configuration call the same authorized services, with the same validation.

Continue with [execution and access](execution-and-access.md). Why each part was built the way it was is in [docs/decisions](../../decisions), and running it is in [docs/operations](../../operations).
