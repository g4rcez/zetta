# Typesafe Jev decision (RFC-046/047)

Wire contract, limits and privacy notes: see [jev-laya.md](jev-laya.md). Implementation: `apps/server/src/modules/decisions/jev.ts`.

- **Laya is the default and the supported decision engine** (builtin, free, local: [laya.md](laya.md)). The hosted Jev adapter is **kept as an optional per-bot backend** (`decision_config.backend = "jev"`), by owner decision of 2026-10-23.
- **Selecting Jev is the owner's consent** that the message text and option labels of chats with that bot are sent to Typesafe (api.typesafe.ai). There is no silent fallback to a hosted model.
- **Credential:** only the requesting user's own `jev` connection (sealed store), resolved per call; never an environment/admin key. Missing/revoked -> `unavailable` -> the bot answers normally (routing fails open).
- **Hardening in the adapter:** fixed HTTPS origin, `redirect: error`, 10 s deadline, 32 KiB outbound / 64 KiB response caps, strict response schema, model pin `jev-1.13.0`, option-set equality, argmax and probability-sum checks, no retries.
- **Status:** implemented against the documented contract. By owner decision it has **no automated tests and no live proof yet** (a live check needs a Typesafe API key).
