import { Elysia } from "elysia";
import { z } from "zod";
import { RAIL_MODES, SIDEBAR_LIMITS } from "@zetta/db/schema/preferences";
import { AccessError, type createIdentityAccess } from "../identity/access";
import type { PreferenceStore } from "./store";

export type PreferenceServices = {
  access: ReturnType<typeof createIdentityAccess>;
  preferences: PreferenceStore;
};
const width = (l: { min: number; max: number }) => z.number().int().min(l.min).max(l.max);
const patch = z.strictObject({
  railMode: z.enum(RAIL_MODES).optional(),
  railWidth: width(SIDEBAR_LIMITS.railWidth).optional(),
  listWidth: width(SIDEBAR_LIMITS.listWidth).optional(),
});
const out = (body: unknown, code = 200) =>
  Response.json(body, { status: code, headers: { "cache-control": "no-store" } });
const fail = (code: number, error: string, message: string) =>
  out({ error: { code: error, message } }, code);

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
        if (request.method !== "GET") {
          const origin = request.headers.get("origin");
          if (!origin || !trustedOrigins.includes(origin))
            return fail(
              403,
              "UNTRUSTED_ORIGIN",
              "Open Zetta from its trusted application and try again.",
            );
        }
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
