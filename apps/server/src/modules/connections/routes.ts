import { MAIL_KEY_CONNECTION_PROVIDER, MAIL_KEY_PURPOSE } from "@zetta/core/mail-provision";
import {
  PHONE_KEY_CONNECTION_PROVIDER,
  PHONE_KEY_PURPOSE,
  PHONE_TWILIO_KEY_CONNECTION_PROVIDER,
  PHONE_TWILIO_KEY_PURPOSE,
} from "@zetta/core/phone";
import { COMPATIBLE_PROVIDER } from "@zetta/core/model-server";
import { WAHA_KEY_CONNECTION_PROVIDER, WAHA_KEY_PURPOSE } from "@zetta/core/waha";
import { SPEECH_KEY_CONNECTION_PROVIDER, SPEECH_KEY_PURPOSE } from "@zetta/core/speech";
import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { ConnectionsUnavailableError, PROVIDERS, type ConnectionsService } from "./service";

/** `plugin`, `machine`, `transcribe`, `speech`, `push` and `mailbox` connections hold secrets managed by the Plugins tab, the Computer tab, the installation settings and the mailbox routes; they are neither listed nor user-creatable here. */
const MANAGED = [
  "plugin",
  "machine",
  "transcribe",
  "speech",
  "push",
  "mailbox",
  "mailprovider",
  "phone",
  "phonetwilio",
  "waha",
];
/**
 * `compatible` (a model on the person's own server) is the person's own and is listed here, so it can be revoked, but it cannot be created
 * here: it needs an address and a model name, which only its own route takes (the address rule decides what may be saved).
 */
const NOT_CREATABLE = [...MANAGED, COMPATIBLE_PROVIDER];
const USER_PROVIDERS = PROVIDERS.filter((p) => !NOT_CREATABLE.includes(p));
import { TransportError } from "@zetta/core/sealed-transport";
import { ConnectionStoreError } from "./store-contract";
import { TransportKeyExpiredError, transportKeyring, type TransportKeyring } from "./transport";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";

export type ConnectionServices = {
  access: ReturnType<typeof createIdentityAccess>;
  connections: ConnectionsService;
  /** The speech-to-text key of the installation: where its connection is recorded (see transcribe/configured.ts). */
  transcribeKey?: { set(connectionId: string | null): Promise<void> };
  /** The text-to-speech key of the installation: where its connection is recorded (installation/speech.ts). */
  speechKey?: { set(connectionId: string | null): Promise<void> };
  /** The key of bot e-mail addresses: where its connection is recorded (mail/provider-config.ts). */
  mailKey?: { set(connectionId: string | null): Promise<void> };
  /** The key of the phone provider: where its connection is recorded (phone/config.ts). */
  phoneKey?: { set(connectionId: string | null): Promise<void> };
  /** The Auth Token of the Twilio account: where its connection is recorded. */
  phoneTwilioKey?: { set(connectionId: string | null): Promise<void> };
  /** The key of the shared WhatsApp server (WAHA): where its connection is recorded. */
  wahaKey?: { set(connectionId: string | null): Promise<void> };
};
const uuid = z.string().uuid();
const key = z.string().regex(/^[a-z0-9_-]{1,32}$/);

export function createConnectionRoutes(
  {
    access,
    connections,
    transcribeKey,
    speechKey,
    mailKey,
    phoneKey,
    phoneTwilioKey,
    wahaKey,
  }: ConnectionServices,
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
      // The speech-to-text key of the whole installation (voice notes of outside people use it too): an administrator only. The secret
      // arrives sealed like any other and is stored as a connection of the administrator; the installation settings point to it.
      .put(
        "/connections/transcribe-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !transcribeKey) throw new AccessError("ACCESS_DENIED");
          const { sealed } = z.strictObject({ sealed: z.unknown() }).parse(c.body);
          const { secret } = z.strictObject({ secret: z.string().min(8).max(8000) }).parse(
            await keyring.open(sealed, {
              userId: c.userId,
              purpose: "installation.transcribe-key",
            }),
          );
          const made = await connections.create(c.actor, {
            provider: "transcribe",
            label: "Speech to text",
            secret,
          });
          await transcribeKey.set(made.id);
          return { ok: true };
        }),
      )
      .delete(
        "/connections/transcribe-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !transcribeKey) throw new AccessError("ACCESS_DENIED");
          await transcribeKey.set(null);
          return { ok: true };
        }),
      )
      // The text-to-speech key of the installation: the same, for the speech provider the administrator chose.
      .put(
        "/connections/speech-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !speechKey) throw new AccessError("ACCESS_DENIED");
          const { sealed } = z.strictObject({ sealed: z.unknown() }).parse(c.body);
          const { secret } = z
            .strictObject({ secret: z.string().min(8).max(8000) })
            .parse(await keyring.open(sealed, { userId: c.userId, purpose: SPEECH_KEY_PURPOSE }));
          const made = await connections.create(c.actor, {
            provider: SPEECH_KEY_CONNECTION_PROVIDER,
            label: "Text to speech",
            secret,
          });
          await speechKey.set(made.id);
          return { ok: true };
        }),
      )
      .delete(
        "/connections/speech-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !speechKey) throw new AccessError("ACCESS_DENIED");
          await speechKey.set(null);
          return { ok: true };
        }),
      )
      // The key of bot e-mail addresses: the same, for the mail provider the administrator chose.
      .put(
        "/connections/mail-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !mailKey) throw new AccessError("ACCESS_DENIED");
          const { sealed } = z.strictObject({ sealed: z.unknown() }).parse(c.body);
          const { secret } = z
            .strictObject({ secret: z.string().min(8).max(8000) })
            .parse(await keyring.open(sealed, { userId: c.userId, purpose: MAIL_KEY_PURPOSE }));
          const made = await connections.create(c.actor, {
            provider: MAIL_KEY_CONNECTION_PROVIDER,
            label: "Bot e-mail addresses",
            secret,
          });
          await mailKey.set(made.id);
          return { ok: true };
        }),
      )
      .delete(
        "/connections/mail-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !mailKey) throw new AccessError("ACCESS_DENIED");
          await mailKey.set(null);
          return { ok: true };
        }),
      )
      // The key of the phone provider (numbers and calls for bots): the same, administrator only.
      .put(
        "/connections/phone-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !phoneKey) throw new AccessError("ACCESS_DENIED");
          const { sealed } = z.strictObject({ sealed: z.unknown() }).parse(c.body);
          const { secret } = z
            .strictObject({ secret: z.string().min(8).max(8000) })
            .parse(await keyring.open(sealed, { userId: c.userId, purpose: PHONE_KEY_PURPOSE }));
          const made = await connections.create(c.actor, {
            provider: PHONE_KEY_CONNECTION_PROVIDER,
            label: "Phone numbers",
            secret,
          });
          await phoneKey.set(made.id);
          return { ok: true };
        }),
      )
      .delete(
        "/connections/phone-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !phoneKey) throw new AccessError("ACCESS_DENIED");
          await phoneKey.set(null);
          return { ok: true };
        }),
      )
      // The Auth Token of the Twilio account: the same, with its own connection so Telnyx and Twilio can both be set up.
      .put(
        "/connections/phone-twilio-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !phoneTwilioKey) throw new AccessError("ACCESS_DENIED");
          const { sealed } = z.strictObject({ sealed: z.unknown() }).parse(c.body);
          const { secret } = z
            .strictObject({ secret: z.string().min(8).max(8000) })
            .parse(
              await keyring.open(sealed, { userId: c.userId, purpose: PHONE_TWILIO_KEY_PURPOSE }),
            );
          const made = await connections.create(c.actor, {
            provider: PHONE_TWILIO_KEY_CONNECTION_PROVIDER,
            label: "Phone numbers (Twilio)",
            secret,
          });
          await phoneTwilioKey.set(made.id);
          return { ok: true };
        }),
      )
      .delete(
        "/connections/phone-twilio-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !phoneTwilioKey) throw new AccessError("ACCESS_DENIED");
          await phoneTwilioKey.set(null);
          return { ok: true };
        }),
      )
      // The key of the WhatsApp server every person shares: the same, administrator only. Sealed in the browser, never returned.
      .put(
        "/connections/waha-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !wahaKey) throw new AccessError("ACCESS_DENIED");
          const { sealed } = z.strictObject({ sealed: z.unknown() }).parse(c.body);
          const { secret } = z
            .strictObject({ secret: z.string().min(1).max(8000) })
            .parse(await keyring.open(sealed, { userId: c.userId, purpose: WAHA_KEY_PURPOSE }));
          const made = await connections.create(c.actor, {
            provider: WAHA_KEY_CONNECTION_PROVIDER,
            label: "WhatsApp server",
            secret,
          });
          await wahaKey.set(made.id);
          return { ok: true };
        }),
      )
      .delete(
        "/connections/waha-key",
        g(async (c) => {
          if (!c.actor.isAdmin || !wahaKey) throw new AccessError("ACCESS_DENIED");
          await wahaKey.set(null);
          return { ok: true };
        }),
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
