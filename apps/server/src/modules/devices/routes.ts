import { MCP_SCOPES, requireMcpAuth } from "@zetta/auth";
import { Elysia } from "elysia";
import { z } from "zod";
import { ComputerError } from "../computer/service";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type ActiveActor, type createIdentityAccess } from "../identity/access";
import type { DeviceHub } from "./hub";
import type { DeviceService } from "./service";

export type DeviceServices = {
  access: ReturnType<typeof createIdentityAccess>;
  devices: DeviceService;
  hub: DeviceHub;
  /** The better-auth instance that issues access tokens (the same one the MCP endpoint trusts). */
  auth: Parameters<typeof requireMcpAuth>[0];
  /** The access token's subject as an active actor, or null when that member is gone. */
  actorFor(userId: string): Promise<ActiveActor | null>;
  /** The protected resource access tokens must be bound to (`mcpResource`). */
  resource: string;
};

const pair = z.strictObject({
  name: z.string().trim().min(1).max(60),
  platform: z.enum(["darwin", "linux", "win32"]),
});
const share = z.strictObject({ botIds: z.array(z.string().uuid()).max(50) });

const MESSAGES: Partial<Record<ComputerError["code"], string>> = {
  INVALID: "Check the details and try again.",
  LIMIT: "This account has as many computers paired as it can have. Remove one first.",
  NOT_FOUND: "That computer is not paired.",
};

function mapError(e: unknown) {
  if (e instanceof AccessError) return accessFail(e);
  if (e instanceof z.ZodError)
    return fail(400, "INVALID_REQUEST", "Check the details and try again.");
  if (e instanceof ComputerError) {
    const status = e.code === "NOT_FOUND" ? 404 : e.code === "LIMIT" ? 409 : 400;
    return fail(status, e.code, MESSAGES[e.code] ?? "That did not work.");
  }
  return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
}

/**
 * Computers that connect to this server so the owner's bots can work on them (the Zetta desktop app).
 * - `POST /api/devices`: pairing. Needs an OAuth access token with the write scope (the app signed in as the person); answers the device's
 *   credential once.
 * - `GET|PATCH|DELETE /api/devices...`: the person's own list, which bots may use each computer, and revoking one. Cookie session.
 * - `GET /api/devices/connect`: a WebSocket the app opens with its credential. The server sends it requests; it answers them.
 */
export function createDeviceRoutes(
  services: DeviceServices,
  trustedOrigins: readonly string[],
): Elysia {
  const { access, devices, hub } = services;
  const g = createGuardedRoute({
    access: { requireActive: (headers) => access.requireActive(headers) },
    trustedOrigins,
    mapError,
  });
  const pairing = requireMcpAuth(
    services.auth,
    async (request, claims) => {
      const actor = typeof claims.sub === "string" ? await services.actorFor(claims.sub) : null;
      if (!actor) return Response.json({ error: "inactive_member" }, { status: 403 });
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail(400, "INVALID_REQUEST", "Check the details and try again.");
      }
      try {
        const made = await devices.create(actor, pair.parse(body));
        return Response.json(made, { headers: { "cache-control": "no-store" } });
      } catch (e) {
        return mapError(e);
      }
    },
    { resource: services.resource, requiredScopes: [MCP_SCOPES.write] },
  );

  const credentialOf = (request: Request) =>
    /^Bearer +(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";

  // One chain: `derive` adds `deviceAuth` to the routes after it (the WebSocket), and only to them.
  const routes = new Elysia({ normalize: false })
    .post("/api/devices", ({ request }) => pairing(request))
    .get(
      "/api/devices",
      g(async ({ actor }) => ({ devices: await devices.list(actor.userId) })) as never,
    )
    .patch(
      "/api/devices/:id",
      g(async ({ actor, params, body }) => ({
        device: await devices.setBots(actor, String(params.id), share.parse(body).botIds),
      })) as never,
    )
    .delete(
      "/api/devices/:id",
      g(
        async ({ actor, params }) => (await devices.revoke(actor, String(params.id)), { ok: true }),
      ) as never,
    )
    .derive(async ({ request }) => ({
      deviceAuth: await devices.authenticate(credentialOf(request)),
    }))
    .ws("/api/devices/connect", {
      beforeHandle({ deviceAuth, status }) {
        if (!deviceAuth) return status(401);
      },
      open(ws) {
        const id = ws.data.deviceAuth!.id;
        const socket = { send: (data: string) => void ws.send(data), close: () => ws.close() };
        (ws.data as { socket?: typeof socket }).socket = socket;
        hub.attach(id, socket);
        void devices.touch(id).catch(() => {});
      },
      message(ws, message) {
        const id = ws.data.deviceAuth!.id;
        const text = typeof message === "string" ? message : JSON.stringify(message);
        // A keep-alive from the app: remembered as the last time this computer was seen.
        if (text === "ping") return void devices.touch(id).catch(() => {});
        hub.receive(id, text);
      },
      close(ws) {
        const socket = (ws.data as { socket?: { send(d: string): void; close(): void } }).socket;
        if (socket) hub.detach(ws.data.deviceAuth!.id, socket);
      },
    });
  return routes as unknown as Elysia;
}
