import { uuidv7 } from "@zetta/core/uuid";
export class TurnBusyError extends Error {
  constructor() {
    super("TURN_BUSY");
  }
}

export type TurnRecord<E> = {
  id: string;
  key: string;
  /** When the turn started (ms since epoch). */
  startedAt: number;
  events: E[];
  done: boolean;
  /** When the turn last produced an event (or started): a long silence means it waits on something slow. */
  lastEventAt: number;
  error?: unknown;
  abort: AbortController;
  /** Resolves when the first event exists or the turn failed/finished before emitting anything. */
  ready: Promise<void>;
  /** Resolves once the turn is done (success, failure or cancel). */
  finished: Promise<void>;
  waiters: Set<() => void>;
};

/**
 * In-process registry of running chat turns, one per key (conversation). A turn runs to completion independently of any HTTP
 * connection: clients follow it by cursor (`after`) and may reconnect; only an explicit cancel aborts it. Finished turns stay
 * resumable for `ttlMs`, after which the persisted messages are the source of truth.
 */
export function createTurnRegistry<E>(
  ttlMs = 120_000,
  maxEvents = 5000,
  /** Past `maxEvents` only these are dropped. The default drops text deltas: the final `message` event carries the full text. */
  droppable: (event: E) => boolean = (e) => (e as { type?: unknown } | null)?.type === "delta",
) {
  const turns = new Map<string, TurnRecord<E>>();
  return {
    start(key: string, work: (signal: AbortSignal) => AsyncGenerator<E, void>): TurnRecord<E> {
      const current = turns.get(key);
      if (current && !current.done) throw new TurnBusyError();
      let markReady!: () => void;
      let markFinished!: () => void;
      const rec: TurnRecord<E> = {
        id: uuidv7(),
        key,
        startedAt: Date.now(),
        events: [],
        done: false,
        lastEventAt: Date.now(),
        abort: new AbortController(),
        ready: new Promise<void>((r) => {
          markReady = r;
        }),
        finished: new Promise<void>((r) => {
          markFinished = r;
        }),
        waiters: new Set(),
      };
      turns.set(key, rec);
      const wake = () => {
        // oxlint-disable-next-line unicorn/no-useless-spread
        for (const w of [...rec.waiters]) w();
      };
      void (async () => {
        try {
          for await (const ev of work(rec.abort.signal)) {
            if (rec.events.length < maxEvents || !droppable(ev)) rec.events.push(ev);
            rec.lastEventAt = Date.now();
            markReady();
            wake();
          }
        } catch (e) {
          rec.error = e;
        }
        rec.done = true;
        markReady();
        markFinished();
        wake();
        setTimeout(() => {
          if (turns.get(key) === rec) turns.delete(key);
        }, ttlMs).unref?.();
      })();
      return rec;
    },
    get: (key: string) => turns.get(key),
    running: () => [...turns.values()].filter((r) => !r.done),
    cancel(key: string) {
      const r = turns.get(key);
      if (!r || r.done) return false;
      r.abort.abort();
      return true;
    },
    /** Cancels the turn of `key` and every parallel turn under it (`key:<turn id>`, room turns started by a person's post). */
    cancelAll(key: string) {
      let any = false;
      for (const [k, r] of turns)
        if ((k === key || k.startsWith(`${key}:`)) && !r.done) {
          r.abort.abort();
          any = true;
        }
      return any;
    },
    /** Cancels every running turn whose key starts with `prefix` (`<userId>:` stops all of one person's turns). Returns how many. */
    cancelPrefix(prefix: string) {
      let n = 0;
      for (const [k, r] of turns)
        if (k.startsWith(prefix) && !r.done) {
          r.abort.abort();
          n++;
        }
      return n;
    },
    /** Yields events with index > after (1-based cursor), waiting for new ones until the turn is done. */
    async *follow(rec: TurnRecord<E>, after = 0): AsyncGenerator<{ n: number; event: E }, void> {
      let i = Math.max(0, after);
      for (;;) {
        while (i < rec.events.length) {
          yield { n: i + 1, event: rec.events[i]! };
          i++;
        }
        if (rec.done) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let wake!: () => void;
        await new Promise<void>((res) => {
          wake = res;
          rec.waiters.add(res);
          timer = setTimeout(res, 15_000);
        }).finally(() => {
          clearTimeout(timer);
          rec.waiters.delete(wake); // only this follower's waiter: others keep theirs
        });
      }
    },
  };
}

/**
 * Runs async generators side by side and yields their events as they arrive. Each generator keeps its own order (one `next()` is in
 * flight per generator), and the return value holds every generator's result, in input order. If the consumer stops early, or one
 * generator throws, the rest are closed (each runs its own `finally`) before this one ends.
 */
export async function* mergeAll<T, R>(gens: AsyncGenerator<T, R>[]): AsyncGenerator<T, R[]> {
  const results = Array.from({ length: gens.length }) as R[];
  const inFlight = new Map<number, Promise<{ i: number; r: IteratorResult<T, R> }>>();
  const step = (i: number) => gens[i]!.next().then((r) => ({ i, r }));
  gens.forEach((_, i) => inFlight.set(i, step(i)));
  try {
    while (inFlight.size) {
      const { i, r } = await Promise.race(inFlight.values());
      if (r.done) {
        results[i] = r.value;
        inFlight.delete(i);
      } else {
        inFlight.set(i, step(i));
        yield r.value;
      }
    }
    return results;
  } finally {
    // A step still in flight settles on its own; swallow it here so a late failure is not an unhandled rejection.
    for (const p of inFlight.values()) p.catch(() => {});
    await Promise.allSettled([...inFlight.keys()].map((i) => gens[i]!.return(undefined as never)));
  }
}
