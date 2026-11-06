import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Database } from "@zetta/db";
import { and, asc, eq, gt, lte, sql } from "@zetta/db/query";
import { routine, routineRun, routineTrigger } from "@zetta/db/schema/features";
import { AccessError, type ActiveActor } from "../identity/access";
import { PluginError } from "../integrations/plugins/registry";
import { raiseAttention } from "./attention";
import { agentsPaused } from "../preferences/agents-state";
import type { Pollers } from "./routine-pollers";
import { uuidv7 } from "@zetta/core/uuid";

type Trigger = typeof routineTrigger.$inferSelect;
export type TriggerInput =
  | { kind: "webhook" }
  | { kind: "gmail"; query: string }
  | { kind: "home_assistant"; entityId: string; to?: string | undefined };

/** What a person sees of a trigger. Never the secret hash or the poll cursor. */
export type TriggerView = {
  id: string;
  routineId: string;
  kind: Trigger["kind"];
  filter: unknown;
  status: Trigger["status"];
  statusReason: string | null;
  createdAt: Date;
};
const view = (t: Trigger): TriggerView => ({
  id: t.id,
  routineId: t.routineId,
  kind: t.kind,
  filter: t.filter,
  status: t.status,
  statusReason: t.statusReason,
  createdAt: t.createdAt,
});

export class TriggerError extends Error {
  /** `UNAVAILABLE`: the first poll failed (plugin not connected, bad query or entity). `safe` says why. */
  constructor(
    readonly code: "LIMIT" | "UNAVAILABLE",
    readonly safe = "",
  ) {
    super(code);
  }
}

/** What the owner may read about a failed poll: a plugin error's own plain text and fix (never its code or a raw error), else a generic line. */
const why = (e: unknown) =>
  (e instanceof PluginError ? [e.safe, e.fix].filter(Boolean).join(" ") : "") ||
  "The poll failed. Check the plugin connection.";

/** Most triggers on one routine, and most runs one trigger may start in an hour. */
export const MAX_TRIGGERS = 5;
export const MAX_RUNS_PER_HOUR = 30;
/** How long to wait before polling a kind again, and how many polls in a row may fail before the trigger is marked `failing`. */
const POLL_EVERY_MS = { gmail: 60_000, home_assistant: 30_000 } as const;
const MAX_FAILURES = 5;
/** A poll that crashes midway is tried again after this. */
const LEASE_MS = 120_000;

const hash = (secret: string) => createHash("sha256").update(secret).digest();
const newSecret = () => `zrt_${randomBytes(32).toString("base64url")}`;

type FireEvent = (
  triggerId: string,
  trigger: "webhook" | "event",
  key: string,
  event: unknown,
) => Promise<{ run: typeof routineRun.$inferSelect; replay: boolean } | undefined>;

/**
 * Extra ways to start a routine. A webhook trigger is a URL plus a secret the caller sends as `Authorization: Bearer`; only the hash of the
 * secret is stored, and it is shown once. Every refusal before the secret is proven looks the same, so the route does not tell whether a
 * trigger exists.
 */
export function createRoutineTriggers(db: Database, fire: FireEvent) {
  // Set once the plugin service exists (see services.ts). Without it, Gmail and Home Assistant triggers are not polled.
  let pollers: Pollers | undefined;
  const ownedRoutine = async (actor: ActiveActor, routineId: string) => {
    const [r] = await db
      .select({ id: routine.id })
      .from(routine)
      .where(and(eq(routine.id, routineId), eq(routine.ownerUserId, actor.userId)));
    if (!r) throw new AccessError("NOT_FOUND");
  };
  const ownedTrigger = async (actor: ActiveActor, routineId: string, id: string) => {
    const [t] = await db
      .select()
      .from(routineTrigger)
      .where(
        and(
          eq(routineTrigger.id, id),
          eq(routineTrigger.routineId, routineId),
          eq(routineTrigger.ownerUserId, actor.userId),
        ),
      );
    if (!t) throw new AccessError("NOT_FOUND");
    return t;
  };

  /** Polls one claimed trigger, starts a run for each new event, and records where it stopped. Never throws. */
  async function poll(t: Trigger) {
    const poller = pollers?.[t.kind as "gmail" | "home_assistant"];
    if (!poller) return;
    // Paused agents: do not look at all. The cursor stays where it was, so what arrives meanwhile is found after "resume".
    if (await agentsPaused(db, t.ownerUserId)) {
      await db
        .update(routineTrigger)
        .set({
          nextPollAt: new Date(Date.now() + POLL_EVERY_MS[t.kind as keyof typeof POLL_EVERY_MS]),
        })
        .where(eq(routineTrigger.id, t.id));
      return;
    }
    try {
      const res = await poller(t.ownerUserId, t.filter, t.cursor);
      // Events past the hourly allowance are dropped and said so, instead of starting a burst of runs.
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(routineRun)
        .where(
          and(
            eq(routineRun.triggerId, t.id),
            gt(routineRun.startedAt, new Date(Date.now() - 3_600_000)),
          ),
        );
      const room = Math.max(0, MAX_RUNS_PER_HOUR - n);
      for (const e of res.events.slice(0, room)) await fire(t.id, "event", e.key, e.event);
      const skipped = res.events.length - Math.min(res.events.length, room);
      await db
        .update(routineTrigger)
        .set({
          cursor: res.cursor as never,
          failures: 0,
          statusReason: skipped
            ? `Skipped ${skipped} ${skipped === 1 ? "event" : "events"}: the limit is ${MAX_RUNS_PER_HOUR} runs an hour.`
            : null,
          nextPollAt: new Date(Date.now() + POLL_EVERY_MS[t.kind as keyof typeof POLL_EVERY_MS]),
        })
        .where(eq(routineTrigger.id, t.id));
    } catch (e) {
      const failures = t.failures + 1;
      const failing = failures >= MAX_FAILURES;
      const reason = why(e).slice(0, 300);
      await db
        .update(routineTrigger)
        .set({
          failures,
          statusReason: reason,
          status: failing ? "failing" : "active",
          // Backs off: 1, 2, 4, 8 minutes. A failing trigger stops until the owner turns it on again.
          nextPollAt: failing ? null : new Date(Date.now() + 60_000 * 2 ** (failures - 1)),
        })
        .where(eq(routineTrigger.id, t.id));
      if (failing) {
        const [r] = await db.select().from(routine).where(eq(routine.id, t.routineId));
        await raiseAttention(db, t.ownerUserId, {
          botId: r?.botId ?? null,
          title: `A trigger of routine "${r?.title ?? "?"}" stopped`,
          detail: reason,
          nextAction: "Fix the connection, then turn the trigger on again.",
          resultLink: `/routines?routine=${t.routineId}`,
          source: "routine",
          sourceKey: `trigger:${t.id}:failing`,
        }).catch(() => {});
      }
    }
  }

  return {
    usePollers(p: Pollers | undefined) {
      pollers = p;
    },
    /**
     * Polls the Gmail and Home Assistant triggers that are due. Each is claimed with one atomic update that moves `next_poll_at` forward
     * (a lease), so two workers never poll the same trigger. Triggers of a paused routine are not polled. Runs on the worker tick.
     */
    async tick() {
      if (!pollers) return 0;
      const due = await db
        .select({ id: routineTrigger.id })
        .from(routineTrigger)
        .innerJoin(routine, eq(routine.id, routineTrigger.routineId))
        .where(
          and(
            eq(routineTrigger.status, "active"),
            sql`${routineTrigger.kind} <> 'webhook'`,
            lte(routineTrigger.nextPollAt, new Date()),
            eq(routine.paused, false),
            eq(routine.archived, false),
          ),
        )
        .orderBy(asc(routineTrigger.nextPollAt))
        .limit(20);
      let polled = 0;
      for (const { id } of due) {
        const [claimed] = await db
          .update(routineTrigger)
          .set({ nextPollAt: new Date(Date.now() + LEASE_MS) })
          .where(
            and(
              eq(routineTrigger.id, id),
              eq(routineTrigger.status, "active"),
              lte(routineTrigger.nextPollAt, new Date()),
            ),
          )
          .returning();
        if (!claimed) continue;
        await poll(claimed);
        polled++;
      }
      return polled;
    },
    async list(actor: ActiveActor, routineId: string) {
      await ownedRoutine(actor, routineId);
      const rows = await db
        .select()
        .from(routineTrigger)
        .where(eq(routineTrigger.routineId, routineId))
        .orderBy(asc(routineTrigger.createdAt));
      return rows.map(view);
    },
    /** `secret` is returned only here (a webhook), and again by `rotate`. */
    async create(actor: ActiveActor, routineId: string, input: TriggerInput) {
      await ownedRoutine(actor, routineId);
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(routineTrigger)
        .where(eq(routineTrigger.routineId, routineId));
      if (n >= MAX_TRIGGERS) throw new TriggerError("LIMIT");
      const secret = input.kind === "webhook" ? newSecret() : undefined;
      const filter =
        input.kind === "gmail"
          ? { query: input.query }
          : input.kind === "home_assistant"
            ? { entityId: input.entityId, ...(input.to ? { to: input.to } : {}) }
            : {};
      // A first poll proves the plugin is connected and the query or entity is valid, and sets the cursor, so nothing old fires.
      let cursor: unknown = null;
      const poller = input.kind === "webhook" ? undefined : pollers?.[input.kind];
      if (poller)
        try {
          cursor = (await poller(actor.userId, filter, null)).cursor;
        } catch (e) {
          throw new TriggerError("UNAVAILABLE", why(e));
        }
      const [row] = await db
        .insert(routineTrigger)
        .values({
          id: uuidv7(),
          routineId,
          ownerUserId: actor.userId,
          kind: input.kind,
          secretHash: secret ? hash(secret).toString("hex") : null,
          filter,
          cursor: cursor as never,
          // Pollers pick the trigger up on their next tick.
          nextPollAt: input.kind === "webhook" ? null : new Date(),
        })
        .returning();
      return { trigger: view(row!), ...(secret ? { secret } : {}) };
    },
    async setStatus(
      actor: ActiveActor,
      routineId: string,
      id: string,
      status: "active" | "paused",
    ) {
      await ownedTrigger(actor, routineId, id);
      const [row] = await db
        .update(routineTrigger)
        .set({
          status,
          statusReason: null,
          failures: 0,
          // A trigger turned on again starts polling at once.
          nextPollAt: status === "active" ? new Date() : null,
        })
        .where(eq(routineTrigger.id, id))
        .returning();
      return view(row!);
    },
    /** A new secret; the old one stops working at once. */
    async rotate(actor: ActiveActor, routineId: string, id: string) {
      const t = await ownedTrigger(actor, routineId, id);
      if (t.kind !== "webhook") throw new AccessError("NOT_FOUND");
      const secret = newSecret();
      await db
        .update(routineTrigger)
        .set({ secretHash: hash(secret).toString("hex") })
        .where(eq(routineTrigger.id, id));
      return { trigger: view(t), secret };
    },
    async remove(actor: ActiveActor, routineId: string, id: string) {
      await ownedTrigger(actor, routineId, id);
      // Past runs keep their rows: `trigger_id` goes null.
      await db.delete(routineTrigger).where(eq(routineTrigger.id, id));
    },
    /**
     * A webhook call. `invalid`: no such trigger, not a webhook, or the secret is wrong (all the same to the caller). `limited`: more than
     * MAX_RUNS_PER_HOUR runs in the last hour (counted before anything starts, so a refused call starts nothing). `off`: the secret is right but the routine is paused. A repeated `key` returns the same run.
     */
    async receive(triggerId: string, secret: string, key: string | null, body: unknown) {
      const [t] = await db.select().from(routineTrigger).where(eq(routineTrigger.id, triggerId));
      const expected =
        t?.kind === "webhook" && t.secretHash ? Buffer.from(t.secretHash, "hex") : null;
      const given = hash(secret);
      // Compared as fixed-size digests; an unknown trigger still pays for one comparison.
      const ok =
        timingSafeEqual(expected ?? Buffer.alloc(given.length), given) && expected !== null;
      if (!t || !ok || t.status !== "active") return { status: "invalid" as const };
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(routineRun)
        .where(
          and(
            eq(routineRun.triggerId, t.id),
            gt(routineRun.startedAt, new Date(Date.now() - 3_600_000)),
          ),
        );
      if (n >= MAX_RUNS_PER_HOUR) return { status: "limited" as const };
      if (await agentsPaused(db, t.ownerUserId)) return { status: "paused" as const };
      const result = await fire(t.id, "webhook", key ?? uuidv7(), body);
      if (!result) return { status: "off" as const };
      return { status: "ok" as const, run: result.run, replay: result.replay };
    },
  };
}
export type RoutineTriggers = ReturnType<typeof createRoutineTriggers>;
