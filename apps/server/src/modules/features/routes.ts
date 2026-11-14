import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { HookError, isReactionEmoji, type FeaturesService } from "./service";
import { RoutineError } from "./routines";
import { AgentsPausedError } from "../preferences/agents-state";
import { TriggerError } from "./routine-triggers";
import { parseScheduleText } from "./schedule-text";
import { SnapshotError } from "./snapshots";
import { WorkflowError } from "./workflows";
import { accessFail, createGuardedRoute, fail } from "../http-response";

export type FeatureServices = {
  access: ReturnType<typeof createIdentityAccess>;
  features: FeaturesService;
};
const uuid = z.string().uuid();
const text = (n: number) => z.string().trim().min(1).max(n);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const counter = z.number().int().positive();
// Days a daily routine runs on: 0 = Sunday … 6 = Saturday. An empty list means every day.
const weekdays = z.array(z.number().int().min(0).max(6)).max(7);
const schedule = {
  timezone: text(64),
  dailyAt: hhmm.optional(),
  weekdays: weekdays.optional(),
  everyMinutes: z.number().int().min(5).max(10080).optional(),
  onceAt: z.string().datetime().optional(),
  /** The schedule as a person writes it ("Monday to Friday at 8:30", "every 15 minutes", a cron): read by the server instead of the fields above. */
  when: text(200).optional(),
};
const MAX_HOOK_BYTES = 64_000;
/** How a routine behaves when runs overlap, after downtime, and after failures (see routines.ts). */
const routineControls = {
  overlapPolicy: z.enum(["skip", "queue", "replace"]).optional(),
  catchUp: z.enum(["run_once", "skip"]).optional(),
  mode: z.enum(["task", "goal"]).optional(),
  maxFailures: z.number().int().min(1).max(50).optional(),
};
const schemas = {
  trigger: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("webhook") }),
    z.strictObject({ kind: z.literal("gmail"), query: text(200) }),
    z.strictObject({
      kind: z.literal("home_assistant"),
      entityId: z.string().regex(/^[a-z0-9_]{1,64}\.[a-z0-9_]{1,64}$/),
      to: z.string().trim().min(1).max(50).optional(),
    }),
  ]),
  triggerStatus: z.strictObject({ status: z.enum(["active", "paused"]) }),
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
    // "on": switched on at once when it is ready to run. Default: created paused.
    activate: z.enum(["on", "paused"]).optional(),
    ...routineControls,
  }),
  routineUpdate: z.strictObject({
    ...routineControls,
    expectedVersion: counter,
    botId: uuid.optional(),
    title: text(120).optional(),
    prompt: text(8000).optional(),
    timezone: text(64).optional(),
    dailyAt: hhmm.optional(),
    weekdays: weekdays.optional(),
    everyMinutes: schedule.everyMinutes,
    onceAt: z.string().datetime().optional(),
    when: schedule.when,
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
  // `wait: "start"` answers as soon as the run is claimed (a page must not hold a request open for a whole run); the default waits
  // for the run to finish.
  runNow: z.strictObject({
    requestKey: z.string().min(8).max(100),
    wait: z.enum(["finish", "start"]).optional(),
  }),
  attention: z.strictObject({
    title: text(160),
    detail: z.string().max(4000).optional(),
    nextAction: z.string().max(500).optional(),
    botId: uuid.optional(),
  }),
  attentionAction: z.strictObject({
    action: z.enum(["read", "acknowledge", "resolve", "cancel", "reopen"]),
  }),
  attentionList: z.object({
    category: z.enum(["decision", "fyi"]).optional(),
    state: z.enum(["live", "all"]).optional(),
    before: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
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

/** The text of a schedule could not be read: the message says what to write instead, so it goes to the person as it is. */
class ScheduleTextError extends Error {}

type WithWhen = {
  when?: string | undefined;
  timezone?: string | undefined;
  dailyAt?: string | undefined;
  weekdays?: number[] | undefined;
  everyMinutes?: number | undefined;
  onceAt?: string | undefined;
};
/**
 * A body that carries `when` has it read into the schedule fields; the rest of the body goes on unchanged. `when` and the fields are two
 * ways to say the same thing, so sending both is refused. On an update, a daily schedule always sets `weekdays` (an empty list means every
 * day), so "every day at 8" does not keep the weekday limit the routine had before.
 */
function readWhen<T extends WithWhen>(v: T, update: boolean) {
  const { when, ...rest } = v;
  if (when === undefined) return { value: rest as Omit<T, "when">, read: undefined };
  if (rest.dailyAt || rest.weekdays || rest.everyMinutes || rest.onceAt)
    throw new ScheduleTextError("Send the schedule either as text or as fields, not both.");
  if (!rest.timezone)
    throw new ScheduleTextError("Send the timezone together with the schedule text.");
  const read = parseScheduleText(when, { timezone: rest.timezone });
  if (!read.ok) throw new ScheduleTextError(read.problem);
  const days = read.schedule.dailyAt
    ? { weekdays: read.schedule.weekdays ?? (update ? [] : undefined) }
    : {};
  return { value: { ...rest, ...read.schedule, ...days } as Omit<T, "when">, read };
}

export function createFeatureRoutes(
  { access, features: f }: FeatureServices,
  trustedOrigins: readonly string[],
) {
  const runNow = (
    actor: Parameters<typeof f.routines.runNow>[0],
    routineId: string,
    v: { requestKey: string; wait?: "finish" | "start" | undefined },
  ) =>
    f.routines.runNow(actor, routineId, v.requestKey, v.wait === "start" ? "background" : "wait");
  type Ctx = {
    actor: Awaited<ReturnType<typeof access.requireActive>>;
    body: unknown;
    params: Record<string, string>;
    query: Record<string, string | undefined>;
  };
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof ScheduleTextError) return fail(400, "SCHEDULE_TEXT", e.message);
    if (e instanceof AgentsPausedError)
      return fail(409, "AGENTS_PAUSED", "Your agents are paused. Resume them to start new work.");
    if (e instanceof RoutineError)
      return e.code === "NOT_READY"
        ? fail(409, "NOT_READY", "Finish the missing steps before activating this.", {
            missing: e.missing,
          })
        : e.code === "CONFLICT"
          ? fail(409, "STALE_VERSION", "This routine changed. Reload and try again.")
          : fail(400, "INVALID", "Check the schedule and try again.");
    if (e instanceof TriggerError)
      return e.code === "LIMIT"
        ? fail(409, "TRIGGER_LIMIT", "A routine can have at most 5 triggers.")
        : fail(409, "TRIGGER_UNAVAILABLE", e.safe || "The connection could not be checked.");
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
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  const id = (c: Ctx) => uuid.parse(c.params.id);
  return (
    new Elysia({ prefix: "/api", normalize: false })
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
        g(
          async (c) => ({ hook: await f.addHook(c.actor, id(c), schemas.hook.parse(c.body)) }),
          201,
        ),
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
          async (c) => ({
            routine: await f.routines.create(
              c.actor,
              readWhen(schemas.routine.parse(c.body), false).value as never,
            ),
          }),
          201,
        ),
      )
      // A call from outside (curl, n8n, a cron job). No session and no origin: the trigger's secret is the proof. Everything before the secret is
      // proven gets the same 401, so the route does not tell whether a trigger exists. The body is the event, up to 64 KB, as JSON or plain text.
      .post(
        "/routines/hook/:id",
        async ({ request, params }) => {
          const bearer = /^Bearer (\S{20,200})$/.exec(
            request.headers.get("authorization") ?? "",
          )?.[1];
          if (!bearer || !uuid.safeParse(params.id).success)
            return fail(401, "UNAUTHORIZED", "Not allowed.");
          if (Number(request.headers.get("content-length") ?? 0) > MAX_HOOK_BYTES)
            return fail(413, "TOO_LARGE", "The request is too large.");
          const raw = await request.text();
          if (raw.length > MAX_HOOK_BYTES)
            return fail(413, "TOO_LARGE", "The request is too large.");
          const body = (() => {
            try {
              return raw ? JSON.parse(raw) : null;
            } catch {
              return raw;
            }
          })();
          const key = request.headers.get("idempotency-key")?.trim().slice(0, 128) || null;
          const verdict = await f.routineTriggers.receive(params.id, bearer, key, body);
          if (verdict.status === "invalid") return fail(401, "UNAUTHORIZED", "Not allowed.");
          if (verdict.status === "limited")
            return fail(429, "RATE_LIMITED", "Too many runs this hour. Try again later.");
          if (verdict.status === "off") return fail(409, "ROUTINE_OFF", "This routine is paused.");
          if (verdict.status === "paused")
            return fail(
              409,
              "AGENTS_PAUSED",
              "The owner paused their agents. Call again after they resume.",
            );
          return new Response(JSON.stringify({ runId: verdict.run.id, replay: verdict.replay }), {
            status: verdict.replay ? 200 : 202,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        },
        { parse: "none" },
      )
      .get(
        "/routines/:id/triggers",
        g(async (c) => ({ triggers: await f.routineTriggers.list(c.actor, id(c)) })),
      )
      .post(
        "/routines/:id/triggers",
        g(
          async (c) => f.routineTriggers.create(c.actor, id(c), schemas.trigger.parse(c.body)),
          201,
        ),
      )
      .put(
        "/routines/:id/triggers/:triggerId",
        g(async (c) => ({
          trigger: await f.routineTriggers.setStatus(
            c.actor,
            id(c),
            uuid.parse(c.params.triggerId),
            schemas.triggerStatus.parse(c.body).status,
          ),
        })),
      )
      .post(
        "/routines/:id/triggers/:triggerId/rotate",
        g(async (c) => f.routineTriggers.rotate(c.actor, id(c), uuid.parse(c.params.triggerId))),
      )
      .delete(
        "/routines/:id/triggers/:triggerId",
        g(async (c) => {
          await f.routineTriggers.remove(c.actor, id(c), uuid.parse(c.params.triggerId));
          return { ok: true };
        }),
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
          const { count, ...body } = schemas.routinePreview.parse(c.body);
          const { value, read } = readWhen(body, false);
          return {
            nextRuns: f.routines.preview(c.actor, value as never, count),
            // What the text was understood as, so the form can show it before anything is saved.
            ...(read?.ok ? { understood: read.understood, assumed: read.assumed } : {}),
          };
        }),
      )
      .patch(
        "/routines/:id",
        g(async (c) => {
          const { expectedVersion, ...body } = schemas.routineUpdate.parse(c.body);
          return {
            routine: await f.routines.update(
              c.actor,
              id(c),
              expectedVersion,
              readWhen(body, true).value as never,
            ),
          };
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
        "/routines/:id/skip-next",
        g(async (c) => ({ routine: await f.routines.skipNext(c.actor, id(c)) })),
      )
      .delete(
        "/routines/:id/skip-next",
        g(async (c) => ({ routine: await f.routines.unskip(c.actor, id(c)) })),
      )
      .post(
        "/routine-runs/:id/stop",
        g(async (c) => ({ run: await f.routines.stopRun(c.actor, id(c)) })),
      )
      .post(
        "/routines/:id/run",
        g(async (c) => ({
          run: await runNow(c.actor, id(c), schemas.runNow.parse(c.body)),
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
        g(async ({ actor, query }) => ({
          items: await f.listAttention(actor, schemas.attentionList.parse(query)),
        })),
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
          item: await f.attentionAction(
            c.actor,
            id(c),
            schemas.attentionAction.parse(c.body).action,
          ),
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
      )
  );
}
