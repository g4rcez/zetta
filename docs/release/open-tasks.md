# Unfinished tasks and gaps (2026-10-23)

Source: `TASKS.md` (authoritative) and each RFC's completion record. 9 of ~80 parent RFCs are not Done; sub-RFCs (`004x`, `005x`, `008x`, `009x`, `010x` ...) follow their parent row. Six more are "Done" only by an assumption that the owner has since reversed.

## A. Not Done in TASKS.md

| RFC | Status | What exists | Gap to close | Needs |
| --- | --- | --- | --- | --- |
| 002 Prove multi-user execution isolation | Review | Docker runtime for harness and browser; real-container tests (non-root, read-only fs, no host/other-user view, no secrets in env, timeout kill) | Egress allowlisting beyond Docker networks; live cross-user run with real accounts for non-Claude harnesses; host mode (default) has no OS isolation | Owner sign-off on "host mode for trusted teams"; harness accounts |
| 008 Isolated process supervision | Review | Process group / `docker kill`, output cap, deadlines, per-user and global limits, minimal env | 6 unchecked acceptance items; Linux journal-store proof (`runtime/journal-store.integration.test.ts` fails on macOS, guard test expects Linux); review fixes: `-e` env injection, container uid/0700 dirs, boot sweep of orphaned containers | Linux CI run; code work |
| 045 Source-to-briefing flow | Review | RSS feed -> bot, failing sources named | Email and X sources are blocked-external (no provider contract/credentials) | Owner: provide providers, or ship labelled "not available" |
| 047 Jev decision adapter | Review | Adapter + routing backend, fixed origin, strict validation | By owner decision: no tests, no live proof | Owner: Jev account if a live proof is wanted |
| 054 Hermes memory mechanism | Review | Implemented and approved by owner (bounded user/bot stores, batches, snapshot, screening) | Six-harness privacy proof; native harness memory not disabled/verified per harness | Harness accounts; Cursor CLI |
| 065 Recovery boundaries | Review | Docs + boot reconciliation tests; restore drill ran once (pg_dump -> restore -> migrate -> boot) | Rerun the drill with the new `hermes-memory` migration; 6 unchecked items | None |
| 066 Cross-user isolation end to end | Review | Matrix passes for all product resources | Native-process isolation (depends on 002/008); add memory-store cases to the matrix (done in memory test, not in the matrix doc) | 002/008 |
| 067 Representative v1 workflows | Review | 4 journeys with a scripted model | Real-model evidence only for Claude Code, Laya, Chromium; no real-model run on Codex/Pi/OMP/OpenCode/Cursor | Accounts / quota |
| 068 Release gate | Blocked | NO-GO evaluation; conditional go for a trusted team | Live smoke for all six harnesses (owner requirement); Jev live; native isolation; independent code review re-run; restore drill rerun | Everything above |

## B. "Done" by assumption (conflicts with the live-smoke requirement)

012 research six harnesses, 013 Pi, 014 Codex, 015 OMP, 017 OpenCode, 018 Cursor: implemented through the shared adapter and covered with fakes only. Smoke on 2026-10-23: OpenCode passes; Codex, Pi, OMP are logged in but out of quota until Oct 29; Cursor CLI is not installed. 016 Claude Code is verified. Recommend reopening 013/014/015/018 as "Review" until a live smoke is recorded (017 can close).
Also: 019 setup UI readiness is only as good as these probes; 042 records Email/X as BLOCKED-EXTERNAL.

## C. Independent-review backlog (not in tasks/, belongs to 068)

Applied: ReDoS worker, SSRF ranges, MCP argv allowlist, seq collisions, tool-loop env/signal, instruction proposals, audit outside tx, public bot DTO, owner-only background hooks, foreign-key-in-host-mode refusal.
Open: Docker `-e` env injection and uid/0700 dirs; serialize `start` in browser/desktop services; decision rate and queue caps; routines/workflows connection env and prerequisites; boot sweep of orphaned containers and Spaces; files denylist + `O_NOFOLLOW`; snapshot un-revoke trigger; document migration pair / single-instance recovery; regression tests for ReDoS bypass forms, SSRF IPv6 forms, MCP args, tool-loop signal/env.

## D. Product gaps outside the RFCs (candidates for v1.1)

Past-chat search, background memory review nudges, staged memory-write approval, Studio memory view with usage per store, desktop (Cua) in the release matrix.
