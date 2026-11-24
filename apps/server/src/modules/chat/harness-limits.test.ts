// The harness limiter reads `harnessMax`, `harnessMaxPerUser` and `harnessWaitMs` from the settings at every decision, with no restart.
import { describe, expect, test } from "bun:test";
import { createLimiter, harnessLimits, HarnessError } from "./harness";
import { createTestSettings } from "../settings/testing";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: HarnessError) => e.code,
  );
/** A limiter handed the live limits of a fresh settings service, the way `streamCli` hands them. */
const setup = () => {
  const settings = createTestSettings();
  const limiter = createLimiter();
  const live = harnessLimits(settings.service);
  return {
    settings,
    limiter,
    acquire: (u: string, s?: AbortSignal) => limiter.acquire(u, s, live),
  };
};

describe("harness limits from the settings", () => {
  test("unset gives the registry defaults: 8 in total, 4 per person", async () => {
    const { acquire, limiter } = setup();
    const held = [];
    const blocked = async (user: string) => {
      const ctl = new AbortController();
      const p = code(acquire(user, ctl.signal));
      await wait(60);
      ctl.abort(); // still queued after 60 ms: it did not get a place
      return (await p) === "cancelled";
    };
    for (let i = 0; i < 4; i++) held.push(await acquire("a"));
    expect(await blocked("a")).toBe(true); // the fifth of one person waits
    for (let i = 0; i < 4; i++) held.push(await acquire("b"));
    expect(limiter.stats().active).toBe(8);
    expect(await blocked("c")).toBe(true); // the ninth of all waits
    for (const r of held) r();
  }, 10_000);

  test("lowering and raising the total limit changes the next decision in one process", async () => {
    const { settings, acquire } = setup();
    await settings.set("harnessWaitMs", 100);
    await settings.set("harnessMax", 2);
    const a = await acquire("a"),
      b = await acquire("b");
    expect(await code(acquire("c"))).toBe("busy");
    await settings.set("harnessMax", 3);
    const c = await acquire("c");
    await settings.set("harnessMax", 1);
    expect(await code(acquire("d"))).toBe("busy");
    await settings.unset("harnessMax"); // back to 8
    const d = await acquire("d");
    for (const r of [a, b, c, d]) r();
  });

  test("the per-person limit follows the setting", async () => {
    const { settings, acquire } = setup();
    await settings.set("harnessWaitMs", 100);
    await settings.set("harnessMaxPerUser", 1);
    const a = await acquire("a");
    expect(await code(acquire("a"))).toBe("busy");
    const b = await acquire("b"); // another person is not held by it
    await settings.set("harnessMaxPerUser", 2);
    const a2 = await acquire("a");
    for (const r of [a, b, a2]) r();
  });

  test("a lowered limit never stops running work, it only holds new work", async () => {
    const { settings, acquire, limiter } = setup();
    await settings.set("harnessWaitMs", 100);
    const running = [await acquire("a"), await acquire("b"), await acquire("c")];
    await settings.set("harnessMax", 1);
    expect(limiter.stats().active).toBe(3); // nobody was killed
    expect(await code(acquire("d"))).toBe("busy");
    running[0]!();
    running[1]!();
    expect(await code(acquire("d"))).toBe("busy"); // one still runs: 1 of 1
    running[2]!();
    (await acquire("d"))();
  });

  test("waiters start when the limit is raised, with no release and no new request", async () => {
    const { settings, acquire } = setup();
    await settings.set("harnessWaitMs", 20_000);
    await settings.set("harnessMax", 1);
    const first = await acquire("a");
    let started = false;
    const second = acquire("b").then((r) => {
      started = true;
      return r;
    });
    await wait(150);
    expect(started).toBe(false);
    await settings.set("harnessMax", 2);
    // The waiter looks at the live limits every second.
    const r = await second;
    expect(started).toBe(true);
    r();
    first();
  }, 10_000);

  test("a new request that sees a raised limit also starts the waiters that were already queued", async () => {
    const { settings, acquire } = setup();
    await settings.set("harnessWaitMs", 20_000);
    await settings.set("harnessMax", 1);
    const first = await acquire("a");
    const second = acquire("b");
    await wait(50);
    await settings.set("harnessMax", 3);
    const third = await acquire("c"); // reads the new limit and wakes "b" too
    const b = await second;
    for (const r of [first, third, b]) r();
  });

  test("the wait comes from the setting, for waiters that start after the change", async () => {
    const { settings, acquire } = setup();
    await settings.set("harnessMax", 1);
    await settings.set("harnessWaitMs", 120);
    const held = await acquire("a");
    const t0 = Date.now();
    expect(await code(acquire("b"))).toBe("busy");
    expect(Date.now() - t0).toBeLessThan(1500);
    await settings.set("harnessWaitMs", 0);
    const t1 = Date.now();
    expect(await code(acquire("b"))).toBe("busy");
    expect(Date.now() - t1).toBeLessThan(100); // 0 means it does not wait
    held();
  });

  test("a waiter that has started keeps the wait it began with", async () => {
    const { settings, acquire } = setup();
    await settings.set("harnessMax", 1);
    await settings.set("harnessWaitMs", 200);
    const held = await acquire("a");
    const waiting = code(acquire("b"));
    await wait(20);
    await settings.set("harnessWaitMs", 60_000); // later waiters get this one, not the queued waiter
    expect(await waiting).toBe("busy");
    held();
  });

  test("the old variables have no effect once a value is stored, and are ignored when nothing is stored", async () => {
    const was = {
      max: process.env.ZETTA_HARNESS_MAX,
      per: process.env.ZETTA_HARNESS_MAX_PER_USER,
      wait: process.env.ZETTA_HARNESS_WAIT_MS,
    };
    try {
      process.env.ZETTA_HARNESS_MAX = "1";
      process.env.ZETTA_HARNESS_MAX_PER_USER = "1";
      process.env.ZETTA_HARNESS_WAIT_MS = "0";
      const { settings, acquire } = setup();
      // Nothing stored: the registry defaults (8, 4, 300000), not the variables.
      const held = [await acquire("a"), await acquire("a"), await acquire("b")];
      for (const r of held) r();
      await settings.set("harnessMax", 3);
      await settings.set("harnessMaxPerUser", 3);
      await settings.set("harnessWaitMs", 100);
      process.env.ZETTA_HARNESS_MAX = "99";
      process.env.ZETTA_HARNESS_MAX_PER_USER = "99";
      process.env.ZETTA_HARNESS_WAIT_MS = "600000";
      const three = [await acquire("a"), await acquire("a"), await acquire("a")];
      const t0 = Date.now();
      expect(await code(acquire("a"))).toBe("busy");
      expect(Date.now() - t0).toBeLessThan(2000); // the stored 100 ms, not the variable's ten minutes
      for (const r of three) r();
    } finally {
      for (const [k, v] of [
        ["ZETTA_HARNESS_MAX", was.max],
        ["ZETTA_HARNESS_MAX_PER_USER", was.per],
        ["ZETTA_HARNESS_WAIT_MS", was.wait],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("a waiter that is aborted leaves the queue", async () => {
    const { settings, acquire, limiter } = setup();
    await settings.set("harnessMax", 1);
    const held = await acquire("a");
    const ctl = new AbortController();
    const waiting = code(acquire("b", ctl.signal));
    await wait(20);
    ctl.abort();
    expect(await waiting).toBe("cancelled");
    held();
    expect(limiter.stats().active).toBe(0);
  });
});
