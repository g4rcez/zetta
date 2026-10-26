# Release readiness (RFC-068)

Date: 2026-10-23. Verdict: **NO-GO against RFC-068's own rule** ("real compatibility incomplete cannot be released as done"). **GO for a self-hosted installation that runs in Docker mode** (`ZETTA_HARNESS_RUNTIME=docker`, `ZETTA_BROWSER_RUNTIME=docker`) with Claude Code as the supported harness, and a conditional GO for trusted-team host mode; see section 3.

## 0. Owner decisions on the gate (2026-10-23)

- **Deployment:** host mode is allowed for trusted teams (Docker mode remains the recommended hardened option).
- **May ship unverified, with a visible label:** the Jev adapter, email/X sources, and every harness except Claude Code (the app shows "not verified yet" next to them).
- **Must be done before a "go":** backup/restore drill (done, `docs/verification/restore-drill.md`), an independent code review (see section 6), and owner approval of the persistent-memory rules (RFC-054, section 7).
- **Open tension:** the owner also asked that the gate require all six harnesses verified live, while asking that no quota be spent on the five others and that they be assumed working. The release therefore stays **blocked on RFC-068** until that is resolved (one-line answer needed: live smoke for the others, or relax the gate to "Claude Code verified, others labelled").

## 1. Gate matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Offline tests (server, db, auth, web) | PASS, 1014 tests / 0 fail | `bun test apps/server packages apps/web` with Postgres (`zetta_test`), plus opt-in real-model/Chromium suites |
| Strict diagnostics | PASS for product code (`tsc`, web build). Pre-existing type errors remain in unused proof machinery `modules/runtime/dispatch-schema-transitions.ts` | `cd apps/server && bunx tsc --noEmit` |
| Production web build | PASS | `vp build` |
| Cross-user isolation | PASS for product resources; PASS for containers in Docker mode (real-docker tests); host mode has no OS isolation | `docs/verification/isolation.md` |
| Representative workflows | PASS (scripted model through real pipeline) + real-model evidence for Claude Code/Laya/Chromium | `docs/verification/v1-workflows.md` |
| Recovery | Reconciliation PASS; restore drill NOT run | `docs/operations/recovery.md` |
| Six harnesses live | Claude Code verified live; the others are ASSUMED WORKING by owner decision (2026-10-23), not verified | `GET /api/harnesses`, `docs/decisions/harness-compatibility.md` |
| Jev | Adapter kept as an optional backend; no tests and no live proof by owner decision (Laya is the default engine) | `docs/decisions/jev.md` |
| Laya (builtin decisions) | PASS (real ONNX) | `docs/decisions/laya.md` |
| Browser use with takeover | PASS (Chromium, real tests) | `docs/decisions/browser-computer.md` |
| Desktop computer use | PASS: Cua Spaces (per-user Linux container), real Space test and UI walkthrough | `docs/decisions/browser-computer.md` |
| Email / X sources | FAIL: blocked by external access | `docs/decisions/app-integrations.md` |
| Independent review | NOT done: no second reviewer; one automated audit pass per RFC group (`docs/audit/`) | - |

## 2. Capability status (12 v1 capabilities)

1 bot configuration/onboarding/approved proposals: done. 2 six harnesses: adapter for all six, one live. 3 schedules: done (list/form UI). 4 workspaces: done. 5 private chat: done. 6 Decisions: Laya done; Jev adapter kept as optional backend (untested by decision). 7 hooks: done. 8 self-learning: done. 9 persistent memory: done (Postgres-backed). 10 attention + kanban: done. 11 visual workflows: done (form builder). 12 browser/computer: browser (Playwright or Docker) and desktop (Cua Spaces) done.

## 3. Operating limits to accept (trusted-team mode)

- Harness CLIs and the browser run as the server's OS user in the same machine. Set `ZETTA_HARNESS_HOME_ROOT` to separate native logins per user; it does not stop a malicious harness reading files the server user can read.
- Prompt injection from web pages/MCP results can steer a bot into emitting `zetta:*` tools. Effects are bounded: config/creation changes require approval, memory writes are user data, browser actions are capped and SSRF-guarded, stdio MCP commands need an administrator allowlist.
- No rate limiting, no TLS/deployment guide, no automated backups, single server process.
- DNS-rebinding is not closed for browser/MCP address checks.

## 4. Required configuration

`DATABASE_URL`, `BETTER_AUTH_SECRET`, `CORS_ORIGIN` (existing). Optional: `ZETTA_CONNECTION_KEY` (`openssl rand -base64 32`; enables Accounts; losing it makes stored keys unreadable), `ZETTA_FILES_ROOT`, `ZETTA_BROWSER_ROOT`, `ZETTA_CHROMIUM_PATH`, `ZETTA_HARNESS_RUNTIME=docker` (+ `ZETTA_HARNESS_IMAGE`, `ZETTA_HARNESS_NETWORK`, `ZETTA_HARNESS_MEMORY`, `ZETTA_DOCKER_BIN`), `ZETTA_BROWSER_RUNTIME=docker` (+ `ZETTA_BROWSER_IMAGE`), `ZETTA_HARNESS_HOME_ROOT`, `ZETTA_HARNESS_MAX(_PER_USER)`, `ZETTA_MCP_ALLOWLIST`, `ZETTA_LAYA_PRELOAD=0`, `ZETTA_DESKTOP_RUNTIME=cua` (desktop control through Cua Spaces; needs the `cua` CLI). Run `drizzle-kit migrate` before starting.

## 5. What would turn this into a full GO

Live smoke per remaining harness; container credentials for Claude Code (a per-user login in the mounted home or the user's API-key connection) to run the live smoke inside the container; the backup/restore drill; an independent code/QA review; your answers to the open questions about RFC-068 (what "real compatibility" must mean for this release).

## Independent review fixes (applied)

Independent code review findings were fixed and covered by the suites: worker-isolated regex with timeout (ReDoS), SSRF range blocking incl. IPv4-mapped IPv6, MCP stdio argv allowlist, call-time URL checks, collision-safe message sequencing, bot-written instructions now require approval (`create_instruction` proposal), approval audit written outside the transaction, shared-bot listings expose only the public card, owner-only background hooks, and a refusal to run someone else's bot with your key outside Docker mode. Server suites: 830 pass; the only failure is a pre-existing Linux-only journal-store fixture guard test. Docker browser/harness tests and the web build pass.

Still open for the owner: the harness-gate contradiction (live smoke for all six vs. "Claude verified, others labelled") and approval of the RFC-054 memory rules.

## Owner decision: harness gate (2026-10-23)

The owner keeps the live-smoke requirement for all six harnesses (Claude Code, Codex, Pi, OMP, OpenCode, Cursor) and will supply the accounts. This supersedes the earlier "assume working / label unverified" stance for the release gate. Until each harness has a recorded live smoke run, RFC-068 stays **Blocked** and the UI keeps the "(not verified yet)" label on unverified harnesses.

Needed from the owner: one account/credential per non-Claude harness, supplied by the owner through the connections store (never pasted into docs or chat logs). Smoke recipe per harness: onboard a bot, send one prompt, confirm a streamed reply, cancel, and confirm failure messages for missing auth.

Still open: approval of the RFC-054 memory rules.

## Live harness smoke (2026-10-23, host mode, prompt "reply pong")

| Harness | Result |
| --- | --- |
| Claude Code | Verified earlier (haiku): replies, tool protocol, MCP, Docker mode |
| OpenCode | Pass (reply in ~5 s) |
| Codex | Logged in, but the account hit its ChatGPT usage limit (resets 2026-10-29) → now reported as a typed `quota` error |
| Pi | Same ChatGPT subscription limit → `quota` |
| OMP | Same usage limit (codex backend) → `quota` |
| Cursor | Not testable: `cursor-agent` is not installed (the `agent` binary on this machine is Grok, not Cursor) |

Gate stays open for Codex, Pi, OMP (rerun after the limit resets or with an API key) and Cursor (install the Cursor CLI).

Owner decision (2026-10-23): the Hermes-style memory rules are approved for v1 as implemented. RFC-054's remaining item is the six-harness privacy proof.

## Gate re-evaluation (2026-10-23, after owner directions)

Owner directions applied: run with or without Docker and on any OS (002/008); Email and X setup (045); Jev tested through Laya (047); memory verified with Claude only (054); restore drill rerun (065).

| Requirement | State |
| --- | --- |
| Product isolation across users (all resources incl. memory and source connections) | Pass (cross-user matrix, 872 server tests, 0 failing, against compose Postgres) |
| Docker and non-Docker operation | Both supported and documented (`docs/operations/runtime-modes.md`); Docker proven by real-container tests, host mode by the full suites |
| macOS | Verified |
| Linux, Windows | Code paths added (process-tree kill, profile env), CI matrix written, **not yet run** |
| Claude Code (live) | Pass: tool protocol, memory write/recall/privacy, MCP, Chromium |
| Other five harnesses | Not live-verified. By the latest owner direction memory is tested with Claude only; the earlier live-smoke requirement for all six is still unmet (OpenCode passes; Codex/Pi/OMP quota-limited until Oct 29; Cursor CLI missing) |
| Jev | Adapter verified against real Laya through a System One endpoint; Typesafe's hosted API not exercised |
| Email / X sources | Built and covered with fakes; live accounts not exercised until the owner connects them |
| Backup/restore drill | Pass, repeatable (`scripts/restore-drill.sh`) |
| Independent code review | Findings fixed; open: Docker `-e` env injection and uid/0700 dirs, start serialization, decision caps, orphan sweep, files denylist, snapshot un-revoke trigger |

Verdict: **conditional GO for a trusted-team install on macOS/Linux with Claude Code**; full GO still needs the first Linux/Windows CI run, the remaining review fixes, and live checks of Email/X and the non-Claude harnesses.

## Review backlog closed (2026-10-26)

Done and tested (`apps/server/src/modules/hardening.test.ts`, memory suite, Docker tests): Docker env via `-e KEY` (no secrets in argv), serialized browser/desktop starts, bounded decision backlog, boot sweep of orphaned containers/Spaces, file denylist + `O_NOFOLLOW` + path character checks, permanent snapshot revocation (DB trigger), workflows refuse bots that need per-user accounts, regression tests for ReDoS forms, SSRF/IPv6 forms, MCP allowlist parsing and file access. Still not done: container uid/0700 home directories (Docker homes remain world-writable inside the user's own directory) and a Linux/Windows CI run.
