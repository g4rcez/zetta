> **Superseded by [release-readiness.md](release-readiness.md) (2026-10-23).** The text below is the earlier, smaller-scope verdict and is kept for history.

# Zetta v1 release verdict (simplified path)

Date: 2026-10-22. Scope: local/dev installation, compose Postgres. This supersedes the 82-RFC ordering for the capabilities below; `TASKS.md` statuses were deliberately not rewritten. Verdict: **conditional go for a trusted-team, self-hosted install; not a go for exposing the browser/harness features to untrusted users.** See "Known limits".

## How to run

```bash
docker compose up -d postgres                      # compose Postgres (no external telemetry needed)
cd packages/db && DATABASE_URL=postgresql://postgres:password@localhost:5432/zetta bunx drizzle-kit migrate
cd ../../apps/server && bun run src/index.ts       # plain evlog console logs; Laya warms in the background
cd ../web && bunx vp dev --port 3001
```

First account: bootstrap the admin with the operator CLI (`docs/operations/identity-admin.md`), then invite members from the Dashboard.
Optional env: `ZETTA_FILES_ROOT` (server files: `me/<userId>/…`, `shared/…`), `ZETTA_BROWSER_ROOT`, `ZETTA_CHROMIUM_PATH`, `ZETTA_LAYA_PRELOAD=0`.

## Capability evidence

| # | Capability | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Bot configuration via forms or chat, readiness only after explicit satisfaction, bot-proposed changes need approved diff | Done | `chat.integration.test.ts` (onboarding, version reset), `tools.integration.test.ts` (propose, approve, stale, cross-user), real Haiku test follows the `zetta:config` protocol |
| 2 | Six harnesses | Partial | One adapter for pi, codex, omp, claude-code, opencode, cursor-agent (argv tests). Only **claude-code (haiku)** exercised live; cursor-agent is not installed on the dev machine |
| 3 | Schedules/routines with calendar-style form | Done (form, not a calendar grid) | Timezone/DST test, claim-before-run, readiness recheck, attention on failure |
| 4 | Workspaces incl. inner groups | Done | nested workspace test; moving bots never changes access |
| 5 | Full private chat: streaming, Markdown, attachments, server files, mentions, threads, reactions, snapshots | Done | `experience.integration.test.ts`, `features.integration.test.ts`; browser pass for streaming/Markdown |
| 6 | Jev/Laya decisions | Done via Laya (local ONNX). Typesafe Jev hosted API is not integrated | Real-model test and Studio tab: refund ticket -> billing 95.4% |
| 7 | Hooks | Done | add_context, redact (also history), stop, background |
| 8 | Self-learning memory, instruction library | Done | remember/instruction tools, retrieval tests |
| 9 | Persistent memory | Done (Postgres-backed, per user, optionally per bot) | survives restarts; not a Hermes protocol implementation |
| 10 | Attention model + kanban | Done | attention tests; acknowledging never changes a run |
| 11 | Visual conditional workflows | Done (form builder + flow strip, bounded graph) | prompt/browse/decision/condition nodes, step budget, trace |
| 12 | Browser/computer use, per-user profiles, takeover/hand-back | Done for text-driven control | real Chromium test; bot tool loop capped at 5 rounds; takeover blocks agents and raises attention |

## Known limits (not hidden)

- Harness CLIs run as the server's OS user with a minimal env, an empty temp cwd and a deadline, **not** in a container/VM. Native harness tools could still read what that OS user can read. Do not treat this as the RFC-002 isolation boundary.
- Browser SSRF guard resolves DNS before navigation; a rebinding attacker can bypass it. Bots receive page text only (no screenshots).
- Bot tool blocks are trusted text from the harness; prompt injection from web pages could make a bot emit tools. Mitigations: config changes need approval; remember/instruction writes are the user's own data; browser actions are bounded.
- No rate limiting, no audit log for tool calls, no automated backups, no production deployment/TLS guide.
- Jev (Typesafe) hosted integration and a calendar-grid UI were not built.
- The older RFC proof machinery (VM journals, dispatch claims) remains in the repo but is not used by the product path.
