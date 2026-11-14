import {
  ACTIONS,
  isDecisionKind,
  QUEUE_KINDS,
  type DecisionKind,
} from "@zetta/core/attention-kinds";
import { mentionToken } from "@zetta/core/mentions";
import type { Database } from "@zetta/db";
import { and, desc, eq, inArray } from "@zetta/db/query";
import { bot, goalLoop } from "@zetta/db/schema/chat";
import { attentionItem, routineTrigger } from "@zetta/db/schema/features";
import { inboundRoute } from "@zetta/db/schema/inbound";
import { memorySuggestion } from "@zetta/db/schema/memory";
import { task } from "@zetta/db/schema/tasks";
import type { ChatService } from "../chat/service";
import type { LoopStore } from "../chat/loops";
import type { DiscussionStore } from "../discussions/store";
import { closeAttentionIds } from "../features/attention";
import type { FeaturesService } from "../features/service";
import { AccessError, type ActiveActor } from "../identity/access";
import type { InboundService } from "../inbound/service";
import type { Memory } from "../memory/service";
import type { TaskStore } from "../tasks/store";
import { judge } from "./queue";

export type ActDeps = {
  db: Database;
  tasks: TaskStore;
  loops: LoopStore;
  discussions: DiscussionStore;
  memory: Memory;
  chat: Pick<ChatService, "sendMessage" | "setLoop" | "cancelTurn">;
  features: Pick<FeaturesService, "routines" | "routineTriggers" | "workflows">;
  inbound: Pick<InboundService, "setRoute">;
};

/** The person asked for something this card does not offer (wrong action, missing or unexpected text). */
export class CatchUpError extends Error {
  constructor(
    readonly code: "NOT_AN_ACTION" | "INPUT_REQUIRED" | "NO_SUBJECT" | "UNSUPPORTED",
    message: string,
  ) {
    super(message);
  }
}

const TEXT_MAX = 4000;
/** How long a re-run is watched for an immediate refusal (agents paused, workflow gone) before it is left to finish on its own. */
const RUN_GRACE_MS = 2000;

/**
 * Acts on a decision card, or denies it. Every path checks that the card is the caller's and still open, runs the domain function the
 * card's kind names (see `ACTIONS`), and only then closes the card: a refusal from the domain leaves it in the queue.
 */
export function createCatchUpActions(deps: ActDeps) {
  const { db, tasks, loops, discussions, memory, chat, features, inbound } = deps;

  async function load(actor: ActiveActor, id: string) {
    const [row] = await db
      .select()
      .from(attentionItem)
      .where(
        and(
          eq(attentionItem.id, id),
          eq(attentionItem.ownerUserId, actor.userId),
          inArray(attentionItem.status, ["open", "acknowledged"]),
          inArray(attentionItem.kind, [...QUEUE_KINDS]),
        ),
      );
    if (!row || !isDecisionKind(row.kind)) throw new AccessError("NOT_FOUND");
    return { row, kind: row.kind };
  }

  const subjectOf = (row: { subjectId: string | null }) => {
    if (!row.subjectId)
      throw new CatchUpError("NO_SUBJECT", "This card does not say what it is about. Dismiss it.");
    return row.subjectId;
  };

  /** The oldest-first list of open suggestions on a page: the one shown on the card is the newest. */
  async function newestSuggestion(actor: ActiveActor, pageId: string) {
    const [s] = await db
      .select({ id: memorySuggestion.id })
      .from(memorySuggestion)
      .where(
        and(
          eq(memorySuggestion.pageId, pageId),
          eq(memorySuggestion.pageOwnerUserId, actor.userId),
          eq(memorySuggestion.status, "open"),
        ),
      )
      .orderBy(desc(memorySuggestion.createdAt))
      .limit(1);
    if (!s) throw new AccessError("NOT_FOUND");
    return s.id;
  }

  /** A re-run can take as long as the workflow does: it is watched briefly for a refusal and then left to finish. */
  async function startRun(run: Promise<unknown>) {
    const early = await Promise.race([
      run.then(
        () => null,
        (e: unknown) => e,
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RUN_GRACE_MS)),
    ]);
    if (early) throw early;
  }

  async function nudge(actor: ActiveActor, roomId: string, botId: string | null, text: string) {
    const [b] = botId ? await db.select({ name: bot.name }).from(bot).where(eq(bot.id, botId)) : [];
    await discussions.postAsOwner(
      actor,
      roomId,
      b && botId ? `${mentionToken("bot", botId, b.name)} ${text}` : text,
    );
  }

  async function ownedLoop(actor: ActiveActor, id: string) {
    const [l] = await db
      .select({ id: goalLoop.id })
      .from(goalLoop)
      .where(and(eq(goalLoop.id, id), eq(goalLoop.ownerUserId, actor.userId)));
    if (!l) throw new AccessError("NOT_FOUND");
  }

  async function runAction(
    actor: ActiveActor,
    row: typeof attentionItem.$inferSelect,
    kind: DecisionKind,
    text: string,
  ) {
    switch (kind) {
      case "task_ask": {
        const taskId = subjectOf(row);
        if (text) {
          const [t] = await db
            .select({ conversationId: task.conversationId })
            .from(task)
            .where(eq(task.id, taskId));
          if (!t?.conversationId)
            throw new CatchUpError("UNSUPPORTED", "This task has no chat to answer in.");
          await chat.sendMessage(actor, t.conversationId, text);
        }
        await tasks.update(actor, taskId, { status: "done" });
        return;
      }
      case "task_follow":
        await tasks.update(actor, subjectOf(row), { followUp: "auto" });
        return;
      case "loop_paused": {
        const loopId = subjectOf(row);
        if (text) {
          await ownedLoop(actor, loopId);
          await loops.resumeWith(loopId, text);
        } else await chat.setLoop(actor, loopId, "running");
        return;
      }
      case "room_stuck":
      case "room_failed":
        await nudge(actor, subjectOf(row), row.botId, text);
        return;
      case "room_interrupted":
        await discussions.setStatus(actor, subjectOf(row), "resume");
        return;
      case "permission_request":
        await discussions.postAsOwner(actor, subjectOf(row), text);
        return;
      case "routine_failed":
      case "routine_interrupted":
        await features.routines.runNow(actor, subjectOf(row), `catch-up:${row.id}`, "background");
        return;
      case "routine_blocked":
        await features.routines.setPaused(actor, subjectOf(row), false);
        return;
      case "trigger_failing": {
        const triggerId = subjectOf(row);
        const [t] = await db
          .select({ routineId: routineTrigger.routineId })
          .from(routineTrigger)
          .where(
            and(eq(routineTrigger.id, triggerId), eq(routineTrigger.ownerUserId, actor.userId)),
          );
        if (!t) throw new AccessError("NOT_FOUND");
        await features.routineTriggers.setStatus(actor, t.routineId, triggerId, "active");
        return;
      }
      case "workflow_failed":
      case "workflow_interrupted":
        // The input of the failed run is not kept, so the run starts with none.
        await startRun(features.workflows.run(actor, subjectOf(row), "", `catch-up:${row.id}`));
        return;
      case "inbound_stopped": {
        const [r] = await db
          .select()
          .from(inboundRoute)
          .where(
            and(eq(inboundRoute.id, subjectOf(row)), eq(inboundRoute.ownerUserId, actor.userId)),
          );
        if (!r) throw new AccessError("NOT_FOUND");
        await inbound.setRoute(actor, r.botId, r.pluginId, {
          enabled: true,
          filter: r.filter,
          pollEverySeconds: r.pollEverySeconds,
        });
        return;
      }
      case "memory_suggestion":
        await memory.decide(actor.userId, await newestSuggestion(actor, subjectOf(row)), "accept");
        return;
      // The person went to look: there is nothing to run, the card only needs to leave the queue.
      case "sign_in":
      case "inbound_unanswered":
      case "inbound_rate":
      case "bot_ask":
        return;
      case "connection_lost":
        throw new CatchUpError("NOT_AN_ACTION", "Reconnecting happens in the browser, not here.");
      case "proposal":
        throw new CatchUpError("NOT_AN_ACTION", "Approvals are decided from their own card.");
    }
  }

  async function runDeny(
    actor: ActiveActor,
    row: typeof attentionItem.$inferSelect,
    kind: DecisionKind,
  ) {
    switch (kind) {
      case "task_ask":
        // Only the owner can delete a task. An assignee who is not the owner just dismisses the card.
        await tasks.remove(actor, subjectOf(row)).catch((e: unknown) => {
          if (!(e instanceof AccessError)) throw e;
        });
        return;
      case "task_follow":
        await tasks.update(actor, subjectOf(row), { followUp: "off" });
        return;
      case "loop_paused":
        await chat.setLoop(actor, subjectOf(row), "cancelled");
        return;
      case "room_stuck":
      case "room_failed":
      case "room_interrupted": {
        // Same as the room's own Cancel: close it, then stop whatever its bots are still running.
        const room = await discussions.setStatus(actor, subjectOf(row), "cancel");
        await chat.cancelTurn(actor, room.conversationId);
        return;
      }
      case "permission_request":
        await discussions.postAsOwner(actor, subjectOf(row), "I deny this request.");
        return;
      case "routine_failed":
        await features.routines.setPaused(actor, subjectOf(row), true);
        return;
      case "trigger_failing": {
        const triggerId = subjectOf(row);
        const [t] = await db
          .select({ routineId: routineTrigger.routineId })
          .from(routineTrigger)
          .where(
            and(eq(routineTrigger.id, triggerId), eq(routineTrigger.ownerUserId, actor.userId)),
          );
        if (!t) throw new AccessError("NOT_FOUND");
        await features.routineTriggers.setStatus(actor, t.routineId, triggerId, "paused");
        return;
      }
      case "memory_suggestion":
        await memory.decide(actor.userId, await newestSuggestion(actor, subjectOf(row)), "reject");
        return;
      // Nothing to undo: leaving it off, dismissing it or letting a paused routine stay paused is just closing the card.
      case "routine_blocked":
      case "routine_interrupted":
      case "workflow_failed":
      case "workflow_interrupted":
      case "inbound_stopped":
      case "inbound_unanswered":
      case "inbound_rate":
      case "sign_in":
      case "connection_lost":
      case "bot_ask":
      case "proposal":
        return;
    }
  }

  /** A memory page can hold several suggestions: after one is decided the card stays if more wait, so the queue decides, not this call. */
  async function settle(
    actor: ActiveActor,
    row: typeof attentionItem.$inferSelect,
    kind: DecisionKind,
    status: "resolved" | "cancelled",
  ) {
    if (kind === "memory_suggestion") {
      const verdict = (await judge(db, actor.userId, [row])).get(row.id);
      if (verdict?.needed) return;
      await closeAttentionIds(db, actor.userId, [row.id], "resolved");
      return;
    }
    await closeAttentionIds(db, actor.userId, [row.id], status);
  }

  return {
    async act(actor: ActiveActor, id: string, input: { text?: string | undefined }) {
      const { row, kind } = await load(actor, id);
      const text = (input.text ?? "").trim().slice(0, TEXT_MAX);
      const mode = ACTIONS[kind].input;
      if (mode === "text" && !text)
        throw new CatchUpError("INPUT_REQUIRED", `${ACTIONS[kind].actLabel} needs a message.`);
      if (mode === "none" && text)
        throw new CatchUpError("UNSUPPORTED", `${ACTIONS[kind].actLabel} does not take a message.`);
      await runAction(actor, row, kind, text);
      await settle(actor, row, kind, "resolved");
      return { ok: true as const };
    },
    async deny(actor: ActiveActor, id: string) {
      const { row, kind } = await load(actor, id);
      await runDeny(actor, row, kind);
      await settle(actor, row, kind, "cancelled");
      return { ok: true as const };
    },
  };
}

export type CatchUpActions = ReturnType<typeof createCatchUpActions>;
