import { describe, expect, test } from "bun:test";
import {
  executeGraph,
  graphSchema,
  loopItems,
  retryable,
  type Cursor,
  type Effects,
  type Graph,
  type TraceStep,
} from "./workflow";

const BOT = "00000000-0000-7000-8000-0000000000b1";
const valid = (g: unknown) => graphSchema.safeParse(g);
const problems = (g: unknown) => {
  const r = valid(g);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};
const none: Effects["sleep"] = async () => {};

describe("the new steps in a graph", () => {
  const loop = {
    start: "list",
    nodes: {
      list: { type: "prompt", botId: BOT, template: "List things", next: "each" },
      each: { type: "for_each", items: "lines", body: "one", next: "done" },
      one: { type: "prompt", botId: BOT, template: "Handle {{item}}", next: "one_end" },
      one_end: { type: "item_end" },
      done: { type: "end" },
    },
  };
  test("a loop with a body that ends at an item_end, and the other new steps, are valid", () => {
    expect(problems(loop)).toEqual([]);
    expect(
      problems({
        start: "a",
        nodes: {
          a: { type: "wait", seconds: 60, next: "b" },
          b: { type: "approval", message: "Send it?", next: "c" },
          c: {
            type: "tool",
            botId: BOT,
            kind: "plugin",
            target: "gmail",
            tool: "gmail_search",
            args: { query: "{{prev}}" },
            retry: { max: 2 },
            next: "d",
          },
          d: { type: "end" },
        },
      }),
    ).toEqual([]);
  });

  test("a loop body must finish at item_end, and may hold only plain steps", () => {
    const body = (one: object, extra: object = {}) => ({
      ...loop,
      nodes: { ...loop.nodes, one, ...extra },
    });
    expect(problems(body({ type: "prompt", botId: BOT, template: "x", next: "done" }))).toEqual(
      expect.arrayContaining([expect.stringContaining("is inside the loop")]),
    );
    expect(
      problems(body({ type: "approval", message: "ok?", next: "one_end" })).join(" "),
    ).toContain('"one" (approval) cannot be inside the loop');
    expect(problems(body({ type: "wait", seconds: 5, next: "one_end" })).join(" ")).toContain(
      "cannot be inside the loop",
    );
    expect(
      problems(
        body(
          { type: "prompt", botId: BOT, template: "x", next: "stop" },
          { stop: { type: "end" } },
        ),
      ),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('(end) cannot be inside the loop "each"')]),
    );
  });

  test("an end-of-item step outside a loop, a loop-less body and a step shared with the main flow are refused", () => {
    expect(
      problems({
        start: "a",
        nodes: {
          a: { type: "prompt", botId: BOT, template: "x", next: "z" },
          z: { type: "item_end" },
        },
      }).join(" "),
    ).toContain("outside every loop");
    // The loop's `next` leads into the body: the body is also main flow.
    expect(
      problems({
        ...loop,
        nodes: {
          ...loop.nodes,
          each: { type: "for_each", items: "lines", body: "one", next: "one" },
        },
      }).join(" "),
    ).toContain("also outside it");
  });

  test("a wait has either seconds or a time, never both and never neither; limits hold", () => {
    const wait = (w: object) => ({
      start: "w",
      nodes: { w: { type: "wait", next: "e", ...w }, e: { type: "end" } },
    });
    expect(problems(wait({ seconds: 5 }))).toEqual([]);
    expect(problems(wait({ until: "2030-01-01T00:00:00Z" }))).toEqual([]);
    expect(problems(wait({})).join(" ")).toContain("either a number of seconds or a time");
    expect(problems(wait({ seconds: 5, until: "2030-01-01T00:00:00Z" })).join(" ")).toContain(
      "either a number of seconds or a time",
    );
    expect(valid(wait({ seconds: 8 * 86_400 })).success).toBe(false);
    expect(
      valid({ start: "a", nodes: { a: { type: "for_each", items: "lines", body: "x", max: 21 } } })
        .success,
    ).toBe(false);
    expect(
      valid({
        start: "a",
        nodes: { a: { type: "prompt", botId: BOT, template: "x", retry: { max: 4 } } },
      }).success,
    ).toBe(false);
  });

  test("a graph may have 30 steps now, and 31 is too many", () => {
    const chain = (n: number) => ({
      start: "s0",
      nodes: Object.fromEntries(
        Array.from({ length: n }, (_, i) => [
          `s${i}`,
          i === n - 1
            ? { type: "end" }
            : { type: "prompt", botId: BOT, template: "x", next: `s${i + 1}` },
        ]),
      ),
    });
    expect(problems(chain(30))).toEqual([]);
    expect(problems(chain(31)).join(" ")).toContain("1 to 30 steps");
  });
});

describe("loopItems", () => {
  test("lines: one item per non-empty line, trimmed, at most the cap", () => {
    expect(loopItems(" a \n\n b\r\nc", "lines")).toEqual(["a", "b", "c"]);
    expect(
      loopItems(Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n"), "lines"),
    ).toHaveLength(20);
    expect(loopItems("a\nb\nc", "lines", 2)).toEqual(["a", "b"]);
  });
  test("json: the list inside the answer, text as it is and other values as JSON", () => {
    expect(loopItems('Here you go: ["x","y"] done', "json")).toEqual(["x", "y"]);
    expect(loopItems('[{"id":1},2,"z"]', "json")).toEqual(['{"id":1}', "2", "z"]);
    expect(loopItems("no list", "json")).toBeUndefined();
    expect(loopItems("[not json]", "json")).toBeUndefined();
    expect(loopItems('{"a":1}', "json")).toBeUndefined();
  });
});

describe("running the new steps", () => {
  const echo = (calls: string[] = []): Effects => ({
    sleep: none,
    runPrompt: async (_b, prompt) => {
      calls.push(prompt);
      return `ans(${prompt})`;
    },
  });

  test("a loop runs its body once per item with {{item}} and joins the answers, numbered", async () => {
    const calls: string[] = [];
    const g = graphSchema.parse({
      start: "src",
      nodes: {
        src: { type: "prompt", botId: BOT, template: "list", next: "each" },
        each: { type: "for_each", items: "lines", body: "one", next: "after" },
        one: { type: "prompt", botId: BOT, template: "do {{item}} of {{input}}", next: "one_end" },
        one_end: { type: "item_end" },
        after: { type: "prompt", botId: BOT, template: "sum {{prev}}", next: "e" },
        e: { type: "end" },
      },
    });
    const fx = echo(calls);
    fx.runPrompt = async (_b, p) => {
      calls.push(p);
      return p === "list" ? "red\nblue" : `done:${p}`;
    };
    const r = await executeGraph(g, "IN", fx);
    expect(r.status).toBe("succeeded");
    expect(calls).toEqual([
      "list",
      "do red of IN",
      "do blue of IN",
      "sum [1] done:do red of IN\n\n[2] done:do blue of IN",
    ]);
    expect(r.trace.filter((t) => t.item !== undefined).map((t) => [t.node, t.item])).toEqual([
      ["one", 0],
      ["one", 1],
    ]);
    expect(r.trace.find((t) => t.type === "for_each")?.output).toBe("2 items");
  });

  test("answers of earlier steps are available by name, and an answer that holds a placeholder is never filled twice", async () => {
    const calls: string[] = [];
    const g = graphSchema.parse({
      start: "a",
      nodes: {
        a: { type: "prompt", botId: BOT, template: "first", next: "b" },
        b: { type: "prompt", botId: BOT, template: "second", next: "c" },
        c: {
          type: "prompt",
          botId: BOT,
          template: "use {{steps.a}} and {{steps.b}} and {{steps.nope}}.",
          next: "e",
        },
        e: { type: "end" },
      },
    });
    await executeGraph(g, "x", {
      sleep: none,
      runPrompt: async (_b, p) => (calls.push(p), p === "first" ? "{{prev}} {{input}}" : "B"),
    });
    expect(calls.at(-1)).toBe("use {{prev}} {{input}} and B and .");
  });

  test("a loop over a list that is not one fails with a reason; a failing item fails the run", async () => {
    const mk = (items: "lines" | "json") =>
      graphSchema.parse({
        start: "a",
        nodes: {
          a: { type: "prompt", botId: BOT, template: "x", next: "f" },
          f: { type: "for_each", items, body: "p", next: "e" },
          p: { type: "prompt", botId: BOT, template: "{{item}}", next: "pe" },
          pe: { type: "item_end" },
          e: { type: "end" },
        },
      });
    const bad = await executeGraph(mk("json"), "", {
      sleep: none,
      runPrompt: async () => "plain text",
    });
    expect(bad.status).toBe("failed");
    expect(bad.trace.at(-1)).toMatchObject({ node: "f", error: "items_invalid" });
    let n = 0;
    const half = await executeGraph(mk("lines"), "", {
      sleep: none,
      runPrompt: async () => {
        if (++n === 1) return "a\nb";
        if (n === 3) throw new Error("boom");
        return "ok";
      },
    });
    expect(half.status).toBe("failed");
    expect(half.trace.at(-1)).toMatchObject({ node: "p", item: 1, error: "step_failed" });
  });

  test("a step that asks for retries tries again after a failure a second try can fix, and says how many tries it took", async () => {
    const g = graphSchema.parse({
      start: "a",
      nodes: {
        a: { type: "prompt", botId: BOT, template: "x", retry: { max: 2, delayMs: 5 }, next: "e" },
        e: { type: "end" },
      },
    });
    let tries = 0;
    const waits: number[] = [];
    const ok = await executeGraph(g, "", {
      sleep: async (ms) => void waits.push(ms),
      runPrompt: async () => {
        if (++tries < 3) throw new Error("flaky");
        return "fine";
      },
    });
    expect(ok.status).toBe("succeeded");
    expect(tries).toBe(3);
    expect(waits).toEqual([5, 5]);
    expect(ok.trace[0]).toMatchObject({ output: "fine", attempts: 3 });

    tries = 0;
    const out = await executeGraph(g, "", {
      sleep: none,
      runPrompt: async () => (++tries, Promise.reject(new Error("always"))),
    });
    expect(out.status).toBe("failed");
    expect(tries).toBe(3);
    expect(out.trace[0]).toMatchObject({ error: "step_failed", attempts: 3 });

    // A sign-in, a limit or a bot that is not ready is not fixed by trying again.
    tries = 0;
    const gate = await executeGraph(g, "", {
      sleep: none,
      runPrompt: async () => (
        ++tries,
        Promise.reject(Object.assign(new Error("auth_required"), { code: "auth_required" }))
      ),
    });
    expect(gate.status).toBe("failed");
    expect(tries).toBe(1);
    expect(retryable(Object.assign(new Error("x"), { name: "AccessError" }))).toBe(false);
    expect(retryable(new Error("network"))).toBe(true);
  });

  test("a tool step calls the tool with its arguments filled in, in any nesting, and passes its answer on", async () => {
    const g = graphSchema.parse({
      start: "a",
      nodes: {
        a: {
          type: "tool",
          botId: BOT,
          kind: "plugin",
          target: "gmail",
          tool: "gmail_search",
          args: { query: "from:{{input}}", opts: { limit: 3, tags: ["{{prev}}", "x"] } },
          next: "e",
        },
        e: { type: "end" },
      },
    });
    const seen: unknown[] = [];
    const r = await executeGraph(g, "ana", {
      sleep: none,
      runPrompt: async () => "",
      tool: async (c) => (seen.push(c), "3 mails"),
    });
    expect(seen).toEqual([
      {
        botId: BOT,
        kind: "plugin",
        target: "gmail",
        tool: "gmail_search",
        args: { query: "from:ana", opts: { limit: 3, tags: ["ana", "x"] } },
      },
    ]);
    expect(r).toMatchObject({ status: "succeeded", output: "3 mails" });
    expect(
      (await executeGraph(g, "", { sleep: none, runPrompt: async () => "" })).trace[0],
    ).toMatchObject({ type: "tool", error: "tool_failed" });
  });

  test("a wait stops the run with where to go on, and a resume continues from there", async () => {
    const g = graphSchema.parse({
      start: "a",
      nodes: {
        a: { type: "prompt", botId: BOT, template: "one", next: "w" },
        w: { type: "wait", seconds: 3600, next: "b" },
        b: {
          type: "prompt",
          botId: BOT,
          template: "two after {{prev}} / {{input}} / {{steps.a}}",
          next: "e",
        },
        e: { type: "end" },
      },
    });
    const calls: string[] = [];
    const fx: Effects = {
      sleep: none,
      runPrompt: async (_b, p) => (calls.push(p), p === "one" ? "first" : "second"),
    };
    const before = Date.now();
    const paused = await executeGraph(g, "IN", fx);
    expect(paused.status).toBe("waiting");
    if (paused.status !== "waiting") throw new Error();
    expect(paused.wait).toMatchObject({ kind: "time", node: "w" });
    expect(+new Date((paused.wait as { resumeAt: string }).resumeAt)).toBeGreaterThanOrEqual(
      before + 3_600_000 - 50,
    );
    expect(paused.cursor).toMatchObject({ at: "b", prev: "first", outputs: { a: "first" } });
    expect(calls).toEqual(["one"]);
    const done = await executeGraph(g, "IN", fx, undefined, undefined, {
      trace: paused.trace,
      cursor: paused.cursor,
    });
    expect(done).toMatchObject({ status: "succeeded", output: "second" });
    expect(calls).toEqual(["one", "two after first / IN / first"]);
    expect(done.trace.map((t: TraceStep) => t.node)).toEqual(["a", "w", "b", "e"]);
  });

  test("an approval step stops the run, and a wait with nothing after it ends the run when resumed", async () => {
    const g = graphSchema.parse({
      start: "q",
      nodes: {
        q: { type: "approval", message: "Send the report?", next: "e" },
        e: { type: "end" },
      },
    });
    const paused = await executeGraph(g, "", { sleep: none, runPrompt: async () => "" });
    expect(paused).toMatchObject({
      status: "waiting",
      wait: { kind: "approval", node: "q", message: "Send the report?" },
      cursor: { at: "e" },
    });
    // A branch that ends at a wait with no step after it (a graph with another branch that reaches `end` is valid; this is just the walk).
    const last = { start: "w", nodes: { w: { type: "wait", seconds: 1 } } } as unknown as Graph;
    const p2 = await executeGraph(last, "", { sleep: none, runPrompt: async () => "" });
    expect(p2.status).toBe("waiting");
    if (p2.status !== "waiting") throw new Error();
    const cursor: Cursor = p2.cursor;
    expect(cursor.at).toBeUndefined();
    expect(
      (
        await executeGraph(
          last,
          "",
          { sleep: none, runPrompt: async () => "" },
          undefined,
          undefined,
          { trace: p2.trace, cursor },
        )
      ).status,
    ).toBe("succeeded");
  });

  test("a stop request ends the run as cancelled, also inside a loop", async () => {
    const g = graphSchema.parse({
      start: "a",
      nodes: {
        a: { type: "prompt", botId: BOT, template: "x", next: "f" },
        f: { type: "for_each", items: "lines", body: "p", next: "e" },
        p: { type: "prompt", botId: BOT, template: "{{item}}", next: "pe" },
        pe: { type: "item_end" },
        e: { type: "end" },
      },
    });
    const stop = new AbortController();
    let n = 0;
    const r = await executeGraph(g, "", {
      sleep: none,
      signal: stop.signal,
      runPrompt: async () => (++n === 1 ? "a\nb\nc" : (stop.abort(), "x")),
    });
    expect(r.status).toBe("cancelled");
    expect(n).toBe(2);
  });
});
