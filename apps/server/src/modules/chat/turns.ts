import { uuidv7 } from "@zetta/core/uuid";
export class TurnBusyError extends Error { constructor() { super("TURN_BUSY"); } }

export type TurnRecord<E> = {
  id: string; key: string; events: E[]; done: boolean; error?: unknown; abort: AbortController;
  /** Resolves when the first event exists or the turn failed/finished before emitting anything. */
  ready: Promise<void>;
  waiters: Set<() => void>;
};

/**
 * In-process registry of running chat turns, one per key (conversation). A turn runs to completion independently of any HTTP
 * connection: clients follow it by cursor (`after`) and may reconnect; only an explicit cancel aborts it. Finished turns stay
 * resumable for `ttlMs`, after which the persisted messages are the source of truth.
 */
export function createTurnRegistry<E>(ttlMs = 120_000, maxEvents = 5000) {
  const turns = new Map<string, TurnRecord<E>>();
  return {
    start(key: string, work: (signal: AbortSignal) => AsyncGenerator<E, void>): TurnRecord<E> {
      const current = turns.get(key);
      if (current && !current.done) throw new TurnBusyError();
      let markReady!: () => void;
      const rec: TurnRecord<E> = { id: uuidv7(), key, events: [], done: false, abort: new AbortController(), ready: new Promise<void>((r) => { markReady = r; }), waiters: new Set() };
      turns.set(key, rec);
      const wake = () => { for (const w of [...rec.waiters]) w(); };
      void (async () => {
        try {
          for await (const ev of work(rec.abort.signal)) { if (rec.events.length < maxEvents) rec.events.push(ev); markReady(); wake(); }
        } catch (e) { rec.error = e; }
        rec.done = true; markReady(); wake();
        setTimeout(() => { if (turns.get(key) === rec) turns.delete(key); }, ttlMs).unref?.();
      })();
      return rec;
    },
    get: (key: string) => turns.get(key),
    cancel(key: string) { const r = turns.get(key); if (!r || r.done) return false; r.abort.abort(); return true; },
    /** Yields events with index > after (1-based cursor), waiting for new ones until the turn is done. */
    async *follow(rec: TurnRecord<E>, after = 0): AsyncGenerator<{ n: number; event: E }, void> {
      let i = Math.max(0, after);
      for (;;) {
        while (i < rec.events.length) { yield { n: i + 1, event: rec.events[i]! }; i++; }
        if (rec.done) return;
        await new Promise<void>((res) => { rec.waiters.add(res); setTimeout(res, 15_000); }).finally(() => undefined);
        rec.waiters.clear();
      }
    },
  };
}
