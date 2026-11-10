import { lastOutputAt } from "../chat/step-output";
import { runsOf } from "../chat/processes";
import { envNumber } from "../env-number";

/**
 * Finds room turns that stopped without ending, so the worker can take them back. A bot's run has no deadline (it may work for days),
 * so the only honest signal is silence: no event of the turn and no output of its commands for a long time, or no process left.
 */

/** Why a turn counts as stuck: its run is gone, it never got to start, or it went quiet. */
export type StuckReason = "gone" | "never_started" | "silent";

/** The part of a turn record the watchdog reads. */
export type RunLike = { abort: AbortController; lastEventAt: number; done: boolean };

/** A turn this server claimed and is running now. `free` gives its worker slot back, once. */
export type LiveTurn = {
  turnId: string;
  attempt: number;
  claimedAt: number;
  rec?: RunLike | undefined;
  /** The watchdog took the turn back: a run that starts late is aborted at once. */
  abandoned?: boolean | undefined;
  free: () => void;
};

/** Kept on `globalThis`: a `bun --hot` reload rebuilds the turn registry, and runs started by the old module must stay known. */
export function liveTurns(): Map<string, LiveTurn> {
  const g = globalThis as { zettaRoomTurns?: Map<string, LiveTurn> };
  return (g.zettaRoomTurns ??= new Map());
}

export const STUCK_MS = () => envNumber(process.env.ZETTA_ROOM_STUCK_MS, 10 * 60_000);
/** A claim, or a run whose process just ended, is not judged until this long has passed. */
export const GRACE_MS = 60_000;

/** The last sign of life: the turn's last event or the last time one of its commands printed. */
export async function lastActivity(rec: RunLike): Promise<number> {
  return Math.max(rec.lastEventAt, (await lastOutputAt(rec.abort.signal)) ?? 0);
}

/** True when the turn's CLI was started and none of its processes is left. EPERM means the process exists. */
export function processGone(rec: RunLike): boolean {
  const runs = runsOf(rec.abort.signal);
  if (!runs.length) return false;
  return runs.every((r) => {
    try {
      process.kill(r.pid, 0);
      return false;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code !== "EPERM";
    }
  });
}

export type VerdictInput = {
  entry?: Pick<LiveTurn, "rec"> | undefined;
  /** When the database says the turn was claimed (ms since epoch). */
  claimedAt: number;
  now: number;
  stuckMs: number;
  graceMs: number;
  /** Last sign of life of the run (`lastActivity`). */
  activity?: number | undefined;
  /** `processGone` of the run. */
  gone?: boolean | undefined;
};

/** The rules, in order. Undefined means the turn is fine. */
export function verdict(i: VerdictInput): StuckReason | undefined {
  // A turn this server claimed but holds no run for: the run died with a reload or crashed before it registered.
  if (!i.entry) return i.now - i.claimedAt > i.graceMs ? "gone" : undefined;
  // Claimed and still preparing: the prompt is built before the run starts, and it never takes minutes.
  if (!i.entry.rec) return i.now - i.claimedAt > i.stuckMs ? "never_started" : undefined;
  const last = i.activity ?? i.claimedAt;
  if (i.gone && i.now - last > i.graceMs) return "gone";
  // A command that is still printing keeps `activity` fresh, so it is never judged silent.
  if (i.now - last > i.stuckMs) return "silent";
  return undefined;
}
