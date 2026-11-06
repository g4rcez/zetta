import { createHash, randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

/** How long a pairing code works, and the most codes or tries one client gets in 15 minutes. */
export const PAIR_CODE_MINUTES = 3;
const LIMIT = { window: 15 * 60, max: 10 };

/** Only the hash of a code is stored, so a read of the verification table cannot sign anyone in. */
const identifier = (code: string) =>
  `pair-phone:${createHash("sha256").update(code).digest("base64url")}`;

/**
 * Signs a phone in from a signed-in browser. `start` (signed in) makes a one-time code for the QR; `redeem` (the phone, not signed in)
 * trades it for a session of its own. The built-in oneTimeToken plugin copies the desktop's own session token to the phone instead, so
 * signing out on one device would sign out both, and the phone could not be revoked alone. A code works once (`consumeVerificationValue`
 * is atomic and checks the expiry) and every failure answers the same.
 */
export const pairPhone = () =>
  ({
    id: "pair-phone",
    endpoints: {
      startPairPhone: createAuthEndpoint(
        "/pair-phone/start",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const code = randomBytes(32).toString("base64url");
          const expiresAt = new Date(Date.now() + PAIR_CODE_MINUTES * 60_000);
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: identifier(code),
            value: ctx.context.session.user.id,
            expiresAt,
          });
          return ctx.json({ code, expiresAt: expiresAt.toISOString() });
        },
      ),
      redeemPairPhone: createAuthEndpoint(
        "/pair-phone/redeem",
        { method: "POST", body: z.object({ code: z.string().min(20).max(100) }) },
        async (ctx) => {
          const row = await ctx.context.internalAdapter.consumeVerificationValue(
            identifier(ctx.body.code),
          );
          const user = row ? await ctx.context.internalAdapter.findUserById(row.value) : null;
          const session = user ? await ctx.context.internalAdapter.createSession(user.id) : null;
          if (!user || !session)
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_PAIR_CODE",
              message: "This code is not valid anymore.",
            });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
    rateLimit: [
      { pathMatcher: (path) => path === "/pair-phone/start", ...LIMIT },
      { pathMatcher: (path) => path === "/pair-phone/redeem", ...LIMIT },
    ],
  }) satisfies BetterAuthPlugin;
