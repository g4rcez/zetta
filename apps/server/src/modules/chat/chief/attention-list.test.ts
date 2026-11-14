import { describe, expect, test } from "bun:test";
import { runAttention } from "./personal";

type Opts = { state?: string; limit?: number } | undefined;

describe("the chief's attention list", () => {
  const rows = [
    { id: "1", kind: "loop_paused", title: "A loop paused", status: "open" },
    { id: "2", kind: "room_idle", title: "A room went quiet", status: "open" },
    { id: "3", kind: "routine_failed", title: "A routine failed", status: "acknowledged" },
  ];
  const ctxWith = (asked: Opts[]) =>
    ({
      actor: { userId: "u", isAdmin: false },
      deps: {
        features: {
          listAttention: async (_a: unknown, opts?: Opts) => {
            asked.push(opts);
            return rows;
          },
        },
      },
    }) as never;

  test("asks only for live cards, so resolved ones never push a waiting one out", async () => {
    const asked: Opts[] = [];
    await runAttention(ctxWith(asked), { action: "list" } as never);
    expect(asked).toEqual([{ state: "live", limit: 50 }]);
  });

  test("tells the decisions that wait for the person from the updates", async () => {
    const out = await runAttention(ctxWith([]), { action: "list" } as never);
    const body = JSON.parse((out as { read: string }).read.split("\n")[1]!);
    expect(body.decisions.map((r: { id: string }) => r.id)).toEqual(["1", "3"]);
    expect(body.updates.map((r: { id: string }) => r.id)).toEqual(["2"]);
    expect(body.decisions[0]).toEqual({
      id: "1",
      kind: "loop_paused",
      title: "A loop paused",
      status: "open",
    });
  });

  test("a card is acted on by id among all of them, live or not", async () => {
    const asked: Opts[] = [];
    const out = await runAttention(ctxWith(asked), { action: "resolve", item: "3" } as never);
    expect(asked).toEqual([undefined]);
    expect(JSON.stringify(out)).toContain("A routine failed");
    const missing = await runAttention(ctxWith([]), { action: "resolve", item: "nope" } as never);
    expect(missing).toEqual({ error: "no attention item with that id. Use attention list." });
  });
});
