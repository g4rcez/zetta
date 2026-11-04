import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { InboundError, type InboundService } from "./service";
import { accessFail, createGuardedRoute, fail, out } from "../http-response";

export type InboundServices = {
  access: ReturnType<typeof createIdentityAccess>;
  inbound: InboundService;
};
const uuid = z.string().uuid();
const pluginId = z.string().regex(/^[a-z0-9_-]{1,32}$/);
const hookUser = /^[A-Za-z0-9_-]{1,64}$/; // user ids are not always uuids
const MAX_HOOK_BYTES = 1_000_000;
const route = z.strictObject({
  enabled: z.boolean(),
  filter: z.strictObject({
    direct: z.boolean(),
    groups: z.boolean(),
    chats: z.array(z.string().trim().min(1).max(80)).max(50),
  }),
  pollEverySeconds: z.number().int().min(20).max(3600).optional(),
});

export function createInboundRoutes(
  { access, inbound }: InboundServices,
  trustedOrigins: readonly string[],
) {
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof InboundError) return fail(400, e.code, e.safe);
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  return (
    new Elysia({ prefix: "/api", normalize: false })
      // Push from a channel's server (for example WAHA). No session and no origin: the plugin checks the signature of the raw body.
      // Everything that is not a valid signature gets the same 401, so the route does not tell which plugins or users exist.
      .post(
        "/inbound/:pluginId/hook/:userId",
        async ({ request, params }) => {
          if (!hookUser.test(params.userId) || !pluginId.safeParse(params.pluginId).success)
            return fail(401, "UNAUTHORIZED", "Not allowed.");
          if (Number(request.headers.get("content-length") ?? 0) > MAX_HOOK_BYTES)
            return fail(413, "TOO_LARGE", "The request is too large.");
          const raw = await request.text();
          const verdict =
            raw.length > MAX_HOOK_BYTES
              ? "invalid"
              : await inbound.push(params.userId, params.pluginId, request.headers, raw);
          return verdict === "invalid"
            ? fail(401, "UNAUTHORIZED", "Not allowed.")
            : out({ ok: true });
        },
        { parse: "none" },
      )
      .get(
        "/inbound/routes",
        g(async (c) => ({ routes: await inbound.listRoutes(c.actor) })),
      )
      .post(
        "/inbound/routes/:id/poll",
        g(async (c) => inbound.pollNow(c.actor, uuid.parse(c.params.id))),
      )
      .get(
        "/bots/:id/inbound",
        g(async (c) => inbound.forBot(c.actor, uuid.parse(c.params.id))),
      )
      .put(
        "/bots/:id/inbound/:pluginId",
        g(async (c) => ({
          route: await inbound.setRoute(
            c.actor,
            uuid.parse(c.params.id),
            pluginId.parse(c.params.pluginId),
            route.parse(c.body),
          ),
        })),
      )
      .delete(
        "/bots/:id/inbound/:pluginId",
        g(async (c) => ({
          route: await inbound.removeRoute(
            c.actor,
            uuid.parse(c.params.id),
            pluginId.parse(c.params.pluginId),
          ),
        })),
      )
  );
}
