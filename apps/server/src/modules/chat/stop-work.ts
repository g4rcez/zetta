import type { Database } from "@zetta/db";
import { and, eq, inArray } from "@zetta/db/query";
import { chatQueue, conversation } from "@zetta/db/schema/chat";
import { discussion, discussionTurn } from "@zetta/db/schema/discussions";
import { task } from "@zetta/db/schema/tasks";

import type { ActiveActor } from "../identity/access";

/**
 * "Stop" means one thing wherever it is asked: the Stop button, the word typed in the chat ("stop", "para"), and later the room and
 * routine controls. Stopping a chat ends the reply that is running AND everything that would otherwise carry the work on behind the
 * person's back: the messages that waited (they are held, shown, and sent again only when the person says so), the bot's followed
 * tasks, the goal loops, and the rooms this chat opened that are still working.
 *
 * "Pause everything" is not this: it must bring everything back on resume, so it keeps its own path (`setAgentsState`).
 */
export type StopWorkDeps = {
  db: Database;
  /** Aborts the running turns of one conversation (and its parallel room turns). True when something was running. */
  cancelTurns(userId: string, conversationId: string): boolean;
  loops?:
    | {
        activeAll(conversationId: string): Promise<{ id: string }[]>;
        setStatus(ownerUserId: string, id: string, to: "running" | "cancelled"): Promise<unknown>;
      }
    | undefined;
  tasks?:
    | {
        pauseFollowUps(
          ownerUserId: string,
          botId: string,
          conversationId: string,
          reason: string,
        ): Promise<unknown>;
      }
    | undefined;
  rooms?: { silence(a: ActiveActor, id: string): Promise<{ conversationId: string }> } | undefined;
  /** Tells the person's open pages that the chat changed. */
  changed(userId: string, conversationId: string): void;
};

export type Stopped = {
  /** A reply was running and was ended. */
  cancelled: boolean;
  /** Waiting messages that are now held (message ids, oldest first). */
  held: string[];
  /** Goal loops that were ended. */
  loops: number;
  /** Rooms opened from this chat that were working and are now silent. */
  rooms: string[];
};

export function createStopWork(d: StopWorkDeps) {
  /** Rooms this chat opened that have a turn waiting or running right now. A quiet room is left alone: it is not "the work". */
  async function workingRooms(userId: string, conversationId: string) {
    return d.db
      .selectDistinct({ id: discussion.id })
      .from(discussion)
      .innerJoin(discussionTurn, eq(discussionTurn.discussionId, discussion.id))
      .where(
        and(
          eq(discussion.ownerUserId, userId),
          eq(discussion.originConversationId, conversationId),
          inArray(discussion.status, ["open", "stalled"]),
          inArray(discussionTurn.status, ["queued", "running"]),
        ),
      );
  }

  return {
    /**
     * True when a chat with no reply running still has work going on behind it: a goal loop between two steps, a task its bot is
     * called back for, a room it opened that is working. "stop" typed then is still a stop.
     */
    async hasWork(userId: string, conversationId: string): Promise<boolean> {
      if ((await d.loops?.activeAll(conversationId))?.length) return true;
      const [followed] = await d.db
        .select({ id: task.id })
        .from(task)
        .where(
          and(
            eq(task.ownerUserId, userId),
            eq(task.conversationId, conversationId),
            eq(task.followUp, "auto"),
          ),
        )
        .limit(1);
      if (followed) return true;
      return d.rooms ? (await workingRooms(userId, conversationId)).length > 0 : false;
    },
    /** Stops the work of one chat. The caller has already checked that the actor may use the conversation. */
    async conversation(actor: ActiveActor, conversationId: string): Promise<Stopped> {
      // Held first: the reply that is about to end kicks the queue, and it must find nothing to run.
      const held = await d.db
        .update(chatQueue)
        .set({ status: "held", reasonCode: "stopped" })
        .where(
          and(
            eq(chatQueue.conversationId, conversationId),
            eq(chatQueue.ownerUserId, actor.userId),
            eq(chatQueue.status, "pending"),
          ),
        )
        .returning({ messageId: chatQueue.messageId, createdAt: chatQueue.createdAt });
      let loops = 0;
      for (const loop of (await d.loops?.activeAll(conversationId)) ?? []) {
        await d.loops?.setStatus(actor.userId, loop.id, "cancelled");
        loops++;
      }
      const cancelled = d.cancelTurns(actor.userId, conversationId);
      // The end of a stopped reply pauses the followed tasks too (see `settleFollowUps`); this covers a stop between two check-ins,
      // when no reply is running.
      const [conv] = await d.db
        .select({ botId: conversation.botId })
        .from(conversation)
        .where(eq(conversation.id, conversationId));
      if (conv?.botId)
        await d.tasks?.pauseFollowUps(actor.userId, conv.botId, conversationId, "stopped by you");
      const rooms: string[] = [];
      for (const room of d.rooms ? await workingRooms(actor.userId, conversationId) : []) {
        // A room that closed in the meantime is already quiet: nothing to stop.
        const silenced = await d.rooms!.silence(actor, room.id).catch(() => undefined);
        if (!silenced) continue;
        d.cancelTurns(actor.userId, silenced.conversationId);
        rooms.push(room.id);
      }
      d.changed(actor.userId, conversationId);
      return {
        cancelled,
        held: held
          .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((h) => h.messageId),
        loops,
        rooms,
      };
    },
  };
}
export type StopWork = ReturnType<typeof createStopWork>;
