import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { HookError, isReactionEmoji, type FeaturesService } from "./service";
import { RoutineError } from "./routines";
import { SnapshotError } from "./snapshots";
import { WorkflowError } from "./workflows";

export type FeatureServices = {
  access: ReturnType<typeof createIdentityAccess>;
  features: FeaturesService;
};
const uuid = z.string().uuid();
const text = (n: number) => z.string().trim().min(1).max(n);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const counter = z.number().int().positive();
const schedule = {
  timezone: text(64),
  dailyAt: hhmm.optional(),
  everyMinutes: z.number().int().min(5).max(10080).optional(),
  onceAt: z.string().datetime().optional(),
};
const schemas = {
  hook: z.strictObject({
    kind: z.enum(["add_context", "redact", "stop", "background"]),
    pattern: z.string().max(100).optional(),
    value: z.string().max(4000).optional(),
  }),
  hookUpdate: z.strictObject({
    pattern: z.string().max(100).optional(),
    value: z.string().max(4000).optional(),
    enabled: z.boolean().optional(),
    position: z.number().int().min(0).max(100).optional(),
  }),
  routine: z.strictObject({
    botId: uuid,
    title: text(120),
    prompt: text(8000),
    ...schedule,
    conversationMode: z.enum(["new", "continue"]).optional(),
    workflowId: uuid.optional(),
  }),
  routineUpdate: z.strictObject({
    expectedVersion: counter,
    botId: uuid.optional(),
    title: text(120).optional(),
    prompt: text(8000).optional(),
    timezone: text(64).optional(),
    dailyAt: hhmm.optional(),
    everyMinutes: schedule.everyMinutes,
    onceAt: z.string().datetime().optional(),
    workflowId: uuid.optional(),
    conversationMode: z.enum(["new", "continue"]).optional(),
  }),
  routinePreview: z.strictObject({
    ...schedule,
    count: z.number().int().min(1).max(10).optional(),
  }),
  calendar: z.strictObject({ from: z.string().datetime(), to: z.string().datetime() }),
  routineRead: z.strictObject({ conversationId: uuid }),
  paused: z.strictObject({ paused: z.boolean() }),
  runNow: z.strictObject({ requestKey: z.string().min(8).max(100) }),
  attention: z.strictObject({
    title: text(160),
    detail: z.string().max(4000).optional(),
    nextAction: z.string().max(500).optional(),
    botId: uuid.optional(),
  }),
  attentionAction: z.strictObject({
    action: z.enum(["read", "acknowledge", "resolve", "cancel", "reopen"]),
  }),
  attentionStatus: z.strictObject({ status: z.enum(["open", "acknowledged", "resolved"]) }),
  workflow: z.strictObject({
    id: uuid.optional(),
    name: text(120),
    graph: z.unknown(),
    expectedVersion: counter.optional(),
  }),
  validate: z.strictObject({ graph: z.unknown() }),
  run: z.strictObject({
    input: z.string().max(8000).default(""),
    requestKey: z.string().min(8).max(100).optional(),
  }),
  snapshotPreview: z.strictObject({ conversationId: uuid }),
  snapshot: z.strictObject({
    conversationId: uuid,
    previewHash: z.string().length(64),
    requestKey: z.string().min(8).max(100).optional(),
  }),
  reaction: z.strictObject({ emoji: z.string().refine(isReactionEmoji, "Not an emoji") }),
};
const out = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string, extra: object = {}) =>
  out({ error: { code, message, ...extra } }, status);

export function createFeatureRoutes(
  { access, features: f }: FeatureServices,
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
    if (e instanceof RoutineError)
      return e.code === "NOT_READY"
        ? fail(409, "NOT_READY", "Finish the missing steps before activating this.", {
            missing: e.missing,
          })
        : e.code === "CONFLICT"
          ? fail(409, "STALE_VERSION", "This routine changed. Reload and try again.")
          : fail(400, "INVALID", "Check the schedule and try again.");
    if (e instanceof WorkflowError)
      return e.code === "CONFLICT"
        ? fail(409, "STALE_VERSION", "This workflow changed. Reload and try again.")
        : e.code === "BOT_NOT_READY"
          ? fail(
              409,
              "BOT_NOT_READY",
              `${e.detail ?? "A bot"} is not ready yet. Finish its setup first.`,
            )
          : fail(400, "INVALID_WORKFLOW", e.detail ?? "The workflow is not valid.");
    if (e instanceof HookError)
      return fail(
        400,
        e.code,
        e.code === "LIMIT"
          ? "At most 20 hooks per bot."
          : "That pattern is invalid or too complex.",
      );
    if (e instanceof SnapshotError)
      return fail(
        e.code === "UNSAFE" ? 422 : 409,
        e.code,
        e.code === "EMPTY"
          ? "There is nothing to publish yet."
          : e.code === "UNSAFE"
            ? (e.detail ?? "This chat cannot be published safely.")
            : "The conversation changed since the preview. Review it again.",
      );
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
      "/messages/:id/knowledge",
      g(async (c) => f.usedKnowledge(c.actor, id(c))),
    )
    .get(
      "/bots/:id/hooks",
      g(async (c) => ({ hooks: await f.listHooks(c.actor, id(c)) })),
    )
    .post(
      "/bots/:id/hooks",
      g(async (c) => ({ hook: await f.addHook(c.actor, id(c), schemas.hook.parse(c.body)) }), 201),
    )
    .post(
      "/bots/:id/hooks/dry-run",
      g(async (c) => ({
        result: await f.dryRunHooks(
          c.actor,
          id(c),
          z.strictObject({ text: z.string().max(20000) }).parse(c.body).text,
        ),
      })),
    )
    .patch(
      "/hooks/:id",
      g(async (c) => ({
        hook: await f.updateHook(c.actor, id(c), schemas.hookUpdate.parse(c.body)),
      })),
    )
    .delete(
      "/hooks/:id",
      g(async (c) => ({ hook: await f.deleteHook(c.actor, id(c)) })),
    )
    .get(
      "/routines",
      g(async ({ actor, query }) => ({
        routines: await f.routines.list(actor, query.state === "active" ? "active" : "all"),
      })),
    )
    .post(
      "/routines",
      g(
        async (c) => ({ routine: await f.routines.create(c.actor, schemas.routine.parse(c.body)) }),
        201,
      ),
    )
    .post(
      "/routines/calendar",
      g(async (c) => {
        const v = schemas.calendar.parse(c.body);
        return f.routines.calendar(c.actor, new Date(v.from), new Date(v.to));
      }),
    )
    .post(
      "/routines/timeline",
      g(async (c) => {
        const v = schemas.calendar.parse(c.body);
        return f.routines.timeline(c.actor, new Date(v.from), new Date(v.to));
      }),
    )
    .get(
      "/routines/unread",
      g(async ({ actor }) => f.routines.unread(actor)),
    )
    .post(
      "/routines/read",
      g(async (c) => {
        await f.routines.markRead(c.actor, schemas.routineRead.parse(c.body).conversationId);
        return { ok: true };
      }),
    )
    .post(
      "/routines/preview",
      g(async (c) => {
        const v = schemas.routinePreview.parse(c.body);
        const { count, ...rest } = v;
        return { nextRuns: f.routines.preview(c.actor, rest, count) };
      }),
    )
    .patch(
      "/routines/:id",
      g(async (c) => {
        const { expectedVersion, ...v } = schemas.routineUpdate.parse(c.body);
        return { routine: await f.routines.update(c.actor, id(c), expectedVersion, v) };
      }),
    )
    .get(
      "/routines/:id/summary",
      g(async (c) => ({ summary: await f.routines.summary(c.actor, id(c)) })),
    )
    .post(
      "/routines/:id/paused",
      g(async (c) => ({
        routine: await f.routines.setPaused(c.actor, id(c), schemas.paused.parse(c.body).paused),
      })),
    )
    .post(
      "/routines/:id/run",
      g(async (c) => ({
        run: await f.routines.runNow(c.actor, id(c), schemas.runNow.parse(c.body).requestKey),
      })),
    )
    .get(
      "/routines/:id/runs",
      g(async (c) => f.routines.runs(c.actor, id(c), { before: c.query.before })),
    )
    .delete(
      "/routines/:id",
      g(async (c) => ({ routine: await f.routines.remove(c.actor, id(c)) })),
    )
    .get(
      "/activity",
      g(async (c) => ({
        ...(await f.activity(c.actor, {
          before: c.query.before,
          kind: c.query.kind as never,
          limit: Math.min(Math.max(Number(c.query.limit) || 50, 1), 100),
        })),
      })),
    )
    .get(
      "/attention",
      g(async ({ actor }) => ({ items: await f.listAttention(actor) })),
    )
    .get(
      "/attention/summary",
      g(async ({ actor }) => ({ summary: await f.attentionSummary(actor) })),
    )
    .post(
      "/attention",
      g(
        async (c) => ({ item: await f.addAttention(c.actor, schemas.attention.parse(c.body)) }),
        201,
      ),
    )
    .post(
      "/attention/:id/action",
      g(async (c) => ({
        item: await f.attentionAction(c.actor, id(c), schemas.attentionAction.parse(c.body).action),
      })),
    )
    .post(
      "/attention/:id/status",
      g(async (c) => {
        const s = schemas.attentionStatus.parse(c.body).status;
        return {
          item: await f.attentionAction(
            c.actor,
            id(c),
            s === "open" ? "reopen" : s === "acknowledged" ? "acknowledge" : "resolve",
          ),
        };
      }),
    )
    .get(
      "/workflows",
      g(async ({ actor }) => ({ workflows: await f.workflows.list(actor) })),
    )
    .get(
      "/workflows/:id",
      g(async (c) => ({ workflow: await f.workflows.get(c.actor, id(c)) })),
    )
    .post(
      "/workflows/validate",
      g(async (c) => f.workflows.validate(schemas.validate.parse(c.body).graph)),
    )
    .post(
      "/workflows",
      g(
        async (c) => ({
          workflow: await f.workflows.save(c.actor, schemas.workflow.parse(c.body)),
        }),
        201,
      ),
    )
    .post(
      "/workflows/:id/run",
      g(async (c) => {
        const v = schemas.run.parse(c.body ?? {});
        return f.workflows.run(c.actor, id(c), v.input, v.requestKey);
      }),
    )
    .get(
      "/workflows/:id/runs",
      g(async (c) => ({ runs: await f.workflows.runs(c.actor, id(c)) })),
    )
    .get(
      "/conversations/:id/delegations",
      g(async (c) => ({ delegations: await f.delegations(c.actor, id(c)) })),
    )
    .get(
      "/snapshots",
      g(async () => ({ snapshots: await f.snapshots.list() })),
    )
    .post(
      "/snapshots/preview",
      g(async (c) => ({
        preview: await f.snapshots.preview(
          c.actor,
          schemas.snapshotPreview.parse(c.body).conversationId,
        ),
      })),
    )
    .post(
      "/snapshots",
      g(
        async (c) => ({
          snapshot: await f.snapshots.publish(c.actor, schemas.snapshot.parse(c.body)),
        }),
        201,
      ),
    )
    .get(
      "/snapshots/:id",
      g(async (c) => ({ snapshot: await f.snapshots.get(c.actor.userId, id(c)) })),
    )
    .delete(
      "/snapshots/:id",
      g(async (c) => ({ snapshot: await f.snapshots.revoke(c.actor, id(c)) })),
    )
    .post(
      "/messages/:id/reactions",
      g(
        async (c) => ({
          reactions: await f.react(c.actor, id(c), schemas.reaction.parse(c.body).emoji),
        }),
        201,
      ),
    )
    .delete(
      "/messages/:id/reactions/:emoji",
      g(async (c) => ({
        reactions: await f.unreact(
          c.actor,
          id(c),
          z
            .string()
            .refine(isReactionEmoji, "Not an emoji")
            .parse(decodeURIComponent(c.params.emoji ?? "")),
        ),
      })),
    );
}
