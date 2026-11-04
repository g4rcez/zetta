# Representative v1 workflow verification (RFC-067)

Two kinds of evidence, never mixed:

**Fixture proof (scripted model through the real pipeline)** - `apps/server/src/modules/v1-workflows.integration.test.ts` (Postgres):

1. Onboarding: configure -> real (non-fixture) answer -> persisted satisfaction question -> explicit "not yet" keeps it unready -> routine activation blocked with the reason -> explicit yes -> ready -> activation works.
2. Successful task -> reusable instruction (receipt on the answer) -> retrieved for similar work (answer shows what it used) -> routine summary (task, bot, timezone, next 3 runs, context mode, accounts, destination) -> first occurrence -> durable result chat.
3. Wrong answer -> "used knowledge" shows the note -> edit the note (versioned) -> later prompt uses the corrected note only.
4. Blocked task -> failed occurrence kept in history -> one attention card with result link -> sidebar badge count equals the kanban column -> activity trail shows the same failure -> acknowledging does not change the run -> repair -> deliberate retry with a new request key -> both attempts retained.

**Real-system proof**

- Claude Code (haiku): adapter smoke, UI chat with streaming, and a real-harness test (removed 2026-11-04 with the other opt-in real-model tests) where the real model followed the `zetta:config` protocol.
- Laya (real ONNX): classification test and Studio > Decisions (refund ticket -> billing 95.4%).
- Real Chromium: computer tests (opt-in `ZETTA_COMPUTER_TEST=1`) and a manual session loading a public page.
- Browser walkthrough of login, chat, markdown, onboarding and Studio on a local dev server (earlier sessions); the new Studio/Chat panels were re-checked in the browser at the end of this pass (see `docs/release/release-readiness.md`).

Not covered by a real run: harnesses other than Claude Code, Jev (needs a paid key), email/X sources, desktop computer use, real-user accessibility sessions.

## Additions 2026-10-23

Memory (bounded user/bot stores) and email/X sources are covered by `memory.integration.test.ts`, a real-memory test (real Claude haiku, removed 2026-11-04 with the other opt-in real-model tests) and `private-sources.integration.test.ts`.

Demo recording (real `claude-haiku-5-5` through the UI): `docs/demo/zetta-v1-claude-haiku-5-5-demo.mp4`: configure the bot, chat, memory across chats, Email/X source form, build/check/save/run a two-step workflow, canvas. The Email/X forms were shown but not submitted (no live accounts).
