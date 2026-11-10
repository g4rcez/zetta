import { Elysia } from "elysia";
import { z } from "zod";
import {
  APPROVAL_MODES,
  RAIL_MODES,
  SIDEBAR_LIMITS,
  SIDEBAR_SIDES,
  NAV_MODES,
  STEER_MODES,
  THEMES,
  TIME_FORMATS,
} from "@zetta/db/schema/preferences";
import { AccessError, type createIdentityAccess } from "../identity/access";
import type { PreferenceStore } from "./store";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";

export type PreferenceServices = {
  access: ReturnType<typeof createIdentityAccess>;
  preferences: PreferenceStore;
};
const width = (l: { min: number; max: number }) => z.number().int().min(l.min).max(l.max);
const patch = z.strictObject({
  railMode: z.enum(RAIL_MODES).optional(),
  sidebarSide: z.enum(SIDEBAR_SIDES).optional(),
  navMode: z.enum(NAV_MODES).optional(),
  steerMode: z.enum(STEER_MODES).optional(),
  railWidth: width(SIDEBAR_LIMITS.railWidth).optional(),
  listWidth: width(SIDEBAR_LIMITS.listWidth).optional(),
  timeFormat: z.enum(TIME_FORMATS).optional(),
  approvalMode: z.enum(APPROVAL_MODES).optional(),
  theme: z.enum(THEMES).nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .transform((v) => v.toLowerCase())
    .nullable()
    .optional(),
  // Ids only, never names: a stale or foreign id is harmless because only this person reads the list.
  botOrder: z.array(z.uuid()).max(500).optional(),
  roomOrder: z.array(z.uuid()).max(500).optional(),
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
        if (e instanceof AccessError) return accessFail(e);
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
