import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { InboundError, type InboundService } from "./service";

export type InboundServices = { access: ReturnType<typeof createIdentityAccess>; inbound: InboundService };
const uuid = z.string().uuid();
const pluginId = z.string().regex(/^[a-z0-9_-]{1,32}$/);
const route = z.strictObject({
  enabled: z.boolean(), filter: z.strictObject({ direct: z.boolean(), groups: z.boolean(), chats: z.array(z.string().trim().min(1).max(80)).max(50) }),
  pollEverySeconds: z.number().int().min(20).max(3600).optional(),
});
const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) => out({ error: { code, message } }, status);

export function createInboundRoutes({ access, inbound }: InboundServices, trustedOrigins: readonly string[]) {
  type Ctx = { actor: Awaited<ReturnType<typeof access.requireActive>>; body: unknown; params: Record<string, string> };
  function mapError(e: unknown) {
    if (e instanceof AccessError) return fail(e.code === "SIGN_IN_REQUIRED" ? 401 : e.code === "NOT_FOUND" ? 404 : e.code === "IDENTITY_UNAVAILABLE" ? 503 : 403, e.code, e.message);
    if (e instanceof InboundError) return fail(400, e.code, e.safe);
    if (e instanceof z.ZodError) return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = (work: (c: Ctx) => Promise<unknown>) => async ({ request, body, params }: { request: Request; body: unknown; params: Record<string, string> }) => {
    try {
      if (request.method !== "GET") {
        const origin = request.headers.get("origin");
        if (!origin || !trustedOrigins.includes(origin)) return fail(403, "UNTRUSTED_ORIGIN", "Open Zetta from its trusted application and try again.");
      }
      return out(await work({ actor: await access.requireActive(request.headers), body, params }));
    } catch (e) { return mapError(e); }
  };
  return new Elysia({ prefix: "/api", normalize: false })
    .get("/inbound/routes", g(async (c) => ({ routes: await inbound.listRoutes(c.actor) })))
    .post("/inbound/routes/:id/poll", g(async (c) => inbound.pollNow(c.actor, uuid.parse(c.params.id))))
    .get("/bots/:id/inbound", g(async (c) => inbound.forBot(c.actor, uuid.parse(c.params.id))))
    .put("/bots/:id/inbound/:pluginId", g(async (c) => ({ route: await inbound.setRoute(c.actor, uuid.parse(c.params.id), pluginId.parse(c.params.pluginId), route.parse(c.body)) })))
    .delete("/bots/:id/inbound/:pluginId", g(async (c) => ({ route: await inbound.removeRoute(c.actor, uuid.parse(c.params.id), pluginId.parse(c.params.pluginId)) })));
}
