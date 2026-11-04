import { Elysia } from "elysia";
import { z } from "zod";
import { RAIL_MODES, SIDEBAR_LIMITS, TIME_FORMATS } from "@zetta/db/schema/preferences";
import { AccessError, type createIdentityAccess } from "../identity/access";
import type { PreferenceStore } from "./store";
import { fail, out, rejectUntrustedOrigin } from "../http-response";

export type PreferenceServices = {
  access: ReturnType<typeof createIdentityAccess>;
  preferences: PreferenceStore;
};
const width = (l: { min: number; max: number }) => z.number().int().min(l.min).max(l.max);
const patch = z.strictObject({
  railMode: z.enum(RAIL_MODES).optional(),
  railWidth: width(SIDEBAR_LIMITS.railWidth).optional(),
  listWidth: width(SIDEBAR_LIMITS.listWidth).optional(),
  timeFormat: z.enum(TIME_FORMATS).optional(),
  // Ids only, never names: a stale or foreign id is harmless because only this person reads the list.
  botOrder: z.array(z.uuid()).max(500).optional(),
});

export function createPreferenceRoutes(
  { access, preferences }: PreferenceServices,
  trustedOrigins: readonly string[],
): Elysia {
  const g =
    (
      work: (c: {
        actor: Awaited<ReturnType<typeof access.requireActive>>;
        body: unknown;
      }) => Promise<unknown>,
    ) =>
    async ({ request, body }: { request: Request; body: unknown }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        return out(await work({ actor: await access.requireActive(request.headers), body }));
      } catch (e) {
        if (e instanceof AccessError)
          return fail(
            e.code === "SIGN_IN_REQUIRED" ? 401 : e.code === "IDENTITY_UNAVAILABLE" ? 503 : 403,
            e.code,
            e.message,
          );
        if (e instanceof z.ZodError)
          return fail(400, "INVALID_REQUEST", "Check the details and try again.");
        return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
      }
    };
  // Typed as a plain Elysia: one more typed route group makes the chain in app.ts too large for TypeScript to represent.
  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/preferences",
      g(async (c) => ({ preferences: await preferences.get(c.actor) })),
    )
    .patch(
      "/preferences",
      g(async (c) => ({ preferences: await preferences.update(c.actor, patch.parse(c.body)) })),
    ) as unknown as Elysia;
}
