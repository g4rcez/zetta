import { describe, expect, test } from "bun:test";

import { createEventBus, MAX_MESSAGE_BYTES, toMessages, type BusMessage } from "./bus";
import { createWork } from "./work";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("event bus link", () => {
  test("a publish leaves for other instances even when nobody listens here, merged per window", async () => {
    const bus = createEventBus(5);
    const sent: BusMessage[] = [];
    bus.link({ send: (m) => sent.push(m) });
    bus.publish(["user-a"], "rooms");
    bus.publish(["user-a", "user-b"], "rooms", "attention");
    await wait(30);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      v: 1,
      from: bus.id,
      items: [{ u: ["user-a", "user-b"], t: ["attention", "rooms"] }],
    });
  });

  test("a message from another instance reaches the local listener, once per burst", async () => {
    const a = createEventBus(5);
    const b = createEventBus(5);
    a.link({ send: (m) => b.receive(m) });
    const seen: string[] = [];
    b.subscribe("user-a", (t) => seen.push(t));
    a.publish(["user-a"], "conversation:1");
    a.publish(["user-a"], "conversation:1");
    await wait(40);
    expect(seen).toEqual(["conversation:1"]);
  });

  test("a bus ignores its own messages and what is not a bus message", async () => {
    const bus = createEventBus(5);
    const seen: string[] = [];
    bus.subscribe("user-a", (t) => seen.push(t));
    bus.receive({ v: 1, from: bus.id, items: [{ u: ["user-a"], t: ["rooms"] }] });
    bus.receive({ v: 2, from: "x", items: [{ u: ["user-a"], t: ["rooms"] }] });
    bus.receive("garbage");
    bus.receive(null);
    await wait(30);
    expect(seen).toEqual([]);
  });

  test("resync tells every local listener to refetch", async () => {
    const bus = createEventBus(5);
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe("user-a", (t) => a.push(t));
    bus.subscribe("user-b", (t) => b.push(t));
    bus.resync();
    await wait(30);
    expect([a, b]).toEqual([["resync"], ["resync"]]);
  });

  test("without a link nothing is queued for other instances", async () => {
    const bus = createEventBus(5);
    const sent: BusMessage[] = [];
    bus.link({ send: (m) => sent.push(m) });
    bus.link(undefined);
    bus.publish(["user-a"], "rooms");
    await wait(30);
    expect(sent).toEqual([]);
  });
});

describe("toMessages", () => {
  test("many users with the same topics split into messages that each fit a NOTIFY, with no user lost", () => {
    const users = Array.from(
      { length: 600 },
      (_, i) => `user-${String(i).padStart(4, "0")}-abcdefghijklmnop`,
    );
    const messages = toMessages("bus", [{ u: users, t: ["rooms", "attention"] }]);
    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages)
      expect(JSON.stringify(m).length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(messages.flatMap((m) => m.items.flatMap((i) => i.u)).sort()).toEqual([...users].sort());
  });
  test("a small batch stays one message", () => {
    expect(toMessages("bus", [{ u: ["a"], t: ["rooms"] }])).toEqual([
      { v: 1, from: "bus", items: [{ u: ["a"], t: ["rooms"] }] },
    ]);
  });
});

describe("work kicks", () => {
  test("a kick runs the local handler and goes over the link; a remote kick runs the handler without echo", () => {
    const a = createWork();
    const b = createWork();
    const ran: string[] = [];
    a.on("discussions", () => ran.push("a"));
    b.on("discussions", () => ran.push("b"));
    b.on("loop", (id) => ran.push(`b-loop:${id}`));
    a.link({ send: (m) => b.receive(m) });
    b.link({ send: (m) => a.receive(m) });
    a.kick("discussions");
    a.kick("loop", "l1");
    expect(ran).toEqual(["a", "b", "b-loop:l1"]);
  });
  test("an api process with no handlers only sends, and bad messages are ignored", () => {
    const api = createWork();
    const sent: unknown[] = [];
    api.link({ send: (m) => sent.push(m) });
    api.kick("loop", "l1");
    expect(sent).toHaveLength(1);
    api.receive({ v: 1, from: "x", k: "other" });
    api.receive("garbage");
  });
});
