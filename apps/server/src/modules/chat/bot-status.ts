import type { Database } from "@zetta/db";
import { and, desc, eq, inArray, or, sql } from "@zetta/db/query";
import { auditEvent, attentionItem, configProposal, routine } from "@zetta/db/schema/features";
import { discussionTurn } from "@zetta/db/schema/discussions";
import { task } from "@zetta/db/schema/tasks";

export const BOT_STATUSES = [
  "available",
  "working",
  "planning",
  "pending",
  "error",
  "offline",
] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];
export type BotStatusEntry = { botId: string; status: BotStatus; reason: string };

/** `planning` = read-only discovery (thinking, searching, reading); `working` = writing the answer or changing something. */
export type RunPhase = "planning" | "working";

/** Tool calls that only look things up. A round made only of these keeps the run in `planning`. */
export function isResearchCall(call: { kind: string; args: unknown }): boolean {
  const action = (call.args as { action?: unknown } | null)?.action;
  if (call.kind === "chats" || call.kind === "messages") return true;
  if (action === "list") return true;
  if (call.kind === "browser") return action === "open" || action === "read";
  if (call.kind === "desktop") return action === "read";
  return false;
}
/** The phase after one tool round: a round with any call that is not research makes it `working`. */
export const phaseAfterRound = (calls: { kind: string; args: unknown }[]): RunPhase =>
  calls.every(isResearchCall) ? "planning" : "working";

type LiveRun = { botId: string; userId: string; phase: RunPhase; label: string };

/**
 * In-process registry of chat answers that are being written right now, keyed by message id (one bot can answer in several chats).
 * Same lifetime as the turn registry: after a restart nothing runs, and boot recovery already marks the rows `interrupted`.
 */
export function createLiveBots() {
  const runs = new Map<string, LiveRun>();
  return {
    begin(messageId: string, botId: string, userId: string) {
      runs.set(messageId, { botId, userId, phase: "planning", label: "" });
    },
    /** A phase moves forward only: planning to working, never back, so one late "Thinking" does not flip the label. */
    update(messageId: string, change: { phase?: RunPhase; label?: string }) {
      const run = runs.get(messageId);
      if (!run) return;
      if (change.phase === "working") run.phase = "working";
      if (change.label && change.label !== "Thinking") run.label = change.label;
    },
    end(messageId: string) {
      runs.delete(messageId);
    },
    /** The most advanced run of this bot for this viewer (working beats planning). */
    of(userId: string, botId: string): LiveRun | undefined {
      let found: LiveRun | undefined;
      for (const r of runs.values()) {
        if (r.userId !== userId || r.botId !== botId) continue;
        if (!found || r.phase === "working") found = r;
      }
      return found;
    },
  };
}
export type LiveBots = ReturnType<typeof createLiveBots>;

export type BotFacts = {
  /** Last `harness_run` outcome for this bot, if any. */
  lastOutcome?: string | null;
  harnessLabel?: string;
  /** Things that wait for the person: open attention items, pending proposals, blocked or in-review tasks, turns awaiting approval. */
  pending: number;
  live?: { phase: RunPhase; label: string };
  /** Work that runs without a chat answer: a running room turn or routine. */
  runningElsewhere: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** First match wins: offline, pending, planning, working, error, available. */
export function deriveBotStatus(f: BotFacts): { status: BotStatus; reason: string } {
  const tool = f.harnessLabel ?? "the harness";
  if (f.lastOutcome === "not_installed")
    return { status: "offline", reason: `${tool} is not installed on the server` };
  if (f.pending > 0)
    return {
      status: "pending",
      reason: `${plural(f.pending, "item waits", "items wait")} for you`,
    };
  if (f.live?.phase === "planning")
    return { status: "planning", reason: f.live.label || "Thinking and looking things up" };
  if (f.live?.phase === "working")
    return { status: "working", reason: f.live.label || "Writing the answer" };
  if (f.runningElsewhere) return { status: "working", reason: "Running a room turn or routine" };
  if (f.lastOutcome === "auth_required")
    return { status: "error", reason: `Not signed in to ${tool}` };
  if (f.lastOutcome === "failed" || f.lastOutcome === "timeout")
    return { status: "error", reason: "The last run failed" };
  return { status: "available", reason: "Online, no tasks" };
}

const count = sql<number>`count(*)::int`;
const addTo = (m: Map<string, number>, id: string | null, n = 1) => {
  if (id) m.set(id, (m.get(id) ?? 0) + n);
};

/**
 * Status of each bot for one viewer. Every count uses only the viewer's own rows, so a team bot never shows another person's work.
 * Archived bots are not listed (`listBots` skips them), so they have no status.
 */
export async function loadBotStatus(
  db: Database,
  userId: string,
  bots: { id: string; harness: string }[],
  live: LiveBots,
  labels: Record<string, string> = {},
): Promise<BotStatusEntry[]> {
  if (!bots.length) return [];
  const ids = bots.map((b) => b.id);
  const [attention, proposals, tasks, turns, routines, outcomes] = await Promise.all([
    db
      .select({ botId: attentionItem.botId, n: count })
      .from(attentionItem)
      .where(
        and(
          eq(attentionItem.ownerUserId, userId),
          eq(attentionItem.status, "open"),
          inArray(attentionItem.botId, ids),
        ),
      )
      .groupBy(attentionItem.botId),
    db
      .select({ botId: configProposal.botId, by: configProposal.proposedByBotId })
      .from(configProposal)
      .where(
        and(
          eq(configProposal.ownerUserId, userId),
          eq(configProposal.status, "pending"),
          or(inArray(configProposal.botId, ids), inArray(configProposal.proposedByBotId, ids)),
        ),
      ),
    db
      .select({ botId: task.botId, n: count })
      .from(task)
      .where(
        and(
          eq(task.ownerUserId, userId),
          inArray(task.status, ["blocked", "review"]),
          inArray(task.botId, ids),
        ),
      )
      .groupBy(task.botId),
    db
      .select({ botId: discussionTurn.botId, status: discussionTurn.status, n: count })
      .from(discussionTurn)
      .where(
        and(
          eq(discussionTurn.ownerUserId, userId),
          inArray(discussionTurn.status, ["awaiting_approval", "running"]),
          inArray(discussionTurn.botId, ids),
        ),
      )
      .groupBy(discussionTurn.botId, discussionTurn.status),
    db
      .select({ botId: routine.botId, n: count })
      .from(routine)
      .where(
        and(
          eq(routine.ownerUserId, userId),
          eq(routine.status, "running"),
          eq(routine.archived, false),
          inArray(routine.botId, ids),
        ),
      )
      .groupBy(routine.botId),
    db
      .selectDistinctOn([auditEvent.botId], {
        botId: auditEvent.botId,
        outcome: auditEvent.outcome,
      })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.ownerUserId, userId),
          eq(auditEvent.kind, "harness_run"),
          inArray(auditEvent.botId, ids),
        ),
      )
      .orderBy(auditEvent.botId, desc(auditEvent.createdAt)),
  ]);

  const pending = new Map<string, number>();
  for (const r of attention) addTo(pending, r.botId, r.n);
  for (const r of tasks) addTo(pending, r.botId, r.n);
  for (const r of proposals) {
    // one proposal counts once per bot, also when the same bot proposed it and is its subject
    addTo(pending, r.botId);
    if (r.by && r.by !== r.botId) addTo(pending, r.by);
  }
  const running = new Set<string>();
  for (const r of turns) {
    if (r.status === "awaiting_approval") addTo(pending, r.botId, r.n);
    else running.add(r.botId);
  }
  for (const r of routines) running.add(r.botId);
  const last = new Map(outcomes.map((o) => [o.botId, o.outcome]));

  return bots.map((b) => ({
    botId: b.id,
    ...deriveBotStatus({
      lastOutcome: last.get(b.id),
      harnessLabel: labels[b.harness],
      pending: pending.get(b.id) ?? 0,
      live: live.of(userId, b.id),
      runningElsewhere: running.has(b.id),
    }),
  }));
}
