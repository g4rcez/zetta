import { TEAM_ROLE_COLORS, TEAM_ROLE_ICONS } from "@zetta/db/schema/teams";
import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { DiscussionError } from "../discussions/store";
import { TeamError, type TeamStore } from "./store";

export type TeamServices = { access: ReturnType<typeof createIdentityAccess>; store: TeamStore };
const uuid = z.string().uuid();
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const box = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive(),
  h: z.number().positive(),
});
const schemas = {
  create: z.strictObject({
    name: z.string().trim().min(1).max(80),
    goal: z.string().trim().max(1000).default(""),
    canvas: box.default({ x: 0, y: 0, w: 360, h: 280 }),
  }),
  save: z.strictObject({
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    goal: z.string().trim().max(1000),
    canvas: box,
    members: z
      .array(
        z.strictObject({
          botId: uuid,
          kind: z.enum(["chief", "member"]),
          roleId: uuid.nullable().default(null),
          canvas: point,
        }),
      )
      .max(50),
  }),
  role: z.strictObject({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200).default(""),
    color: z.enum(TEAM_ROLE_COLORS).default("slate"),
    icon: z.enum(TEAM_ROLE_ICONS).default("user"),
  }),
  room: z.strictObject({
    title: z.string().trim().min(1).max(120),
    goal: z.string().trim().max(1000).default(""),
    firstMessage: z.string().trim().min(1).max(4000),
  }),
};
const out = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) =>
  out({ error: { code, message } }, status);
const TEAM_STATUS: Record<TeamError["code"], number> = {
  INVALID: 400,
  NOT_FOUND: 404,
  STALE_VERSION: 409,
  NAME_TAKEN: 409,
};
const DISCUSSION_STATUS: Record<DiscussionError["code"], number> = {
  INVALID: 400,
  LIMIT: 409,
  NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CLOSED: 409,
};

export function createTeamRoutes(
  { access, store }: TeamServices,
  trustedOrigins: readonly string[],
) {
  type Ctx = {
    actor: Awaited<ReturnType<typeof access.requireActive>>;
    body: unknown;
    params: Record<string, string>;
  };
  function mapError(e: unknown) {
    if (e instanceof AccessError)
      return fail(
        e.code === "SIGN_IN_REQUIRED"
          ? 401
          : e.code === "NOT_FOUND"
            ? 404
            : e.code === "IDENTITY_UNAVAILABLE"
              ? 503
              : 403,
        e.code,
        e.message,
      );
    if (e instanceof TeamError) return fail(TEAM_STATUS[e.code], e.code, e.safe);
    if (e instanceof DiscussionError) return fail(DISCUSSION_STATUS[e.code], e.code, e.safe);
    if (e instanceof z.ZodError)
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
        if (request.method !== "GET") {
          const origin = request.headers.get("origin");
          if (!origin || !trustedOrigins.includes(origin))
            return fail(
              403,
              "UNTRUSTED_ORIGIN",
              "Open Zetta from its trusted application and try again.",
            );
        }
        return out(
          await work({ actor: await access.requireActive(request.headers), body, params }),
          status,
        );
      } catch (e) {
        return mapError(e);
      }
    };
  const id = (c: Ctx) => uuid.parse(c.params.id);
  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/team-roles",
      g(async (c) => ({ roles: await store.roles(c.actor) })),
    )
    .post(
      "/team-roles",
      g(async (c) => ({ role: await store.createRole(c.actor, schemas.role.parse(c.body)) }), 201),
    )
    .put(
      "/team-roles/:id",
      g(async (c) => ({
        role: await store.updateRole(c.actor, id(c), schemas.role.parse(c.body)),
      })),
    )
    .delete(
      "/team-roles/:id",
      g(async (c) => {
        await store.deleteRole(c.actor, id(c));
        return { ok: true };
      }),
    )
    .get(
      "/teams",
      g(async (c) => ({ teams: await store.list(c.actor) })),
    )
    .get(
      "/teams/:id",
      g(async (c) => ({ team: await store.get(c.actor, id(c)) })),
    )
    .post(
      "/teams",
      g(async (c) => ({ team: await store.create(c.actor, schemas.create.parse(c.body)) }), 201),
    )
    .put(
      "/teams/:id",
      g(async (c) => {
        const { expectedVersion, ...v } = schemas.save.parse(c.body);
        return { team: await store.save(c.actor, id(c), expectedVersion, v) };
      }),
    )
    .delete(
      "/teams/:id",
      g(async (c) => {
        await store.archive(c.actor, id(c));
        return { ok: true };
      }),
    )
    .post(
      "/teams/:id/rooms",
      g(async (c) => store.startRoom(c.actor, id(c), schemas.room.parse(c.body)), 201),
    )
    .post(
      "/teams/:id/chat",
      g(async (c) => store.openChat(c.actor, id(c))),
    );
}
