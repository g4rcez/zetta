import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { ConnectionsUnavailableError, PROVIDERS, type ConnectionsService } from "./service";

/** `plugin` connections hold sealed plugin config managed by the Plugins tab; they are neither listed nor user-creatable here. */
const USER_PROVIDERS = PROVIDERS.filter((p) => p !== "plugin");
import { ConnectionStoreError } from "./store-contract";

export type ConnectionServices = { access: ReturnType<typeof createIdentityAccess>; connections: ConnectionsService };
const uuid = z.string().uuid();
const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) => out({ error: { code, message } }, status);
const key = z.string().regex(/^[a-z0-9_-]{1,32}$/);

export function createConnectionRoutes({ access, connections }: ConnectionServices, trustedOrigins: readonly string[]) {
  type Ctx = { userId: string; actor: Awaited<ReturnType<typeof access.requireActive>>; body: unknown; params: Record<string, string> };
  function mapError(e: unknown) {
    if (e instanceof AccessError) return fail(e.code === "SIGN_IN_REQUIRED" ? 401 : e.code === "NOT_FOUND" ? 404 : e.code === "IDENTITY_UNAVAILABLE" ? 503 : 403, e.code, e.message);
    if (e instanceof ConnectionsUnavailableError) return fail(503, "CONNECTIONS_NOT_CONFIGURED", "Connections are not configured on this server. The administrator must set ZETTA_CONNECTION_KEY.");
    if (e instanceof ConnectionStoreError) return e.code === "conflict" ? fail(409, "STALE_VERSION", "This connection changed. Reload and try again.") : e.code === "not-found" ? fail(404, "NOT_FOUND", "Resource not found.") : e.code === "invalid-input" ? fail(400, "INVALID_REQUEST", "Check the details and try again.") : fail(503, "CONNECTIONS_UNAVAILABLE", "Connections are unavailable right now.");
    if (e instanceof z.ZodError) return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = (work: (c: Ctx) => Promise<unknown>, status = 200) => async ({ request, body, params }: { request: Request; body: unknown; params: Record<string, string> }) => {
    try {
      if (request.method !== "GET") { const o = request.headers.get("origin"); if (!o || !trustedOrigins.includes(o)) return fail(403, "UNTRUSTED_ORIGIN", "Open Zetta from its trusted application and try again."); }
      const actor = await access.requireActive(request.headers);
      return out(await work({ userId: actor.userId, actor, body, params }), status);
    } catch (e) { return mapError(e); }
  };
  return new Elysia({ prefix: "/api", normalize: false })
    .get("/connections", g(async (c) => ({ configured: connections.configured(), providers: USER_PROVIDERS, connections: connections.configured() ? (await connections.list(c.actor)).filter((x) => x.provider !== "plugin") : [] })))
    .post("/connections", g(async (c) => ({ connection: await connections.create(c.actor, z.strictObject({ provider: z.enum(USER_PROVIDERS as [string, ...string[]]), label: z.string().trim().min(1).max(100), secret: z.string().min(8).max(8000) }).parse(c.body)) }), 201))
    .post("/connections/:id/revoke", g(async (c) => ({ connection: await connections.revoke(c.actor, uuid.parse(c.params.id), z.strictObject({ expectedRevision: z.number().int().positive() }).parse(c.body).expectedRevision) })))
    .get("/bots/:id/connections", g(async (c) => ({ requirements: await connections.status(c.actor, uuid.parse(c.params.id)) })))
    .put("/bots/:id/connections/:key", g(async (c) => ({ binding: await connections.bind(c.actor, uuid.parse(c.params.id), key.parse(c.params.key), z.strictObject({ connectionId: uuid }).parse(c.body).connectionId) })))
    .delete("/bots/:id/connections/:key", g(async (c) => ({ binding: await connections.unbind(c.actor, uuid.parse(c.params.id), key.parse(c.params.key)) })));
}
