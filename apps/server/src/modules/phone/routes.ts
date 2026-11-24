import {
  PHONE_INBOUND_MODES,
  PHONE_OUTBOUND_MODES,
  PHONE_OPTOUT_REASONS,
  PHONE_PROVIDER_IDS,
} from "@zetta/core/phone";
import { Elysia } from "elysia";
import { z } from "zod";
import { accessFail, createGuardedRoute, fail, out } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import type { PhoneCalls } from "./calls";
import { createPhoneCallRoutes } from "./call-routes";
import { PhoneError, type PhoneService } from "./service";

export type PhoneServices = {
  access: ReturnType<typeof createIdentityAccess>;
  phone: PhoneService;
  /** Incoming calls: the provider's webhook and media socket. */
  calls?: PhoneCalls;
};

const STATUS: Record<PhoneError["code"], number> = {
  NOT_OFFERED: 503,
  COUNTRY: 400,
  LIMIT: 409,
  HAVE_ONE: 409,
  NO_NUMBER: 404,
  PROVIDER: 502,
  BAD_INPUT: 400,
  WRONG_STATE: 409,
  LOCKED: 423,
  NOT_AVAILABLE: 409,
};

const uuid = z.string().uuid();
const requestBody = z.strictObject({
  country: z.string().trim().length(2),
  areaCode: z.string().trim().max(6).nullable().optional(),
  /** Telnyx or Twilio. Left out: the installation's default provider. */
  provider: z.enum(PHONE_PROVIDER_IDS).optional(),
});
const patchBody = z.strictObject({
  inbound: z.enum(PHONE_INBOUND_MODES).optional(),
  outbound: z.enum(PHONE_OUTBOUND_MODES).optional(),
  ownerNumber: z.string().trim().max(32).nullable().optional(),
});
const pinBody = z.strictObject({ pin: z.string().max(16).nullable() });
const attachBody = z.strictObject({
  botId: uuid,
  number: z.string().trim().min(1).max(32),
  provider: z.enum(PHONE_PROVIDER_IDS).optional(),
});
const reassignBody = z.strictObject({ botId: uuid });
const optoutBody = z.strictObject({
  number: z.string().trim().min(1).max(32),
  reason: z.enum(PHONE_OPTOUT_REASONS).optional(),
});

/**
 * - `GET    /api/phone/offer`: whether bots can have numbers here, how, and in which countries (signed in).
 * - `GET    /api/phone/health`: `{ok:true}`, with no sign-in. The settings card's "does the public address reach this server" test asks it.
 * - `GET|POST|PATCH|DELETE /api/bots/:id/phone`, `PUT /api/bots/:id/phone/pin`: the owner's number, request, settings and release.
 * - `GET /api/phone/numbers`, `POST /api/phone/numbers/:id/(approve|reject|release|reassign)`, `POST /api/phone/numbers/attach`, `GET /api/phone/bots`, `GET|POST|DELETE /api/phone/optouts`: administrators.
 * - `POST /api/phone/webhook` and `GET /api/phone/stream`: the provider's events and call audio (call-routes.ts).
 */
export function createPhoneRoutes(
  { access, phone, calls }: PhoneServices,
  trustedOrigins: readonly string[],
) {
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof PhoneError) return fail(STATUS[e.code], `PHONE_${e.code}`, e.safe);
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  const needAdmin = (a: { isAdmin: boolean }) => {
    if (!a.isAdmin) throw new AccessError("ACCESS_DENIED");
  };

  return new Elysia({ normalize: false })
    .get("/api/phone/health", () => out({ ok: true }))
    .get(
      "/api/phone/offer",
      g(async () => phone.offer()),
    )
    .get(
      "/api/bots/:id/phone",
      g(async (c) => ({
        number: await phone.get(c.actor, uuid.parse(c.params.id)),
        offer: await phone.offer(),
      })),
    )
    .post(
      "/api/bots/:id/phone",
      g(async (c) => ({
        number: await phone.request(c.actor, uuid.parse(c.params.id), requestBody.parse(c.body)),
      })),
    )
    .patch(
      "/api/bots/:id/phone",
      g(async (c) => ({
        number: await phone.update(c.actor, uuid.parse(c.params.id), patchBody.parse(c.body)),
      })),
    )
    .put(
      "/api/bots/:id/phone/pin",
      g(async (c) => ({
        number: await phone.setPin(c.actor, uuid.parse(c.params.id), pinBody.parse(c.body).pin),
      })),
    )
    .delete(
      "/api/bots/:id/phone",
      g(async (c) => {
        await phone.release(c.actor, uuid.parse(c.params.id));
        return { ok: true };
      }),
    )
    .get(
      "/api/phone/calls/live",
      g(async (c) => ({ calls: await phone.liveCalls(c.actor) })),
    )
    .post(
      "/api/phone/calls/:id/hangup",
      g(async (c) => {
        const ok = (await calls?.hangUp(c.actor.userId, uuid.parse(c.params.id))) ?? false;
        if (!ok) throw new PhoneError("NO_NUMBER", "That call is not running any more.");
        return { ok: true };
      }),
    )
    .get(
      "/api/phone/numbers",
      g(async (c) => {
        needAdmin(c.actor);
        return { numbers: await phone.list(c.actor) };
      }),
    )
    .post(
      "/api/phone/numbers/:id/approve",
      g(async (c) => {
        needAdmin(c.actor);
        return { number: await phone.approve(c.actor, uuid.parse(c.params.id)) };
      }),
    )
    .post(
      "/api/phone/numbers/:id/reject",
      g(async (c) => {
        needAdmin(c.actor);
        await phone.reject(c.actor, uuid.parse(c.params.id));
        return { ok: true };
      }),
    )
    .post(
      "/api/phone/numbers/attach",
      g(async (c) => {
        needAdmin(c.actor);
        return { number: await phone.attach(c.actor, attachBody.parse(c.body)) };
      }),
    )
    .post(
      "/api/phone/numbers/:id/reassign",
      g(async (c) => {
        needAdmin(c.actor);
        return {
          number: await phone.reassign(
            c.actor,
            uuid.parse(c.params.id),
            reassignBody.parse(c.body).botId,
          ),
        };
      }),
    )
    .get(
      "/api/phone/bots",
      g(async (c) => {
        needAdmin(c.actor);
        return { bots: await phone.assignableBots(c.actor) };
      }),
    )
    .post(
      "/api/phone/numbers/:id/release",
      g(async (c) => {
        needAdmin(c.actor);
        await phone.operatorRelease(c.actor, uuid.parse(c.params.id));
        return { ok: true };
      }),
    )
    .get(
      "/api/phone/optouts",
      g(async (c) => {
        needAdmin(c.actor);
        return { optouts: await phone.optouts(c.actor) };
      }),
    )
    .post(
      "/api/phone/optouts",
      g(async (c) => {
        needAdmin(c.actor);
        const b = optoutBody.parse(c.body);
        return await phone.addOptout(c.actor, b.number, b.reason);
      }),
    )
    .delete(
      "/api/phone/optouts/:id",
      g(async (c) => {
        needAdmin(c.actor);
        await phone.removeOptout(c.actor, uuid.parse(c.params.id));
        return { ok: true };
      }),
    )
    .use(calls ? createPhoneCallRoutes(calls) : new Elysia()) as unknown as Elysia;
}
