# Identity access and provisioning source review

2026-10-22. Reviewed RFC-004e4 and RFC-004f1 current source, associated tests, wiring, task handoffs and ownership/RFC-004f/005 contracts. Product source remains unchanged.

- codeQualityStatus: BLOCK
- recommendation: REQUEST_CHANGES
- reportPath: local evidence
- blockers: H1 raw session-error logging on identity requests; M1 incorrect identity response statuses in observability.

## CRITICAL

None found.

## HIGH

**H1 — Identity requests reach an unsanitized session-error logger before the opaque access boundary.** `apps/server/src/app.ts:21–29` invokes `createAuthMiddleware` for `/api/identity/*`. Installed `node_modules/.bun/evlog@2.33.1+4cc2464a3407e6c5/node_modules/evlog/dist/better-auth/index.mjs` catches `getSession` errors and, whenever NODE_ENV is not production, calls `console.warn("[evlog/better-auth] Session resolution failed:", err)`. Thus `access.ts` returning a safe `IDENTITY_UNAVAILABLE` response does not prevent the earlier raw error/cause (potential driver parameters or token-bearing context) reaching stderr. The fresh identity route integration inherits this existing middleware behavior. Tests inspect response/drain contents with successful synthetic session resolution; they do not cover this failure path or console output. Protect identity session resolution from the logger's raw-error path and assert both response/drain and console stay free of a synthetic secret-bearing thrown error. Do not weaken authentication or merely silence the test.

Independent minimal reproduction, no actual auth context/network/database:

```ts
import { createAuthMiddleware } from "./node_modules/.bun/evlog@2.33.1+4cc2464a3407e6c5/node_modules/evlog/dist/better-auth/index.mjs";
const seen: unknown[][] = [];
const original = console.warn;
console.warn = (...args) => {
  seen.push(args);
};
const middleware = createAuthMiddleware(
  {
    api: {
      getSession: async () => {
        throw Error("SYNTHETIC_PRIVATE_SENTINEL");
      },
    },
  },
  { maskEmail: true },
);
await middleware({ set: () => {} }, new Headers(), "/api/identity/status");
console.warn = original;
console.log(
  JSON.stringify({
    rawErrorLogged: seen.some((args) =>
      args.some((arg) => arg instanceof Error && arg.message === "SYNTHETIC_PRIVATE_SENTINEL"),
    ),
  }),
);
```

Executed with `bun --no-env-file -e` and the above script: exit 0, `{"rawErrorLogged":true}`. A first broader eval with Elysia composition crashed Bun 1.3.14 (exit 133); it supplies no behavioral evidence. The narrowed installed-middleware reproduction above succeeded. No real secret was used.

## MEDIUM

**M1 — Denied identity requests are logged as HTTP 200.** `apps/server/src/modules/identity/routes.ts:11` and the issuance return construct `Response.json` with response status, without setting Elysia `set.status`. Installed evlog's `onAfterResponse` in `dist/elysia/index.mjs:101–106` records `set.status || 200`. Independently executing the four non-listener route tests produced HTTP assertions for 401/403/409/201 while their evlog events printed 200, including denied issuance and replay. Security/operations consumers will see successful requests where access was denied. Set the framework status consistently with returned response status (including parser errors and successful 201 issuance), and assert captured event status equals actual HTTP status for representative branches. This is an observability correctness issue, not an authorization bypass.

**M2 — Test bypasses installed Drizzle typing and pins SQL implementation details.** `apps/server/src/modules/identity/access.test.ts:45–48` asserts a hand-written shape onto dynamically required Drizzle; lines 60–63 pin generated SQL fragments/parameter order. The programming perspective rejects this type escape hatch, and the slop perspective disfavors brittle query-layout pins. Prefer a typed installed import/compatible adapter seam, and assertions that distinguish actor/status binding without pinning incidental parameter ordering. Nonblocking followup: no demonstrated runtime access failure.

## LOW

Provisioning documentation says telemetry is disabled. The supplied options disable it normally, but installed telemetry `dist/index.mjs:348–361` ORs `BETTER_AUTH_TELEMETRY` with the option and accepts an ambient endpoint. Do not describe this factory as an unconditional egress prohibition; its future operator environment should retain the explicit telemetry environment guard used by existing proofs. No telemetry request was made in this review.

## Supported source conclusions

The provisioning factory uses installed Better Auth 1.7.7 `api.signUpEmail` with relations-v2 `transaction:true`, `autoSignIn:false`, no plugin/route exposure and no direct hash/account insert. Installed signup wraps creation/linkage in `runWithTransaction`, and the installed adapter enables real `db.transaction` when configured. Auto-signin false deliberately enables synthetic duplicate success in installed signup; exact returned-ID/email persistence readback is therefore necessary, not needless normalization/defensive complexity. The factory never substitutes an existing account found by email. Tests cover opaque single-attempt errors and adverse readback results. Actual password verification, PostgreSQL rollback and CLI composition still require the separate live proof; no result from that concurrent work is claimed here.

`Omit<Database, "$client">` is a type-only factory widening; inspected adapter code does not need the Pool-specific member. Production services explicitly inject invitation preflight, access and enrollment. Active membership is queried anew per access resolution; sole-admin authority comes from the stored singleton. Frozen issued actors plus owner/nested-parent guards reject plain forged actors and admin private-content bypass. These are helpers for future handlers, not automatic protection for absent product resources. Enrollment service rechecks account/admin/invitation state transactionally. Exact Origin matching and rejection of navigation/no-cors preserve mutation admission; no default cookie or auth forwarding changes were found.

## Independent checks and evidence limits

Executed successfully:

```sh
bun --no-env-file test packages/auth/src/operator-provisioning.test.ts packages/auth/src/index.test.ts packages/auth/src/invitation-policy.test.ts apps/server/src/modules/identity/admin-operator.integration.test.ts apps/server/src/modules/identity/access.test.ts apps/server/src/app.test.ts
```

66 pass, 0 fail, 345 assertions across six files.

```sh
bun --no-env-file test apps/server/src/modules/identity/routes.test.ts --test-name-pattern 'own status|admin issuance|trusted origins|parser failures'
```

4 pass, 0 fail, 64 assertions; 1 loopback listener test intentionally filtered out. These actual Elysia in-process fixture requests are not real cookie authentication or PostgreSQL proof.

Strict installed tsc passed with `--ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch` over provisioning source/test, auth index, access/routes source/tests, app/services/index. No new LSP/lint/build/security scan run. Parent's listener and live proofs are not independently observed here. No Docker, install, real account, database or production action performed.

Input context: task records and checkpoint/handoffs served as notepad context; no dedicated notepad supplied. Most identity files are untracked, so no isolated historical slice diff is available; complete current source was reviewed. Reports and receipts remain untrusted until inspected; the current checks above are independently executed.

## Skill perspectives

Consulted the already-loaded `omo:programming` + TypeScript reference and `omo:remove-ai-slops` perspectives. No deletion-only, prose-prompt, tautological tests or unnecessary new production parsing found. The provisioning readback protects a real installed-library synthetic-success behavior. M2 is the explicit type/test-quality violation. Source stays small and purpose-specific; no speculative abstraction or production data-extraction layer was added. Existing RFC-004e3 M1 is independently resolved in its own updated review.

Approve provisioning as a source-only slice subject to its stated live integration gates; request changes to the combined server access slice for H1/M1. No parent identity/resource/release RFC is completed by this review.
