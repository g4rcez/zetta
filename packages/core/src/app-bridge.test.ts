import { describe, expect, test } from "bun:test";
import {
  bridgePrelude,
  BRIDGE_LIMITS,
  createBridgeLimiter,
  errorReply,
  okReply,
  parseBridgeRequest,
} from "./app-bridge";

const tools = new Set(["items.list", "items.add"]);
const msg = (over: Record<string, unknown> = {}) => ({
  source: "zetta-app",
  id: 1,
  type: "call",
  tool: "items.list",
  ...over,
});

describe("parseBridgeRequest", () => {
  test("a good request is read, with and without input", () => {
    expect(parseBridgeRequest(msg(), tools)).toEqual({
      kind: "request",
      request: { source: "zetta-app", id: 1, type: "call", tool: "items.list" },
    });
    const r = parseBridgeRequest(msg({ input: { a: 1 } }), tools);
    expect(r).toMatchObject({ kind: "request", request: { input: { a: 1 } } });
  });
  test("anything that is not ours is ignored and never answered", () => {
    for (const bad of [
      null,
      "x",
      5,
      [],
      {},
      { source: "other", id: 1, type: "call", tool: "items.list" },
      msg({ type: "other" }),
      msg({ id: 0 }),
      msg({ id: 1.5 }),
      msg({ id: "1" }),
      msg({ id: 2 ** 31 }),
    ])
      expect(parseBridgeRequest(bad, tools)).toEqual({ kind: "ignore" });
  });
  test("an unknown or odd tool is answered with an error", () => {
    expect(parseBridgeRequest(msg({ tool: "items.remove" }), tools)).toMatchObject({
      kind: "reject",
      reply: { id: 1, ok: false, error: { code: "UNKNOWN_TOOL" } },
    });
    expect(parseBridgeRequest(msg({ tool: 5 }), tools)).toMatchObject({
      kind: "reject",
      reply: { error: { code: "UNKNOWN_TOOL" } },
    });
    expect(parseBridgeRequest(msg({ tool: "x".repeat(300) }), tools)).toMatchObject({
      kind: "reject",
    });
    expect(parseBridgeRequest(msg({ tool: "__proto__" }), tools)).toMatchObject({ kind: "reject" });
  });
  test("the input must be an object of a sensible size", () => {
    expect(parseBridgeRequest(msg({ input: [1] }), tools)).toMatchObject({
      kind: "reject",
      reply: { error: { code: "INVALID" } },
    });
    expect(parseBridgeRequest(msg({ input: "text" }), tools)).toMatchObject({ kind: "reject" });
    expect(
      parseBridgeRequest(msg({ input: { big: "a".repeat(BRIDGE_LIMITS.inputChars) } }), tools),
    ).toMatchObject({ kind: "reject", reply: { error: { code: "TOO_LARGE" } } });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(parseBridgeRequest(msg({ input: circular }), tools)).toMatchObject({
      kind: "reject",
      reply: { error: { code: "INVALID" } },
    });
  });
  test("a reply keeps the id of the request", () => {
    expect(okReply(7, { a: 1 })).toEqual({
      source: "zetta-host",
      id: 7,
      ok: true,
      value: { a: 1 },
    });
    expect(okReply(7, undefined)).toMatchObject({ ok: true, value: null });
    expect(errorReply(7, "X", "y".repeat(900)).ok).toBe(false);
    expect(
      (errorReply(7, "X", "y".repeat(900)) as { error: { message: string } }).error.message,
    ).toHaveLength(500);
  });
  test("an answer too large for the page is replaced by an error", () => {
    expect(okReply(3, "a".repeat(BRIDGE_LIMITS.valueChars + 10))).toMatchObject({
      ok: false,
      error: { code: "TOO_LARGE" },
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(okReply(3, circular)).toMatchObject({ ok: false, error: { code: "TOO_LARGE" } });
  });
});

describe("createBridgeLimiter", () => {
  test("only a few calls wait at once, and a slot frees when one is done", () => {
    const l = createBridgeLimiter(() => 0);
    for (let i = 0; i < BRIDGE_LIMITS.inFlight; i++) expect(l.start(i + 1)).toBeNull();
    expect(l.start(99)).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
    l.done();
    expect(l.start(100)).toBeNull();
  });
  test("only a few start in one second, then the window moves", () => {
    let t = 0;
    const l = createBridgeLimiter(() => t);
    for (let i = 0; i < BRIDGE_LIMITS.perSecond; i++) {
      expect(l.start(i + 1)).toBeNull();
      l.done();
    }
    expect(l.start(99)).toMatchObject({ error: { code: "RATE_LIMITED" } });
    t = 1001;
    expect(l.start(100)).toBeNull();
  });
  test("done never goes below zero", () => {
    const l = createBridgeLimiter(() => 0);
    l.done();
    l.done();
    for (let i = 0; i < BRIDGE_LIMITS.inFlight; i++) expect(l.start(i + 1)).toBeNull();
    expect(l.start(99)).not.toBeNull();
  });
});

/** The page script, run against a stand-in for a window, a parent and timers. */
function page() {
  const sent: any[] = [];
  const parent = { postMessage: (m: unknown) => void sent.push(m) };
  const listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const win: Record<string, unknown> = {};
  const src = bridgePrelude().replace(/^<script>|<\/script>$/g, "");
  new Function(
    "window",
    "parent",
    "addEventListener",
    "setTimeout",
    "clearTimeout",
    "Object",
    "Promise",
    "Error",
    src,
  )(
    win,
    parent,
    (_: string, fn: (e: { source: unknown; data: unknown }) => void) => void listeners.push(fn),
    (fn: () => void, ms: number) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    (t: { cleared: boolean }) => void (t.cleared = true),
    Object,
    Promise,
    Error,
  );
  const deliver = (data: unknown, source: unknown = parent) =>
    listeners.forEach((l) => l({ source, data }));
  return {
    zetta: win.zetta as { call: (t: string, i?: object) => Promise<unknown> },
    sent,
    deliver,
    parent,
    timers,
    win,
  };
}

describe("bridgePrelude (the script in the page)", () => {
  test("gives the page window.zetta with a call function, and nothing else", () => {
    const p = page();
    expect(Object.keys(p.zetta)).toEqual(["call"]);
    expect(Object.getOwnPropertyNames(p.win)).toEqual(["zetta"]);
  });
  test("a call goes to the parent and resolves with the value of its reply", async () => {
    const p = page();
    const done = p.zetta.call("items.list", { q: "x" });
    expect(p.sent).toEqual([
      { source: "zetta-app", id: 1, type: "call", tool: "items.list", input: { q: "x" } },
    ]);
    p.deliver({ source: "zetta-host", id: 1, ok: true, value: [1, 2] });
    expect(await done).toEqual([1, 2]);
  });
  test("an error reply rejects with its code and message", async () => {
    const p = page();
    const done = p.zetta.call("items.add");
    p.deliver({
      source: "zetta-host",
      id: 1,
      ok: false,
      error: { code: "DENIED", message: "No." },
    });
    await expect(done).rejects.toMatchObject({ code: "DENIED", message: "No." });
  });
  test("replies from anyone but the parent, with the wrong tag or the wrong id, change nothing", async () => {
    const p = page();
    let settled = false;
    const done = p.zetta.call("items.list").then(() => (settled = true));
    p.deliver({ source: "zetta-host", id: 1, ok: true, value: 1 }, { not: "the parent" });
    p.deliver({ source: "other", id: 1, ok: true, value: 1 });
    p.deliver({ source: "zetta-host", id: 99, ok: true, value: 1 });
    p.deliver(null);
    await Promise.resolve();
    expect(settled).toBe(false);
    p.deliver({ source: "zetta-host", id: 1, ok: true, value: 1 });
    await done;
    expect(settled).toBe(true);
  });
  test("each call has its own id, answered in any order", async () => {
    const p = page();
    const a = p.zetta.call("items.list");
    const b = p.zetta.call("items.list");
    p.deliver({ source: "zetta-host", id: 2, ok: true, value: "second" });
    p.deliver({ source: "zetta-host", id: 1, ok: true, value: "first" });
    expect([await a, await b]).toEqual(["first", "second"]);
  });
  test("a call nobody answers times out, and a late reply is ignored", async () => {
    const p = page();
    const done = p.zetta.call("items.list");
    expect(p.timers[0]!.ms).toBe(BRIDGE_LIMITS.waitMs);
    p.timers[0]!.fn();
    await expect(done).rejects.toMatchObject({ code: "TIMEOUT" });
    p.deliver({ source: "zetta-host", id: 1, ok: true, value: 1 });
  });
  test("an answered call clears its timer", async () => {
    const p = page();
    const done = p.zetta.call("items.list");
    p.deliver({ source: "zetta-host", id: 1, ok: true, value: 1 });
    await done;
    expect(p.timers[0]!.cleared).toBe(true);
  });
  test("a page cannot replace window.zetta", () => {
    const p = page();
    expect(() => {
      "use strict";
      (p.win as { zetta: unknown }).zetta = 1;
    }).toThrow();
    expect(p.win.zetta).toBe(p.zetta);
  });
});
