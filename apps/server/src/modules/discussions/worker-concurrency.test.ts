// How many room turns run at once is the setting `roomConcurrency`, read before each claim, with no restart. The worker runs here over a
// fake store and a fake chat: turns stay "running" until the test lets them go.
import { describe, expect, test } from "bun:test";
import type { Database } from "@zetta/db";
import { createDiscussionWorker } from "./worker";
import type { Claimed, DiscussionStore } from "./store";
import { createTestSettings } from "../settings/testing";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(queued: number, opts: { bare?: boolean } = {}) {
  const settings = createTestSettings();
  let next = 0;
  const open: Array<() => void> = [];
  let live = 0,
    peak = 0;
  const store = {
    // The turns of the person's own posts (lane "user") are not part of this limit: none here.
    claimNext: async (_name: unknown, lane: "any" | "user") =>
      lane === "any" && next < queued
        ? ({
            turn: { id: `t${next++}`, attempts: 1, ownerUserId: "u" },
            discussion: {},
            member: {},
          } as unknown as Claimed)
        : undefined,
    finishTurn: async () => undefined,
    hasRunnable: async () => next < queued,
  } as unknown as DiscussionStore;
  const chat = {
    runDiscussionTurn: () =>
      new Promise<"done">((resolve) => {
        live++;
        peak = Math.max(peak, live);
        open.push(() => {
          live--;
          resolve("done");
        });
      }),
  };
  const worker = createDiscussionWorker(
    {} as Database,
    store,
    chat,
    async () => ({ isAdmin: false }),
    { settings: opts.bare ? undefined : settings.service },
  );
  return {
    settings,
    worker,
    live: () => live,
    peak: () => peak,
    finish: (n = 1) => {
      for (const done of open.splice(0, n)) done();
    },
  };
}

describe("room concurrency from the settings", () => {
  test("unset gives the registry default, 4 turns at once", async () => {
    const t = setup(10);
    t.worker.kick();
    await wait(30);
    expect(t.live()).toBe(4);
    t.finish(4);
    await wait(30);
    // Each finished turn pulls the next one: the limit holds all the way.
    expect(t.peak()).toBe(4);
  });

  test("lowering the setting holds new turns, raising it lets the next pump start more, in one process", async () => {
    const t = setup(10);
    await t.settings.set("roomConcurrency", 2);
    t.worker.kick();
    await wait(30);
    expect(t.live()).toBe(2);
    await t.settings.set("roomConcurrency", 5);
    t.worker.kick();
    await wait(30);
    expect(t.live()).toBe(5);
    // Lower than what runs now: nothing is stopped, and no new turn starts until enough have ended.
    await t.settings.set("roomConcurrency", 1);
    t.worker.kick();
    await wait(30);
    expect(t.live()).toBe(5);
    t.finish(3); // 2 still run, over the limit of 1: the ended turns pull nothing
    await wait(30);
    expect(t.live()).toBe(2);
    t.finish(1); // 1 runs: at the limit
    await wait(30);
    expect(t.live()).toBe(1);
    t.finish(1); // none run: one new turn starts
    await wait(30);
    expect(t.live()).toBe(1);
    await t.settings.unset("roomConcurrency"); // back to 4
    t.worker.kick();
    await wait(30);
    expect(t.live()).toBe(4);
  });

  test("the old variable ZETTA_ROOM_CONCURRENCY has no effect", async () => {
    const was = process.env.ZETTA_ROOM_CONCURRENCY;
    try {
      process.env.ZETTA_ROOM_CONCURRENCY = "1";
      const t = setup(10);
      t.worker.kick();
      await wait(30);
      expect(t.live()).toBe(4); // nothing stored: the default, not the variable
      t.finish(4);
      await t.settings.set("roomConcurrency", 2);
      process.env.ZETTA_ROOM_CONCURRENCY = "9";
      t.worker.kick();
      await wait(30);
      expect(t.live()).toBeLessThanOrEqual(2);
    } finally {
      if (was === undefined) delete process.env.ZETTA_ROOM_CONCURRENCY;
      else process.env.ZETTA_ROOM_CONCURRENCY = was;
    }
  });

  test("without a settings service the registry default counts", async () => {
    const t = setup(10, { bare: true });
    t.worker.kick();
    await wait(30);
    expect(t.live()).toBe(4);
  });
});
