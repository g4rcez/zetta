import type { Database } from "@zetta/db";
import { and, desc, eq, inArray } from "@zetta/db/query";
import { goalLoop } from "@zetta/db/schema/chat";
import { discussion } from "@zetta/db/schema/discussions";
import { raiseAttention } from "../features/attention";
import { AUTONOMY } from "./tools";

export type GoalLoop = typeof goalLoop.$inferSelect;
/** Iterations in a row without new progress (or with an error) before a loop pauses and asks the user. */
export const STALL_LIMIT = 3;

/**
 * Goal loops: a bot works on one approved goal turn after turn until it reports goal_done. Nothing here limits how many turns that takes;
 * a loop only pauses when it stops making progress, keeps failing or needs a person, and the user can stop it at any time.
 */
export function createLoopStore(db: Database) {
  const store = {
    /** Called after a loop starts or resumes (wired to the driver's kick in services.ts). */
    onStart: undefined as ((id: string) => void) | undefined,
    async start(
      ownerUserId: string,
      v: { conversationId: string; botId: string; goal: string; doneWhen: string },
    ) {
      const [row] = await db
        .insert(goalLoop)
        .values({ ownerUserId, ...v })
        .returning();
      store.onStart?.(row!.id);
      return row!;
    },
    async get(id: string) {
      return (await db.select().from(goalLoop).where(eq(goalLoop.id, id)))[0];
    },
    async active(conversationId: string) {
      return (
        await db
          .select()
          .from(goalLoop)
          .where(
            and(
              eq(goalLoop.conversationId, conversationId),
              inArray(goalLoop.status, ["running", "paused"]),
            ),
          )
      )[0];
    },
    /** The conversation's loops, newest first (the banner shows the first one). */
    list(ownerUserId: string, conversationId: string) {
      return db
        .select()
        .from(goalLoop)
        .where(
          and(eq(goalLoop.ownerUserId, ownerUserId), eq(goalLoop.conversationId, conversationId)),
        )
        .orderBy(desc(goalLoop.createdAt))
        .limit(5);
    },
    running() {
      return db.select().from(goalLoop).where(eq(goalLoop.status, "running"));
    },
    /** The bot's own report from inside a loop turn: progress keeps it going, done finishes it. */
    async report(id: string, kind: "progress" | "done", summary: string) {
      await db
        .update(goalLoop)
        .set({
          progress: summary,
          updatedAt: new Date(),
          ...(kind === "done" ? { status: "done" as const, reason: null } : {}),
        })
        .where(and(eq(goalLoop.id, id), eq(goalLoop.status, "running")));
    },
    /** `quiet`: the loop waits for the Chief, not for the user, so no card is raised. */
    async pause(id: string, reason: string, quiet = false) {
      const [row] = await db
        .update(goalLoop)
        .set({ status: "paused", reason, updatedAt: new Date() })
        .where(and(eq(goalLoop.id, id), eq(goalLoop.status, "running")))
        .returning();
      if (row && !quiet) {
        const [room] = await db
          .select({ id: discussion.id })
          .from(discussion)
          .where(eq(discussion.conversationId, row.conversationId));
        await raiseAttention(db, row.ownerUserId, {
          botId: row.botId,
          title: "A loop paused and needs you",
          detail: `${row.goal.slice(0, 200)}: ${reason}`,
          nextAction: room
            ? "Open the room, then resume or stop the loop."
            : "Open the chat, then resume or stop the loop.",
          resultLink: room ? `/discussions?id=${room.id}` : `/chat/${row.conversationId}`,
          source: "bot",
          sourceKey: `loop:${row.id}`,
        });
      }
      return row;
    },
    /** The Chief answered a blocked loop: the answer joins the progress, which the next step reads, and the loop goes on. */
    async resumeWith(id: string, answer: string) {
      const loop = await store.get(id);
      if (!loop || loop.status !== "paused") return;
      const [row] = await db
        .update(goalLoop)
        .set({
          status: "running",
          stalls: 0,
          reason: null,
          progress: `${loop.progress}\nThe Chief answered your question: ${answer}`
            .trim()
            .slice(-2000),
          updatedAt: new Date(),
        })
        .where(and(eq(goalLoop.id, id), eq(goalLoop.status, "paused")))
        .returning();
      if (row) store.onStart?.(row.id);
    },
    /** Owner actions from the banner. Resume clears the stall count so the loop gets a fresh run of attempts. */
    async setStatus(ownerUserId: string, id: string, to: "running" | "cancelled") {
      const [row] = await db
        .update(goalLoop)
        .set({
          status: to,
          updatedAt: new Date(),
          ...(to === "running" ? { stalls: 0, reason: null } : { reason: "stopped by you" }),
        })
        .where(
          and(
            eq(goalLoop.id, id),
            eq(goalLoop.ownerUserId, ownerUserId),
            inArray(goalLoop.status, to === "running" ? ["paused"] : ["running", "paused"]),
          ),
        )
        .returning();
      if (row && to === "running") store.onStart?.(row.id);
      return row;
    },
    async finishIteration(id: string, patch: { iterations: number; stalls: number }) {
      await db
        .update(goalLoop)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(goalLoop.id, id));
    },
    async end(id: string, status: "cancelled" | "failed", reason: string) {
      await db
        .update(goalLoop)
        .set({ status, reason, updatedAt: new Date() })
        .where(and(eq(goalLoop.id, id), inArray(goalLoop.status, ["running", "paused"])));
    },
  };
  return store;
}
export type LoopStore = ReturnType<typeof createLoopStore>;

/** One iteration as a chat turn in the loop's conversation, run as its owner. */
export type LoopTurn = (
  loop: GoalLoop,
  label: string,
  prompt: string,
  requestKey: string,
) => Promise<{ status: string }>;

export function loopPrompt(loop: GoalLoop, step: number) {
  return `You are working on a goal the user approved as a loop (step ${step}). Keep going with your tools; there is no limit on steps, only on making progress.
Goal: ${loop.goal}
Done when: ${loop.doneWhen}
Progress so far: ${loop.progress || "nothing yet, this is the first step"}

Do the next part of the work now. End your reply with exactly one of these blocks:
\`\`\`zetta:goal_progress
{"summary":"what is done now and what is left"}
\`\`\`   (keeps the loop going: you are called again with this summary)
\`\`\`zetta:goal_done
{"summary":"the result, written for the user"}
\`\`\`   (only when "done when" is met)
${AUTONOMY} The loop waits for the user after a handoff.`;
}

/**
 * The facilitator's part of a loop in a room with more than one bot. A step ends when the room is quiet, which happens when the
 * facilitator posts without mentioning anyone, so that is also when it reports.
 */
export function roomLoopPrompt(loop: GoalLoop, step: number) {
  return `The team is pursuing a goal the user approved as a loop (step ${step}). There is no limit on steps, only on making progress.
Goal: ${loop.goal}
Done when: ${loop.doneWhen}
Progress so far: ${loop.progress || "nothing yet, this is the first step"}

Discuss with the members how to reach the goal and hand each part of the work to the member who fits best with an @mention. While members still owe you an answer, mention them and do not report yet. When their answers are in and this step is settled, reply WITHOUT mentioning anyone and end with exactly one of these blocks:
\`\`\`zetta:goal_progress
{"summary":"what the team did in this step and what is left"}
\`\`\`   (keeps the loop going: you are called again for the next step)
\`\`\`zetta:goal_done
{"summary":"the result, written for the user"}
\`\`\`   (only when "done when" is met)
${AUTONOMY} The loop waits for the user after a handoff.`;
}

/**
 * Drives running loops: one iteration at a time per loop, each a chat turn. Kicked when a loop starts or resumes, and on the server tick
 * so loops continue after a restart. The set of loops being driven lives on globalThis, so a `bun --hot` reload does not start a second
 * driver for a loop the old module is still running.
 */
export function createLoopDriver(store: LoopStore, runTurn: LoopTurn) {
  const g = globalThis as { zettaLoops?: Set<string> };
  const driving = (g.zettaLoops ??= new Set());

  async function drive(id: string) {
    if (driving.has(id)) return;
    driving.add(id);
    try {
      for (;;) {
        const loop = await store.get(id);
        if (!loop || loop.status !== "running") return;
        const step = loop.iterations + 1;
        let status: string;
        try {
          ({ status } = await runTurn(
            loop,
            `↻ Loop step ${step}: ${loop.goal.slice(0, 120)}`,
            loopPrompt(loop, step),
            `loop:${id}:${step}`,
          ));
        } catch (e) {
          status =
            e instanceof Error && e.message === "owner_inactive" ? "owner_inactive" : "failed";
        }
        const after = await store.get(id);
        if (!after) return;
        if (status === "owner_inactive") {
          await store.end(id, "failed", "the owner's account is not active");
          return;
        }
        if (status === "cancelled") {
          await store.end(id, "cancelled", "stopped by you");
          return;
        }
        const progressed = status === "complete" && after.progress !== loop.progress;
        const stalls = progressed || after.status === "done" ? 0 : after.stalls + 1;
        await store.finishIteration(id, { iterations: step, stalls });
        if (after.status !== "running") return; // done, or paused by a hand-off during the turn
        if (stalls >= STALL_LIMIT)
          await store.pause(
            id,
            status === "complete"
              ? `no new progress in the last ${STALL_LIMIT} steps`
              : `the last ${STALL_LIMIT} steps failed`,
          );
      }
    } finally {
      driving.delete(id);
    }
  }

  return {
    kick(id: string) {
      void drive(id).catch(() => {});
    },
    /** Picks up loops left running by a previous process. */
    async tick() {
      for (const l of await store.running())
        if (!driving.has(l.id)) void drive(l.id).catch(() => {});
    },
  };
}
