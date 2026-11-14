import { ACTIONS, QUEUE_KINDS, type DecisionKind } from "@zetta/core/attention-kinds";
import type {
  CatchUpCardItem,
  CatchUpContext,
  CatchUpItem,
  CatchUpProposalItem,
  CatchUpSummary,
} from "@zetta/core/catch-up";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, inArray, or } from "@zetta/db/query";
import { agendaSync } from "@zetta/db/schema/agenda";
import { goalLoop } from "@zetta/db/schema/chat";
import { discussion } from "@zetta/db/schema/discussions";
import {
  attentionItem,
  type configProposal,
  routine,
  routineTrigger,
  workflow,
  workflowRun,
} from "@zetta/db/schema/features";
import { inboundRoute } from "@zetta/db/schema/inbound";
import { knowledgeSource } from "@zetta/db/schema/knowledge";
import { memoryItem, memorySuggestion } from "@zetta/db/schema/memory";
import { task } from "@zetta/db/schema/tasks";
import type { ActiveActor } from "../identity/access";
import { closeAttentionIds } from "../features/attention";

export type ProposalRow = typeof configProposal.$inferSelect & { confirm: string };
export type CatchUpDeps = {
  db: Database;
  /** `chat.listProposals`: pending, unexpired approvals, oldest first. */
  listProposals: (actor: ActiveActor, botId?: string) => Promise<ProposalRow[]>;
};

type CardRow = typeof attentionItem.$inferSelect;
/** `needed: false` means the thing the card was about no longer waits for the person, so the card is closed. */
type Verdict = { needed: true; context: CatchUpContext } | { needed: false };

const NEEDED: Verdict = { needed: true, context: {} };
const GONE: Verdict = { needed: false };
const need = (context: CatchUpContext): Verdict => ({ needed: true, context });

/** A room that can still take a turn. Resolved and cancelled rooms are over. */
const ACTIVE_ROOM = ["open", "paused", "stalled"];
const OPEN_TASK = ["backlog", "in_progress"];
const CARD_LIMIT = 200;

const SYNC_AUTH_KEYS = ["knowledge-sync:auth", "agenda-sync:auth"];

const subjects = (rows: readonly CardRow[], kinds: readonly DecisionKind[]) => [
  ...new Set(
    rows
      .filter((r) => kinds.includes(r.kind as DecisionKind) && r.subjectId)
      .map((r) => r.subjectId!),
  ),
];

/**
 * Reads what each card is about, in one query per kind of subject (never one per card), and says whether the person is still
 * needed. A card whose subject is gone, or already moved on, is not a decision any more.
 */
export async function judge(db: Database, userId: string, rows: readonly CardRow[]) {
  const taskIds = subjects(rows, ["task_ask", "task_follow"]);
  const loopIds = subjects(rows, ["loop_paused"]);
  const roomIds = subjects(rows, [
    "room_stuck",
    "room_failed",
    "room_interrupted",
    "permission_request",
  ]);
  const routineIds = subjects(rows, ["routine_failed", "routine_blocked", "routine_interrupted"]);
  const triggerIds = subjects(rows, ["trigger_failing"]);
  const workflowIds = subjects(rows, ["workflow_failed", "workflow_interrupted"]);
  const routeIds = subjects(rows, ["inbound_stopped", "connection_lost"]);
  const pageIds = subjects(rows, ["memory_suggestion"]);
  const hasSyncAuth = rows.some((r) => r.sourceKey && SYNC_AUTH_KEYS.includes(r.sourceKey));

  const [
    tasks,
    loops,
    rooms,
    routines,
    triggers,
    workflows,
    runs,
    routes,
    pages,
    suggestions,
    google,
  ] = await Promise.all([
    taskIds.length
      ? db
          .select({
            id: task.id,
            title: task.title,
            status: task.status,
            followUp: task.followUp,
          })
          .from(task)
          .where(
            and(
              inArray(task.id, taskIds),
              or(eq(task.ownerUserId, userId), eq(task.assigneeUserId, userId)),
            ),
          )
      : [],
    loopIds.length
      ? db
          .select({
            id: goalLoop.id,
            goal: goalLoop.goal,
            status: goalLoop.status,
            reason: goalLoop.reason,
          })
          .from(goalLoop)
          .where(and(inArray(goalLoop.id, loopIds), eq(goalLoop.ownerUserId, userId)))
      : [],
    roomIds.length
      ? db
          .select({ id: discussion.id, title: discussion.title, status: discussion.status })
          .from(discussion)
          .where(and(inArray(discussion.id, roomIds), eq(discussion.ownerUserId, userId)))
      : [],
    routineIds.length
      ? db
          .select({
            id: routine.id,
            title: routine.title,
            status: routine.status,
            paused: routine.paused,
            archived: routine.archived,
            reason: routine.statusReason,
          })
          .from(routine)
          .where(and(inArray(routine.id, routineIds), eq(routine.ownerUserId, userId)))
      : [],
    triggerIds.length
      ? db
          .select({
            id: routineTrigger.id,
            status: routineTrigger.status,
            reason: routineTrigger.statusReason,
            routine: routine.title,
          })
          .from(routineTrigger)
          .innerJoin(routine, eq(routine.id, routineTrigger.routineId))
          .where(
            and(inArray(routineTrigger.id, triggerIds), eq(routineTrigger.ownerUserId, userId)),
          )
      : [],
    workflowIds.length
      ? db
          .select({ id: workflow.id, name: workflow.name })
          .from(workflow)
          .where(and(inArray(workflow.id, workflowIds), eq(workflow.ownerUserId, userId)))
      : [],
    workflowIds.length
      ? db
          .selectDistinctOn([workflowRun.workflowId], {
            workflowId: workflowRun.workflowId,
            status: workflowRun.status,
          })
          .from(workflowRun)
          .where(
            and(inArray(workflowRun.workflowId, workflowIds), eq(workflowRun.ownerUserId, userId)),
          )
          .orderBy(workflowRun.workflowId, desc(workflowRun.createdAt))
      : [],
    routeIds.length
      ? db
          .select({
            id: inboundRoute.id,
            pluginId: inboundRoute.pluginId,
            enabled: inboundRoute.enabled,
            lastError: inboundRoute.lastError,
          })
          .from(inboundRoute)
          .where(and(inArray(inboundRoute.id, routeIds), eq(inboundRoute.ownerUserId, userId)))
      : [],
    pageIds.length
      ? db
          .select({ id: memoryItem.id, title: memoryItem.title, status: memoryItem.status })
          .from(memoryItem)
          .where(and(inArray(memoryItem.id, pageIds), eq(memoryItem.ownerUserId, userId)))
      : [],
    pageIds.length
      ? db
          .select({
            pageId: memorySuggestion.pageId,
            reason: memorySuggestion.reason,
            title: memorySuggestion.title,
          })
          .from(memorySuggestion)
          .where(
            and(
              inArray(memorySuggestion.pageId, pageIds),
              eq(memorySuggestion.pageOwnerUserId, userId),
              eq(memorySuggestion.status, "open"),
            ),
          )
          .orderBy(desc(memorySuggestion.createdAt))
      : [],
    // Reconnect cards for Google carry no subject: ask the two sources they come from.
    hasSyncAuth
      ? Promise.all([
          db
            .select({ id: knowledgeSource.id })
            .from(knowledgeSource)
            .where(
              and(
                eq(knowledgeSource.ownerUserId, userId),
                eq(knowledgeSource.status, "needs_auth"),
              ),
            )
            .limit(1),
          db
            .select({ id: agendaSync.id, error: agendaSync.lastError })
            .from(agendaSync)
            .where(and(eq(agendaSync.ownerUserId, userId), eq(agendaSync.enabled, true)))
            .limit(1),
        ])
      : [[], []],
  ]);

  const taskBy = new Map(tasks.map((t) => [t.id, t]));
  const loopBy = new Map(loops.map((l) => [l.id, l]));
  const roomBy = new Map(rooms.map((r) => [r.id, r]));
  const routineBy = new Map(routines.map((r) => [r.id, r]));
  const triggerBy = new Map(triggers.map((t) => [t.id, t]));
  const workflowBy = new Map(workflows.map((w) => [w.id, w]));
  const latestRun = new Map(runs.map((r) => [r.workflowId, r.status]));
  const routeBy = new Map(routes.map((r) => [r.id, r]));
  const pageBy = new Map(pages.map((p) => [p.id, p]));
  const waiting = new Map<string, { n: number; reason: string; title: string }>();
  for (const s of suggestions) {
    // Newest first: the first row of a page is the one shown, the rest only count.
    const seen = waiting.get(s.pageId);
    if (seen) seen.n += 1;
    else waiting.set(s.pageId, { n: 1, reason: s.reason, title: s.title });
  }
  const [knowledgeAuth, agendaAuth] = google as [{ id: string }[], { id: string; error: string }[]];

  const verdict = (r: CardRow): Verdict => {
    const id = r.subjectId;
    switch (r.kind as DecisionKind) {
      case "task_ask": {
        const t = id ? taskBy.get(id) : undefined;
        if (!id) return NEEDED;
        return t && t.status !== "done" ? need({ subject: t.title, status: t.status }) : GONE;
      }
      case "task_follow": {
        const t = id ? taskBy.get(id) : undefined;
        if (!id) return NEEDED;
        return t && t.followUp === "paused" && OPEN_TASK.includes(t.status)
          ? need({ subject: t.title, status: "follow-up paused" })
          : GONE;
      }
      case "loop_paused": {
        const l = id ? loopBy.get(id) : undefined;
        if (!id) return NEEDED;
        return l && l.status === "paused"
          ? need({
              subject: l.goal.slice(0, 200),
              status: "paused",
              extra: (l.reason ?? "").slice(0, 300),
            })
          : GONE;
      }
      case "room_stuck":
      case "room_failed":
      case "room_interrupted":
      case "permission_request": {
        const room = id ? roomBy.get(id) : undefined;
        if (!id) return NEEDED;
        return room && ACTIVE_ROOM.includes(room.status)
          ? need({ subject: room.title, status: room.status })
          : GONE;
      }
      case "routine_failed":
      case "routine_blocked":
      case "routine_interrupted": {
        const x = id ? routineBy.get(id) : undefined;
        if (!id) return NEEDED;
        if (!x || x.archived) return GONE;
        const waits =
          r.kind === "routine_failed"
            ? x.status === "failed" || x.status === "blocked"
            : r.kind === "routine_blocked"
              ? x.paused && x.status === "blocked"
              : x.status === "interrupted";
        return waits
          ? need({ subject: x.title, status: x.status, extra: (x.reason ?? "").slice(0, 300) })
          : GONE;
      }
      case "trigger_failing": {
        const t = id ? triggerBy.get(id) : undefined;
        if (!id) return NEEDED;
        return t && t.status === "failing"
          ? need({ subject: t.routine, status: "failing", extra: (t.reason ?? "").slice(0, 300) })
          : GONE;
      }
      case "workflow_failed":
      case "workflow_interrupted": {
        const w = id ? workflowBy.get(id) : undefined;
        if (!id) return NEEDED;
        const last = latestRun.get(id);
        const want = r.kind === "workflow_failed" ? "failed" : "interrupted";
        return w && last === want ? need({ subject: w.name, status: want }) : GONE;
      }
      case "inbound_stopped": {
        const route = id ? routeBy.get(id) : undefined;
        if (!id) return NEEDED;
        return route && !route.enabled
          ? need({ plugin: route.pluginId, status: "turned off" })
          : GONE;
      }
      case "connection_lost": {
        if (r.sourceKey === "knowledge-sync:auth")
          return knowledgeAuth.length > 0 ? need({ plugin: "google" }) : GONE;
        if (r.sourceKey === "agenda-sync:auth")
          return agendaAuth.some((a) => a.error !== "") ? need({ plugin: "google" }) : GONE;
        const route = id ? routeBy.get(id) : undefined;
        if (!id) return NEEDED;
        return route && route.enabled && route.lastError !== ""
          ? need({
              plugin: route.pluginId,
              status: "needs sign-in",
              extra: route.lastError.slice(0, 300),
            })
          : GONE;
      }
      case "memory_suggestion": {
        const p = id ? pageBy.get(id) : undefined;
        if (!id) return NEEDED;
        const w = waiting.get(id);
        return p && p.status !== "archived" && w
          ? need({ subject: p.title, pending: w.n, extra: w.reason.slice(0, 300) })
          : GONE;
      }
      // Nothing to read for these: they stay until the person acts or dismisses them.
      default:
        return NEEDED;
    }
  };

  return new Map(rows.map((r) => [r.id, verdict(r)]));
}

const time = (d: Date | string) => new Date(d).getTime();

/**
 * Everything waiting for a decision: pending approvals plus the decision cards that still need the person. Cards whose subject no longer
 * waits are closed here (so the badge and the list can never disagree). Approvals that expire soonest come first, then oldest first.
 */
export async function buildQueue(
  { db, listProposals }: CatchUpDeps,
  actor: ActiveActor,
  opts: { botId?: string } = {},
): Promise<CatchUpItem<ProposalRow>[]> {
  const [proposals, rows] = await Promise.all([
    listProposals(actor, opts.botId),
    db
      .select()
      .from(attentionItem)
      .where(
        and(
          eq(attentionItem.ownerUserId, actor.userId),
          inArray(attentionItem.status, ["open", "acknowledged"]),
          inArray(attentionItem.kind, [...QUEUE_KINDS]),
          opts.botId ? eq(attentionItem.botId, opts.botId) : undefined,
        ),
      )
      .orderBy(asc(attentionItem.createdAt))
      .limit(CARD_LIMIT),
  ]);
  const verdicts = await judge(db, actor.userId, rows);
  const finished = rows.filter((r) => !verdicts.get(r.id)?.needed).map((r) => r.id);
  await closeAttentionIds(db, actor.userId, finished, "resolved");

  const items: CatchUpItem<ProposalRow>[] = [
    ...proposals.map((p): CatchUpProposalItem<ProposalRow> => ({
      key: `proposal:${p.id}`,
      source: "proposal",
      id: p.id,
      botId: p.proposedByBotId ?? p.botId,
      createdAt: p.createdAt.toISOString(),
      expiresAt: p.expiresAt.toISOString(),
      resultLink: p.resultLink,
      proposal: p,
    })),
    ...rows.flatMap((r): CatchUpCardItem[] => {
      const v = verdicts.get(r.id);
      if (!v?.needed) return [];
      const kind = r.kind as DecisionKind;
      return [
        {
          key: `card:${r.id}`,
          source: "card",
          id: r.id,
          kind,
          subjectId: r.subjectId,
          botId: r.botId,
          title: r.title,
          detail: r.detail,
          nextAction: r.nextAction,
          resultLink: r.resultLink,
          occurrences: r.occurrences,
          createdAt: r.createdAt.toISOString(),
          context: v.context,
          actions: ACTIONS[kind],
        },
      ];
    }),
  ];
  const deadline = (i: CatchUpItem) =>
    i.source === "proposal" ? time(i.expiresAt) : Number.POSITIVE_INFINITY;
  return items.sort((a, b) => {
    const d = deadline(a) - deadline(b);
    // Infinity - Infinity is NaN: two cards without a deadline fall through to age.
    if (d !== 0 && !Number.isNaN(d)) return d;
    return time(a.createdAt) - time(b.createdAt);
  });
}

export function summarize(items: readonly CatchUpItem[]): CatchUpSummary {
  const byBot: Record<string, number> = {};
  for (const i of items) if (i.botId) byBot[i.botId] = (byBot[i.botId] ?? 0) + 1;
  return { count: items.length, byBot };
}
