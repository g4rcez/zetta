import { workingMsBetween } from "@zetta/core/working-days";
import type { Database } from "@zetta/db";
import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, sql } from "@zetta/db/query";
import { attentionItem } from "@zetta/db/schema/features";
import { task } from "@zetta/db/schema/tasks";
import { checkinText, raiseWork, stuckText, workKey, type StuckWhy } from "./cards";
import { fingerprintOf, loadFacts, type TaskFacts } from "./facts";
import {
  BOT_IDLE_MS,
  CHECKIN_WAIT_MS,
  checksOnPeople,
  PERSON_IDLE_MS,
  PERSON_UNANSWERED_MS,
  SCAN_EVERY_MS,
  SCAN_LIMIT,
  watchFactor,
} from "./thresholds";
import { createWorkWatch, isQuiet } from "./watch";

/**
 * Looks for work that stopped moving and tells the right person, in this order of politeness: a bot's manager is told; a person is
 * asked first ("still working on this?") and their manager only hears when they do not answer. Blocked work is not found here: whoever
 * blocks a task reports it at once (tasks store `onBlocked`). The scan never repeats a live card and stays silent while a task is quiet.
 */
export function createWorkScan(deps: {
  db: Database;
  /** People whose agents are paused are not told that their bots stopped: they stopped them. */
  ownerPaused?: (userId: string) => Promise<boolean>;
  /** A card for a manager was raised: whoever writes suggestions reads the task now. */
  onRaised?: (cardId: string) => void;
  now?: () => Date;
}) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const watch = createWorkWatch(db);

  /** The tasks that already have a live card with one of these keys, so a card is raised once and not on every pass. */
  async function live(keys: string[]) {
    if (!keys.length) return new Set<string>();
    const rows = await db
      .select({ key: attentionItem.sourceKey })
      .from(attentionItem)
      .where(
        and(
          inArray(attentionItem.sourceKey, keys),
          inArray(attentionItem.status, ["open", "acknowledged"]),
        ),
      );
    return new Set(rows.map((r) => r.key));
  }

  const topLevel = and(isNull(task.parentTaskId));

  /** Tells the manager, unless a card about it is already open or they asked for quiet and the task did not change since. */
  async function tellManager(found: { f: TaskFacts; why: StuckWhy }[]) {
    if (!found.length) return 0;
    const ids = found.map((x) => x.f.task.id);
    const [open, quiet] = await Promise.all([
      live(ids.map((id) => workKey("work_stuck", id))),
      watch.of(ids, "stuck"),
    ]);
    let raised = 0;
    for (const { f, why } of found) {
      if (open.has(workKey("work_stuck", f.task.id))) continue;
      if (isQuiet(quiet.get(f.task.id), fingerprintOf(f.task), now())) continue;
      const card = await raiseWork(db, "work_stuck", f, stuckText(f, why));
      try {
        if (card) deps.onRaised?.(card.id);
      } catch {
        // The card is there with its usual steps: suggestions are extra.
      }
      raised += 1;
    }
    return raised;
  }

  /** Bot tasks in progress that nobody calls the bot back for, unchanged for a while. */
  async function idleBots() {
    // The shortest wait any project can ask for bounds the read; each task is then held to its own project's wait.
    const rows = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          topLevel,
          eq(task.assignee, "bot"),
          isNotNull(task.botId),
          eq(task.status, "in_progress"),
          eq(task.followUp, "off"),
          lt(task.updatedAt, new Date(+now() - BOT_IDLE_MS * watchFactor("close"))),
        ),
      )
      .orderBy(asc(task.updatedAt))
      .limit(SCAN_LIMIT);
    const facts = [
      ...(
        await loadFacts(
          db,
          rows.map((r) => r.id),
        )
      ).values(),
    ];
    const paused = new Map<string, boolean>();
    const found: { f: TaskFacts; why: StuckWhy }[] = [];
    for (const f of facts) {
      if (+now() - +f.task.updatedAt < BOT_IDLE_MS * watchFactor(f.project?.watch)) continue;
      const owner = f.task.ownerUserId;
      if (!paused.has(owner)) paused.set(owner, (await deps.ownerPaused?.(owner)) ?? false);
      if (paused.get(owner)) continue;
      found.push({ f, why: { kind: "idle" } });
    }
    return tellManager(found);
  }

  /** Tasks for a person who is not the owner, still open. */
  async function personTasks(status: "backlog" | "in_progress", olderThanMs: number) {
    const rows = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          topLevel,
          eq(task.assignee, "person"),
          isNotNull(task.assigneeUserId),
          ne(task.assigneeUserId, sql`${task.ownerUserId}`),
          eq(task.status, status),
          // Calendar time is at least working time: this only bounds the read.
          lt(task.updatedAt, new Date(+now() - olderThanMs * watchFactor("close"))),
        ),
      )
      .orderBy(asc(task.updatedAt))
      .limit(SCAN_LIMIT);
    return [
      ...(
        await loadFacts(
          db,
          rows.map((r) => r.id),
        )
      ).values(),
    ].filter((f) => checksOnPeople(f.project?.watch));
  }
  const idleFor = (f: TaskFacts) => workingMsBetween(f.task.updatedAt, now());

  /** A person was asked for something and has not touched it for a working day: their manager hears. */
  async function unanswered() {
    const facts = await personTasks("backlog", PERSON_UNANSWERED_MS);
    return tellManager(
      facts
        .filter((f) => idleFor(f) >= PERSON_UNANSWERED_MS * watchFactor(f.project?.watch))
        .map((f) => ({ f, why: { kind: "unanswered" as const } })),
    );
  }

  /**
   * A person's task in progress went quiet. First they are asked, with one tap to answer. Their manager hears only when a working day
   * passes with no answer and no change.
   */
  async function quietPeople() {
    const facts = (await personTasks("in_progress", PERSON_IDLE_MS)).filter(
      (f) => idleFor(f) >= PERSON_IDLE_MS * watchFactor(f.project?.watch),
    );
    if (!facts.length) return { asked: 0, told: 0 };
    const ids = facts.map((f) => f.task.id);
    const [asks, open] = await Promise.all([
      watch.of(ids, "checkin"),
      live(ids.map((id) => workKey("work_checkin", id))),
    ]);
    let asked = 0;
    const silent: { f: TaskFacts; why: StuckWhy }[] = [];
    for (const f of facts) {
      const row = asks.get(f.task.id);
      const same = row?.fingerprint === fingerprintOf(f.task);
      // They said "on it" and that time has not passed: leave them alone.
      if (isQuiet(row, fingerprintOf(f.task), now())) continue;
      if (row?.verdict === "asked" && same && row.checkedAt) {
        if (
          workingMsBetween(row.checkedAt, now()) >=
          CHECKIN_WAIT_MS * watchFactor(f.project?.watch)
        )
          silent.push({ f, why: { kind: "no_reply" } });
        continue;
      }
      if (open.has(workKey("work_checkin", f.task.id))) continue;
      await raiseWork(db, "work_checkin", f, checkinText(f));
      await watch.set(f.task.id, "checkin", {
        verdict: "asked",
        checkedAt: now(),
        fingerprint: fingerprintOf(f.task),
        quietUntil: null,
      });
      asked += 1;
    }
    return { asked, told: await tellManager(silent) };
  }

  let last = 0;
  return {
    /** Called by the server's ticker every few seconds: runs a pass when one is due, and does nothing otherwise. */
    async due(everyMs = SCAN_EVERY_MS) {
      if (+now() - last < everyMs) return undefined;
      last = +now();
      return this.tick();
    },
    /** One pass. Each check fails alone: a broken one never hides the others. */
    async tick() {
      const safe = async <T>(work: () => Promise<T>, empty: T) => work().catch(() => empty);
      const [bots, waiting, people] = await Promise.all([
        safe(idleBots, 0),
        safe(unanswered, 0),
        safe(quietPeople, { asked: 0, told: 0 }),
      ]);
      return { bots, waiting, asked: people.asked, told: people.told };
    },
  };
}
export type WorkScan = ReturnType<typeof createWorkScan>;
