# System overview

[Wiki home](../README.md) · [Glossary](../glossary.md)

> **Status:** current code anchors are distinguished below from proposed domain modules. The wiki is not an approved schema, API, deployment topology, or implementation-completion record.

## Existing foundation

Zetta uses a Bun/TypeScript workspace with a web app, server, and shared packages. The [implementation plan's baseline](../../../tasks/plan.md#repository-baseline) records React/TanStack Router, Elysia, Better Auth, Drizzle/PostgreSQL, and shared UI components. Check current manifests before using version-specific APIs; a skill for a newer framework version is not evidence that it is installed here.

Directly inspected anchors for this documentation review:

| Anchor | Observed responsibility | What it does not establish |
| --- | --- | --- |
| [Root manifest](../../../package.json) | Workspace, package catalog, and development scripts | Runtime compatibility of planned integrations. |
| [Server entry point](../../../apps/server/src/index.ts) | Elysia composition, logging identity, auth forwarding, CORS, and health response | Authorization for future bot, chat, run, or file resources. Logging user identity is not access enforcement. |
| [Service wiring](../../../apps/server/src/services.ts) | Creates database and auth services | A delivered execution worker or domain service layer. |

The repository contains desktop-related scripts. That is separate from required isolated computer-use execution; it does not establish a new native desktop-client requirement or prove desktop automation support.

## Proposed responsibilities

Reuse the existing workspace rather than introduce a new orchestration platform by default. These directories are planned responsibilities, not claims that all modules exist:

| Responsibility | Planned location or boundary |
| --- | --- |
| User journeys and stateful views | `apps/web/src/features/<domain>/` and authenticated routes; reuse shared UI. |
| Authorization and domain mutations | `apps/server/src/modules/<domain>/`; derive actor authority server-side. |
| Durable domain records | `packages/db/src/schema/`; approved incremental migrations, not a speculative full schema. |
| Execution and integrations | Owned server runtime, verified harness adapters, scoped connections, and controlled host tools. |
| Browser and desktop resources | Approved isolated backends, user-bound profiles/sessions, explicit leases and cleanup. |

Proposed flow, not a protocol specification:

```text
Form or chat configuration → authorized domain services → versioned state
User task or routine occurrence → run admission → durable dispatch
  → isolated harness and scoped tools → retained messages/results
  → attention projection → sidebar, activity, kanban
```

Chief delegation and visual workflow steps use the same execution and actor rules; they must not create a separate route around authorization or readiness. Scheduling uses the routine owner's identity.

## Boundaries that must stay separate

- **Bot definition versus actor:** a shared bot can run for different users without sharing their credentials or private knowledge.
- **Workspace versus membership:** grouping is presentation; human membership and resource authorization are separate.
- **Run events versus chat history:** replay supports reconnect; durable assistant/tool messages outlive event retention. See [RFC-069](../../../tasks/069-persist-assistant-and-tool-output.md) and [RFC-070](../../../tasks/070-build-private-multi-turn-run-context.md).
- **Attention versus audit:** attention describes what needs action now. Audit explains what happened. Neither can manufacture execution success.
- **Memory versus instructions versus configuration:** facts, reusable methods, and behavior/setup have different write and approval rules.
- **Workflow graph versus layout:** executable published versions are distinct from visual placement and mutable drafts.
- **Snapshot content versus live capability:** publication copies safe frozen content, never an authority-bearing link to the original resource.

Forms and bot-chat configuration must call the same authorized services. Shared validation is a current responsibility, not a reason to create a generic framework for hypothetical resource types.

## Where implementation decisions live

Start from [TASKS.md](../../../TASKS.md), then read the selected RFC and prerequisite handoffs using the [execution contract](../../../tasks/README.md). Follow its non-numeric dependency order. The wiki deliberately does not duplicate that order or maintain a second status table.

Continue with [execution and access](execution-and-access.md) and [integration gates](integrations-and-gates.md). Specific schemas, routes, auth changes, dependencies, infrastructure, and environment-dependent checks still need approval.
