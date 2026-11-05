# Running several servers

Zetta runs as one process by default (`ZETTA_ROLE=all`). To spread HTTP traffic over several servers, run **api** instances behind a load balancer and **one worker**. `docker-compose.scale.yml` and `docker/scale/Caddyfile` are a working example.

## Roles

| `ZETTA_ROLE`    | What the process does                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `all` (default) | Everything, as before. One process per installation.                                                                                                                                                                                                               |
| `api`           | HTTP: reads, writes, auth, server-sent events (`/api/events`). Never starts a turn, a ticker, boot recovery, a sweep, a routine job or a VM service.                                                                                                               |
| `worker`        | Everything an `api` does, plus all work that owns running things: bot turns and their streams, the 30 s ticker (agenda, memory, knowledge, discussions, inbound, loops, queue), boot recovery, routine jobs, harness containers, browsers, VMs and the Laya model. |

Run **exactly one worker**. Two workers are not supported yet (see "Not covered yet"). You can restart, add and remove `api` instances at any time: they own no running work, so restarting one marks nothing as interrupted.

## What goes where

The load balancer sends these requests to the worker (`apps/server/src/worker-only.ts` is the list; an `api` process answers `421 WORKER_ROUTE` for them, and `worker-only.test.ts` checks the Caddyfile against it):

- Starting, following and cancelling turns: `POST /api/conversations/:id/(stream|chat|messages|queue|cancel|turn/wait)`, `POST .../queue/:messageId/retry`, `GET .../(stream|chat/stream|turn)`.
- `POST /api/proposals/:id/decision` (an approval can restart a stopped turn), `/api/bots/:id/onboarding/*`.
- Anything that runs a CLI, model or container in the request: `POST /api/(workflows|routines)/:id/run`, `POST /api/bots/interview`, `POST /api/memory-assist` (also its old name `/api/wiki-assist`), `/api/harnesses`, `/api/decisions/*`.
- Computers and VNC: `/api/computer/*` (including the WebSocket), and `/api/bots/:id/database*` (bot database roles allow 3 connections cluster-wide).
- `/api/inbound/*` (plugin hooks).
- Sealed credentials and plugin sign-in: `GET /api/connections/transport-key`, `POST /api/connections`, `POST /api/plugins`, `PUT /api/plugins/:id/config`, `/api/plugins/:id/(test|connect|disconnect|callback)`. The key a browser seals a secret to is generated in the memory of one process, and a sealed body that reaches another instance is refused with 409.

Everything else, including the polled reads (`/api/bots`, `/api/conversations`, `/api/conversations/:id/messages`, `/api/discussions`, ...), `/api/events` and auth, can be served by any `api`.

## How instances stay in step

- **Events.** A change published on one instance reaches the open streams on the others over Postgres `NOTIFY` (`ZETTA_EVENT_BUS=pg`, the default for `api` and `worker`). Each instance holds one `LISTEN` connection. NOTIFY loses what happens while that connection is down, so after a reconnect every open page refetches (`resync` topic). If a page's stream reconnects, it refetches too.
- **Kicks.** When a request on an `api` queues work for the worker (a room turn, a goal loop), it sends a kick over the same channel. Without it the worker finds the work on its 30 s tick.
- **Files.** Attachments, artifacts and files must be on a volume every instance mounts at the same paths (`ZETTA_FILES_ROOT`, `ZETTA_ATTACHMENTS_ROOT`, `ZETTA_ARTIFACTS_ROOT`). The compose file uses one named volume.
- **Sessions.** Better Auth sessions are in Postgres. The load balancer must set the client address in the header named by `ZETTA_TRUSTED_IP_HEADER` (the last entry counts).

## Health checks

- `GET /healthz`: the process runs. Use it for container health.
- `GET /readyz`: the database answers within a second; 503 otherwise. The Caddyfile uses it to take an `api` out of rotation. Neither route looks up a session or writes a request log.

## Connections

Per instance: `ZETTA_DB_POOL_MAX` (default 20) + 1 listener. A worker adds up to 50 bot-database pools of 2. Example from the compose file: 2 api × (10 + 1) + worker (20 + 1 + up to 20) + admin = about 65 connections, so `postgres` runs with `max_connections=200`.

## Instances and recovery

Every process registers in `server_instance` and writes a heartbeat every 10 s (`ZETTA_HEARTBEAT_MS`). Rows that record work in progress carry the id of the instance running them (`owner_instance`): chat answers, queued messages, discussion turns, inbound deliveries, routine and workflow runs, VMs and goal loops.

- **Recovery only takes work of a dead instance:** one that stopped (`SIGTERM`, `SIGINT`), or has no heartbeat for 90 s (`ZETTA_INSTANCE_DEAD_AFTER_MS`). It runs at boot and again on every 30 s tick, so a worker that crashed is recovered by another without waiting for a restart. Work of a live instance is left alone, so a new worker can start while the old one still runs (a rolling deploy).
- **Rows written before owners existed** (no `owner_instance`) are taken at boot, but only when no other worker or `all` instance is alive.
- **A process that loses its database for 60 s (`ZETTA_FENCE_AFTER_MS`), or finds its row stopped because another process started with the same name, stops itself.** Instance names default to `host:port`; set `ZETTA_INSTANCE_NAME` when two containers could share one.
- **`ZETTA_RECOVERY=legacy`** restores the old behaviour (every `running` row is recovered) if you need it.
- **Claims are safe across instances:** one running queued answer per conversation (unique index), discussion turns are claimed one at a time under an advisory lock, a goal loop is driven by the instance that holds its lease, routine runs and inbound, memory, knowledge and agenda work use atomic claims.

## Not covered yet

These need a turn event log and a few more tables, and are planned in this order:

1. **Turns still need one worker.** The turn registry is in the worker's memory, and so is the check that a conversation has no turn running. Two workers could start two turns in one chat, and a stream or a cancel only works on the instance that runs the turn.
2. **Turns run and stream on the worker.** Turn events live in the worker's memory, so `api` instances cannot serve a stream. A shared `turn_event` log in Postgres would let any instance serve it, and let `api` start turns through a queue.
3. **The sign-in rate limit** is counted in memory by default, so N instances allow N times as many attempts. Set `ZETTA_AUTH_RATE_LIMIT_STORAGE=database` (the scale compose file does) to share the counters. The transport key is why the sealed-credential endpoints above go to the worker; it moves to a shared store later (the `transport_key` table is reserved for it).
4. **Installation settings** (network mode, Laya) are read at boot and applied by the instance that saved them; restart the others after a change.
5. **VNC tickets and browser sessions** are in the worker's memory: they stay there by design.
