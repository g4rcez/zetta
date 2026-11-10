import type { Database } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { issueBackgroundActor, type MembershipLookup } from "../identity/access";
import { instanceId } from "../runtime/instance";
import type { ChatService } from "../chat/service";
import type { Claimed, DiscussionStore } from "./store";
import { envNumber } from "../env-number";
import {
  GRACE_MS,
  STUCK_MS,
  lastActivity,
  liveTurns,
  processGone,
  verdict,
  type LiveTurn,
} from "./watchdog";

/** At most this many room turns run at once (one per room); the harness allows the same number of runs per person. */
const concurrency = () => envNumber(process.env.ZETTA_ROOM_CONCURRENCY, 4);

/**
 * Runs queued discussion turns in the background: on the server's 30s tick and right after something is queued (`kick`). At most
 * `concurrency` turns at once and one per room: claimNext checks that in the database, and claims are made one at a time here so two
 * claims never both see a room as idle (this server assumes it is the only instance, like the routine scheduler).
 * A turn woken by the person's own post skips that limit (lane "user"): the person gets an answer at once, as a new instance, even when
 * the bots are busy. Those turns are bounded only by the harness limiter.
 * The same tick looks for turns that stopped making progress (`checkStuck`): see watchdog.ts.
 */
export function createDiscussionWorker(
  db: Database,
  store: DiscussionStore,
  chat: Pick<ChatService, "runDiscussionTurn">,
  lookup: MembershipLookup,
  opts: { concurrency?: number; stuckMs?: number; graceMs?: number } = {},
) {
  let running = 0,
    userRunning = 0,
    lastSweep = 0,
    lastPurge = 0,
    claiming: Promise<unknown> = Promise.resolve();
  const limit = () => opts.concurrency ?? concurrency();
  const name = async (botId: string) =>
    (await db.select({ name: bot.name }).from(bot).where(eq(bot.id, botId)))[0]?.name ?? "A bot";
  const claim = (lane: "any" | "user" = "any") => {
    const next = claiming.then(() => store.claimNext(name, lane)).catch(() => undefined);
    claiming = next;
    return next;
  };

  /** Registers a claimed turn as live. `release` gives its slot back; the slot is freed once, by the run or by the watchdog. */
  function track(c: Claimed, release: () => void): LiveTurn {
    let freed = false;
    const entry: LiveTurn = {
      turnId: c.turn.id,
      attempt: c.turn.attempts,
      claimedAt: Date.now(),
      free: () => {
        if (freed) return;
        freed = true;
        release();
      },
    };
    liveTurns().set(c.turn.id, entry);
    return entry;
  }

  async function run(c: Claimed, entry: LiveTurn) {
    const finish = (status: "failed" | "skipped", reasonCode: string) =>
      store.finishTurn(c.turn.id, status, { reasonCode, attempt: c.turn.attempts });
    try {
      const actor = await issueBackgroundActor(lookup, c.turn.ownerUserId);
      if (!actor) {
        await finish("skipped", "owner_inactive");
        return;
      }
      const hooks = {
        started: (rec: NonNullable<LiveTurn["rec"]>) => {
          entry.rec = rec;
          // The watchdog already took this turn back while it was starting: do not let it run beside its replacement.
          if (entry.abandoned) rec.abort.abort();
        },
      };
      if ((await chat.runDiscussionTurn(actor, c, hooks)) === "busy") return;
    } catch {
      await finish("failed", "error").catch(() => {});
    }
  }

  /** Runs a claimed turn and gives its slot back when it ends (or when the watchdog takes it back). */
  function start(c: Claimed, release: () => void) {
    const entry = track(c, release);
    void run(c, entry).finally(() => {
      if (liveTurns().get(c.turn.id) === entry) liveTurns().delete(c.turn.id);
      entry.free();
    });
  }

  /** Starts every queued turn of the person's own posts now; they take no slot of the limit below. */
  async function pumpUser() {
    for (let c = await claim("user"); c; c = await claim("user")) {
      userRunning++;
      start(c, () => {
        userRunning--;
        void pump();
      });
    }
  }

  /** Fills free slots with claimed turns; each slot keeps pulling until the queue is empty. */
  async function pump() {
    await pumpUser();
    while (running < limit()) {
      running++;
      const c = await claim();
      if (!c) {
        running--;
        return;
      }
      start(c, () => {
        running--;
        void pump();
      });
    }
  }

  /**
   * Takes back the turns of this server that stopped making progress. The database is updated first (guarded by the claim's attempt):
   * only then is the run aborted, so its own ending finds the turn already settled and changes nothing.
   * Turns of an instance that died are left to `store.recover`.
   */
  async function checkStuck(now = new Date()) {
    const live = liveTurns();
    const stuckMs = opts.stuckMs ?? STUCK_MS();
    for (const row of await store.runningOn(instanceId())) {
      const entry = live.get(row.id);
      if (entry && entry.attempt !== row.attempts) continue;
      const claimedAt = row.claimedAt?.getTime() ?? entry?.claimedAt ?? now.getTime();
      const reason = verdict({
        entry,
        claimedAt,
        now: now.getTime(),
        stuckMs,
        graceMs: opts.graceMs ?? GRACE_MS,
        activity: entry?.rec ? await lastActivity(entry.rec) : undefined,
        gone: entry?.rec ? processGone(entry.rec) : undefined,
      });
      if (!reason) continue;
      const settled = await store.settleStuck(row, reason, row.botName).catch(() => undefined);
      if (!settled || !entry) continue;
      entry.abandoned = true;
      entry.rec?.abort.abort();
      live.delete(row.id);
      entry.free();
    }
  }

  return {
    kick: () => {
      void pump();
    },
    checkStuck,
    async tick(now = new Date()) {
      await checkStuck(now).catch(() => {});
      await pump();
      if (now.getTime() - lastSweep > 5 * 60_000) {
        lastSweep = now.getTime();
        await store.sweepIdle(now).catch(() => {});
      }
      if (now.getTime() - lastPurge > 3_600_000) {
        lastPurge = now.getTime();
        await store.purgeSteps(now).catch(() => {});
      }
    },
    /** Test helper: resolves once nothing is running or claimable. */
    async drain(timeoutMs = 20_000) {
      const end = Date.now() + timeoutMs;
      for (;;) {
        await pump();
        await Bun.sleep(5);
        if (running === 0 && userRunning === 0 && !(await store.hasRunnable())) return;
        if (Date.now() > end) throw new Error("drain timeout");
        await Bun.sleep(10);
      }
    },
  };
}
export type DiscussionWorker = ReturnType<typeof createDiscussionWorker>;
