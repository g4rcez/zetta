import type { Database } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { issueBackgroundActor, type MembershipLookup } from "../identity/access";
import type { ChatService } from "../chat/service";
import type { Claimed, DiscussionStore } from "./store";

const CONCURRENCY = 2;

/**
 * Runs queued discussion turns in the background: on the server's 30s tick and right after something is queued (`kick`). At most
 * CONCURRENCY turns at once and one per owner: claimNext checks that in the database, and claims are made one at a time here so two
 * claims never both see an owner as idle (this server assumes it is the only instance, like the routine scheduler).
 */
export function createDiscussionWorker(db: Database, store: DiscussionStore, chat: Pick<ChatService, "runDiscussionTurn">, lookup: MembershipLookup) {
  let running = 0, lastSweep = 0, claiming: Promise<unknown> = Promise.resolve();
  const name = async (botId: string) => (await db.select({ name: bot.name }).from(bot).where(eq(bot.id, botId)))[0]?.name ?? "A bot";
  const claim = () => { const next = claiming.then(() => store.claimNext(name)).catch(() => undefined); claiming = next; return next; };

  async function run(c: Claimed) {
    try {
      const actor = await issueBackgroundActor(lookup, c.turn.ownerUserId);
      if (!actor) { await store.finishTurn(c.turn.id, "skipped", { reasonCode: "owner_inactive" }); return; }
      if (await chat.runDiscussionTurn(actor, c) === "busy") return;
    } catch { await store.finishTurn(c.turn.id, "failed", { reasonCode: "error" }).catch(() => {}); }
  }

  /** Fills free slots with claimed turns; each slot keeps pulling until the queue is empty. */
  async function pump() {
    while (running < CONCURRENCY) {
      running++;
      const c = await claim();
      if (!c) { running--; return; }
      void run(c).finally(() => { running--; void pump(); });
    }
  }

  return {
    kick: () => { void pump(); },
    async tick(now = new Date()) {
      await pump();
      if (now.getTime() - lastSweep > 5 * 60_000) { lastSweep = now.getTime(); await store.sweepIdle(now).catch(() => {}); }
    },
    /** Test helper: resolves once nothing is running or claimable. */
    async drain(timeoutMs = 20_000) {
      const end = Date.now() + timeoutMs;
      for (;;) {
        await pump(); await Bun.sleep(5);
        if (running === 0 && !(await store.hasRunnable())) return;
        if (Date.now() > end) throw new Error("drain timeout");
        await Bun.sleep(10);
      }
    },
  };
}
export type DiscussionWorker = ReturnType<typeof createDiscussionWorker>;
