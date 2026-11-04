import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { ConnectionsUnavailableError, PROVIDERS, type ConnectionsService } from "./service";

/** `plugin` and `machine` connections hold secrets managed by the Plugins tab and the Computer tab; they are neither listed nor user-creatable here. */
const MANAGED = ["plugin", "machine"];
const USER_PROVIDERS = PROVIDERS.filter((p) => !MANAGED.includes(p));
import { TransportError } from "@zetta/core/sealed-transport";
import { ConnectionStoreError } from "./store-contract";
import { TransportKeyExpiredError, transportKeyring, type TransportKeyring } from "./transport";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";

export type ConnectionServices = {
  access: ReturnType<typeof createIdentityAccess>;
  connections: ConnectionsService;
};
const uuid = z.string().uuid();
const key = z.string().regex(/^[a-z0-9_-]{1,32}$/);

export function createConnectionRoutes(
  { access, connections }: ConnectionServices,
  trustedOrigins: readonly string[],
  keyring: TransportKeyring = transportKeyring,
) {
  type Ctx = {
    userId: string;
    actor: Awaited<ReturnType<typeof access.requireActive>>;
    body: unknown;
    params: Record<string, string>;
  };
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof ConnectionsUnavailableError)
      return fail(
        503,
        "CONNECTIONS_NOT_CONFIGURED",
        "Connections are not configured on this server. The administrator must set ZETTA_CONNECTION_KEY.",
      );
    if (e instanceof ConnectionStoreError)
      return e.code === "conflict"
        ? fail(409, "STALE_VERSION", "This connection changed. Reload and try again.")
        : e.code === "not-found"
          ? fail(404, "NOT_FOUND", "Resource not found.")
          : e.code === "invalid-input"
            ? fail(400, "INVALID_REQUEST", "Check the details and try again.")
            : fail(503, "CONNECTIONS_UNAVAILABLE", "Connections are unavailable right now.");
    if (e instanceof TransportKeyExpiredError)
      return fail(409, "TRANSPORT_KEY_EXPIRED", "The encryption key rotated. Try again.");
    if (e instanceof z.ZodError || e instanceof TransportError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g =
    (work: (c: Ctx) => Promise<unknown>, status = 200) =>
    async ({
      request,
      body,
      params,
    }: {
      request: Request;
      body: unknown;
      params: Record<string, string>;
    }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        const actor = await access.requireActive(request.headers);
        return out(await work({ userId: actor.userId, actor, body, params }), status);
      } catch (e) {
        return mapError(e);
      }
    };
  return (
    new Elysia({ prefix: "/api", normalize: false })
      .get(
        "/connections",
        g(async (c) => ({
          configured: connections.configured(),
          providers: USER_PROVIDERS,
          connections: connections.configured()
            ? (await connections.list(c.actor)).filter((x) => !MANAGED.includes(x.provider))
            : [],
        })),
      )
      // `userId` and `serverTime` let the client bind and stamp the payload without trusting its own session cache or clock.
      .get(
        "/connections/transport-key",
        g(async (c) => ({
          ...(await keyring.publicKey()),
          userId: c.userId,
          serverTime: Date.now(),
        })),
      )
      // The secret arrives sealed to the server key (see @zetta/core/sealed-transport); a plaintext `secret` fails the strict schema.
      .post(
        "/connections",
        g(async (c) => {
          const { provider, label, sealed } = z
            .strictObject({
              provider: z.enum(USER_PROVIDERS as [string, ...string[]]),
              label: z.string().trim().min(1).max(100),
              sealed: z.unknown(),
            })
            .parse(c.body);
          const { secret } = z.strictObject({ secret: z.string().min(8).max(8000) }).parse(
            await keyring.open(sealed, {
              userId: c.userId,
              purpose: `connection.create:${provider}`,
            }),
          );
          return { connection: await connections.create(c.actor, { provider, label, secret }) };
        }, 201),
      )
      .post(
        "/connections/:id/revoke",
        g(async (c) => ({
          connection: await connections.revoke(
            c.actor,
            uuid.parse(c.params.id),
            z.strictObject({ expectedRevision: z.number().int().positive() }).parse(c.body)
              .expectedRevision,
          ),
        })),
      )
      .get(
        "/bots/:id/connections",
        g(async (c) => ({
          requirements: await connections.status(c.actor, uuid.parse(c.params.id)),
        })),
      )
      .put(
        "/bots/:id/connections/:key",
        g(async (c) => ({
          binding: await connections.bind(
            c.actor,
            uuid.parse(c.params.id),
            key.parse(c.params.key),
            z.strictObject({ connectionId: uuid }).parse(c.body).connectionId,
          ),
        })),
      )
      .delete(
        "/bots/:id/connections/:key",
        g(async (c) => ({
          binding: await connections.unbind(
            c.actor,
            uuid.parse(c.params.id),
            key.parse(c.params.key),
          ),
        })),
      )
  );
}
