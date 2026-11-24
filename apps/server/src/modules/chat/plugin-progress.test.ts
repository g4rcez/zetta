import { describe, expect, test } from "bun:test";

import { pluginProgressSink } from "./plugin-progress";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("plugin progress sink", () => {
  test("the first report goes at once, a burst after it is cut to the latest one a moment later", async () => {
    const got: string[] = [];
    const s = pluginProgressSink((p) => got.push(p.text), { everyMs: 60 });
    s.progress({ text: "a" });
    s.progress({ text: "b" });
    s.progress({ text: "c" });
    expect(got).toEqual(["a"]);
    await wait(100);
    expect(got).toEqual(["a", "c"]);
    s.close();
  });

  test("the same line twice is said once", () => {
    const got: string[] = [];
    const s = pluginProgressSink((p) => got.push(p.text), { everyMs: 0 });
    s.progress({ text: "x", percent: 5 });
    s.progress({ text: "x", percent: 5 });
    s.progress({ text: "x", percent: 6 });
    expect(got).toEqual(["x", "x"]);
  });

  test("once the call is over nothing goes out, not even what was waiting", async () => {
    const got: string[] = [];
    const s = pluginProgressSink((p) => got.push(p.text), { everyMs: 60 });
    s.progress({ text: "a" });
    s.progress({ text: "late" });
    s.close();
    s.progress({ text: "after" });
    await wait(100);
    expect(got).toEqual(["a"]);
  });

  test("text is trimmed and shortened, a percent is clamped, nonsense is dropped", () => {
    const got: { text: string; percent?: number }[] = [];
    const s = pluginProgressSink((p) => got.push(p), { everyMs: 0 });
    s.progress({ text: `  a\n  b ${"z".repeat(500)}`, percent: 250 });
    s.progress({ text: "   " });
    s.progress({ text: "n", percent: Number.NaN });
    expect(got[0]!.text.length).toBe(160);
    expect(got[0]!.text.startsWith("a b z")).toBe(true);
    expect(got[0]!.percent).toBe(100);
    expect(got[1]).toEqual({ text: "n" });
    expect(got).toHaveLength(2);
  });
});
