import { Elysia } from "elysia";
import { z } from "zod";
import { skillName } from "../bot-claude/profile";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { DiscussionError, publicRoom, type DiscussionStore } from "./store";
import type { DiscussionWorker } from "./worker";

export type DiscussionServices = {
  access: ReturnType<typeof createIdentityAccess>;
  store: DiscussionStore;
  worker: DiscussionWorker;
};
const uuid = z.string().uuid();
const schemas = {
  create: z.strictObject({
    title: z.string().trim().min(1).max(120),
    goal: z.string().trim().max(1000).default(""),
    context: z.string().max(8000).default(""),
    members: z
      .array(z.strictObject({ bot: uuid, role: z.string().trim().max(200).optional() }))
      .min(1),
    /** Optional: without it the room opens with its goal (or title), so the bots have something to start on. */
    firstMessage: z.string().trim().min(1).max(4000).optional(),
    /** Rooms have no turn limit; older clients still send this, so it is accepted and ignored. */
    turnBudget: z.number().int().min(1).max(50).optional(),
  }),
  update: z.strictObject({
    expectedVersion: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(120).optional(),
    goal: z.string().max(1000).optional(),
    context: z.string().max(8000).optional(),
  }),
  post: z
    .strictObject({
      content: z.string().trim().max(4000),
      attachmentIds: z.array(uuid).max(5).optional(),
      fileRefs: z.array(z.string().min(1).max(300)).max(5).optional(),
      wikiIds: z.array(uuid).max(5).optional(),
      skills: z
        .array(z.strictObject({ botId: uuid, name: skillName }))
        .max(5)
        .optional(),
    })
    .refine((v) => v.content || v.attachmentIds?.length || v.fileRefs?.length),
  loop: z.strictObject({
    goal: z.string().trim().max(500).default(""),
    doneWhen: z.string().trim().min(1).max(300),
  }),
  resolve: z.strictObject({ summary: z.string().trim().min(1).max(2000) }),
  member: z.strictObject({ requireApproval: z.boolean() }),
  peers: z.strictObject({ peerBotIds: z.array(uuid).max(20) }),
  status: z.enum(["open", "paused", "stalled", "resolved", "cancelled"]).optional(),
};
const out = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) =>
  out({ error: { code, message } }, status);
const STATUS: Record<DiscussionError["code"], number> = {
  INVALID: 400,
  LIMIT: 409,
  NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CLOSED: 409,
};

export function createDiscussionRoutes(
  { access, store }: DiscussionServices,
  trustedOrigins: readonly string[],
) {
  type Ctx = {
    actor: Awaited<ReturnType<typeof access.requireActive>>;
    body: unknown;
    params: Record<string, string>;
    query: Record<string, string | undefined>;
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
    if (e instanceof DiscussionError) return fail(STATUS[e.code], e.code, e.safe);
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
      query,
    }: {
      request: Request;
      body: unknown;
      params: Record<string, string>;
      query: Record<string, string | undefined>;
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
          await work({ actor: await access.requireActive(request.headers), body, params, query }),
          status,
        );
      } catch (e) {
        return mapError(e);
      }
    };
  const id = (c: Ctx) => uuid.parse(c.params.id);
  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/discussions",
      g(async (c) => ({
        discussions: await store.list(c.actor, schemas.status.parse(c.query.status || undefined)),
      })),
    )
    .get(
      "/discussions/running",
      g(async (c) => ({ running: await store.countRunning(c.actor) })),
    )
    .post(
      "/discussions",
      g(async (c) => {
        const { turnBudget: _ignored, ...v } = schemas.create.parse(c.body);
        const r = await store.open(c.actor, {
          ...v,
          firstMessage: v.firstMessage ?? (v.goal || v.title),
          createdBy: null,
          tainted: false,
        });
        return { discussion: publicRoom(r.discussion), created: r.created };
      }, 201),
    )
    .get(
      "/discussions/:id",
      g(async (c) => store.get(c.actor, id(c))),
    )
    .get(
      "/discussions/:id/steps",
      g(async (c) => store.steps(c.actor, id(c))),
    )
    .post(
      "/discussions/:id/loop",
      g(
        async (c) => ({ loop: await store.startLoop(c.actor, id(c), schemas.loop.parse(c.body)) }),
        201,
      ),
    )
    .patch(
      "/discussions/:id",
      g(async (c) => {
        const { expectedVersion, ...v } = schemas.update.parse(c.body);
        return {
          discussion: publicRoom(await store.updateContext(c.actor, id(c), v, expectedVersion)),
        };
      }),
    )
    .post(
      "/discussions/:id/messages",
      g(async (c) => {
        const v = schemas.post.parse(c.body);
        return { message: await store.postAsOwner(c.actor, id(c), v.content, v) };
      }, 201),
    )
    .post(
      "/discussions/:id/pause",
      g(async (c) => ({
        discussion: publicRoom(await store.setStatus(c.actor, id(c), "pause")),
      })),
    )
    .post(
      "/discussions/:id/resume",
      g(async (c) => ({
        discussion: publicRoom(await store.setStatus(c.actor, id(c), "resume")),
      })),
    )
    .post(
      "/discussions/:id/cancel",
      g(async (c) => ({
        discussion: publicRoom(await store.setStatus(c.actor, id(c), "cancel")),
      })),
    )
    .post(
      "/discussions/:id/delete",
      g(async (c) => ({
        discussion: publicRoom((await store.remove(c.actor, id(c), null)).discussion),
      })),
    )
    .post(
      "/discussions/:id/seen",
      g(async (c) => {
        await store.markSeen(c.actor, id(c));
        return { ok: true };
      }),
    )
    .post(
      "/discussions/:id/resolve",
      g(async (c) => ({
        discussion: publicRoom(
          await store.resolve(c.actor, id(c), null, schemas.resolve.parse(c.body).summary),
        ),
      })),
    )
    .put(
      "/discussions/:id/members/:botId",
      g(async (c) => ({
        member: await store.setRequireApproval(
          c.actor,
          id(c),
          uuid.parse(c.params.botId),
          schemas.member.parse(c.body).requireApproval,
        ),
      })),
    )
    .get(
      "/bots/:id/peers",
      g(async (c) => ({ peers: await store.peers(c.actor, id(c)) })),
    )
    .put(
      "/bots/:id/peers",
      g(async (c) => {
        await store.setPeers(c.actor, id(c), schemas.peers.parse(c.body).peerBotIds);
        return { peers: await store.peers(c.actor, id(c)) };
      }),
    );
}
