import { describe, expect, test } from "bun:test";
import { TurnBusyError, createTurnRegistry, mergeAll } from "./turns";

async function* gen(items: string[], delay = 5): AsyncGenerator<string> {
  for (const i of items) {
    await Bun.sleep(delay);
    yield i;
  }
}
const collect = async <E>(it: AsyncGenerator<{ n: number; event: E }>) => {
  const out: { n: number; event: E }[] = [];
  for await (const x of it) out.push(x);
  return out;
};

describe("turn registry", () => {
  test("a turn keeps running without any follower and can be followed late from a cursor", async () => {
    const reg = createTurnRegistry<string>();
    const rec = reg.start("c1", () => gen(["a", "b", "c"]));
    await Bun.sleep(60); // nobody is following
    expect(rec.done).toBe(true);
    expect((await collect(reg.follow(rec, 0))).map((x) => x.event)).toEqual(["a", "b", "c"]);
    expect((await collect(reg.follow(rec, 2))).map((x) => [x.n, x.event])).toEqual([[3, "c"]]); // resume after cursor, no duplicates
  });
  test("one active turn per key; other keys are independent", async () => {
    const reg = createTurnRegistry<string>();
    reg.start("c1", () => gen(["x"], 30));
    expect(() => reg.start("c1", () => gen(["y"]))).toThrow(TurnBusyError);
    expect(() => reg.start("c2", () => gen(["y"]))).not.toThrow();
    await Bun.sleep(80);
    expect(() => reg.start("c1", () => gen(["z"]))).not.toThrow(); // finished turns release the key
  });
  test("cancel aborts only an active turn; errors before output are exposed", async () => {
    const reg = createTurnRegistry<string>();
    let aborted = false;
    const rec = reg.start("c1", async function* (signal) {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      yield "a";
      await new Promise((r) => signal.addEventListener("abort", r));
    });
    await rec.ready;
    expect(reg.cancel("c1")).toBe(true);
    await Bun.sleep(20);
    expect(aborted).toBe(true);
    expect(rec.done).toBe(true);
    expect(reg.cancel("c1")).toBe(false);
    // oxlint-disable-next-line require-yield
    const bad = reg.start("c2", async function* () {
      throw new Error("boom");
    });
    await bad.ready;
    expect(bad.events).toHaveLength(0);
    expect((bad.error as Error).message).toBe("boom");
  });
  test("finished resolves once the turn is done, also after a failure, and the key is free by then", async () => {
    const reg = createTurnRegistry<string>();
    const ok = reg.start("c1", () => gen(["a"], 20));
    await ok.finished;
    expect(ok.done).toBe(true);
    expect(() => reg.start("c1", () => gen(["b"]))).not.toThrow();
    const bad = reg.start("c2", async function* () {
      yield "a";
      throw new Error("boom");
    });
    await bad.finished;
    expect(bad.done).toBe(true);
    expect((bad.error as Error).message).toBe("boom");
  });
  test("follow waits for live events", async () => {
    const reg = createTurnRegistry<string>();
    const rec = reg.start("c1", () => gen(["1", "2", "3"], 20));
    expect((await collect(reg.follow(rec))).map((x) => x.event)).toEqual(["1", "2", "3"]);
  });
  test("two live followers each get every event and leave no waiter behind", async () => {
    const reg = createTurnRegistry<string>();
    const rec = reg.start("c1", () => gen(["1", "2", "3"], 20));
    const [a, b] = await Promise.all([collect(reg.follow(rec)), collect(reg.follow(rec))]);
    expect(a.map((x) => x.event)).toEqual(["1", "2", "3"]);
    expect(b.map((x) => x.event)).toEqual(["1", "2", "3"]);
    expect(rec.waiters.size).toBe(0);
  });
  test("past the event cap deltas are dropped but the message and done events are kept", async () => {
    const reg = createTurnRegistry<{ type: string; text?: string }>(120_000, 3);
    const rec = reg.start("c1", async function* () {
      for (const text of ["a", "b", "c", "d", "e"]) yield { type: "delta", text };
      yield { type: "message", text: "abcde" };
      yield { type: "done" };
    });
    expect((await collect(reg.follow(rec))).map((x) => x.event)).toEqual([
      { type: "delta", text: "a" },
      { type: "delta", text: "b" },
      { type: "delta", text: "c" },
      { type: "message", text: "abcde" },
      { type: "done" },
    ]);
  });
});

describe("mergeAll", () => {
  const timed = async function* (items: [number, string][], result: string) {
    for (const [wait, item] of items) {
      await Bun.sleep(wait);
      yield item;
    }
    return result;
  };
  const drain = async <T, R>(g: AsyncGenerator<T, R[]>) => {
    const seen: T[] = [];
    for (;;) {
      const x = await g.next();
      if (x.done) return { seen, results: x.value };
      seen.push(x.value);
    }
  };

  test("yields events as they arrive and returns each result in input order", async () => {
    const { seen, results } = await drain(
      mergeAll([
        timed(
          [
            [10, "a1"],
            [60, "a2"],
          ],
          "ra",
        ),
        timed([[35, "b1"]], "rb"),
      ]),
    );
    expect(seen).toEqual(["a1", "b1", "a2"]);
    expect(results).toEqual(["ra", "rb"]);
  });

  test("closing it early runs every generator's finally", async () => {
    const closed: string[] = [];
    const endless = async function* (name: string) {
      try {
        for (;;) {
          await Bun.sleep(5);
          yield name;
        }
      } finally {
        closed.push(name);
      }
    };
    const g = mergeAll([endless("a"), endless("b")]);
    await g.next();
    await g.return([]);
    expect(closed.sort()).toEqual(["a", "b"]);
  });

  test("a generator that throws closes the others and rethrows", async () => {
    const closed: string[] = [];
    const slow = async function* () {
      try {
        for (;;) {
          await Bun.sleep(5);
          yield "slow";
        }
      } finally {
        closed.push("slow");
      }
    };
    const broken = async function* (): AsyncGenerator<string, string> {
      await Bun.sleep(20);
      yield "tick";
      throw new Error("boom");
    };
    await expect(drain(mergeAll([slow(), broken()]))).rejects.toThrow("boom");
    expect(closed).toEqual(["slow"]);
  });

  test("no generators finishes at once with no results", async () => {
    expect(await drain(mergeAll([]))).toEqual({ seen: [], results: [] });
  });
});
