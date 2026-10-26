import { describe, expect, test } from "bun:test";
import { TurnBusyError, createTurnRegistry } from "./turns";

async function* gen(items: string[], delay = 5): AsyncGenerator<string> { for (const i of items) { await Bun.sleep(delay); yield i; } }
const collect = async <E>(it: AsyncGenerator<{ n: number; event: E }>) => { const out: { n: number; event: E }[] = []; for await (const x of it) out.push(x); return out; };

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
    const rec = reg.start("c1", async function* (signal) { signal.addEventListener("abort", () => { aborted = true; }); yield "a"; await new Promise((r) => signal.addEventListener("abort", r)); });
    await rec.ready;
    expect(reg.cancel("c1")).toBe(true); await Bun.sleep(20);
    expect(aborted).toBe(true); expect(rec.done).toBe(true); expect(reg.cancel("c1")).toBe(false);
    const bad = reg.start("c2", async function* () { throw new Error("boom"); });
    await bad.ready; expect(bad.events).toHaveLength(0); expect((bad.error as Error).message).toBe("boom");
  });
  test("follow waits for live events", async () => {
    const reg = createTurnRegistry<string>();
    const rec = reg.start("c1", () => gen(["1", "2", "3"], 20));
    expect((await collect(reg.follow(rec))).map((x) => x.event)).toEqual(["1", "2", "3"]);
  });
});
