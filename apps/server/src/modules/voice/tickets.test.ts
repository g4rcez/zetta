import { describe, expect, test } from "bun:test";
import { createPerMinute, createTicketStore } from "./tickets";

describe("tickets", () => {
  test("a ticket is redeemed once", () => {
    const store = createTicketStore<{ who: string }>();
    const t = store.mint({ who: "ana" });
    expect(store.redeem(t)).toEqual({ who: "ana" });
    expect(store.redeem(t)).toBeNull();
  });

  test("a ticket expires after about 30 seconds", () => {
    let now = 1_000;
    const store = createTicketStore<number>({ now: () => now });
    const early = store.mint(1);
    const late = store.mint(2);
    now += 29_999;
    expect(store.redeem(early)).toBe(1);
    now += 2;
    expect(store.redeem(late)).toBeNull();
  });

  test("an unknown or empty ticket gives nothing, and tickets differ", () => {
    const store = createTicketStore<number>();
    expect(store.redeem("nope")).toBeNull();
    expect(store.redeem("")).toBeNull();
    expect(store.mint(1)).not.toBe(store.mint(1));
  });

  test("a failed redeem does not spend a good ticket, and an expired one is swept", () => {
    let now = 0;
    const store = createTicketStore<number>({ now: () => now });
    const good = store.mint(1);
    expect(store.redeem("other")).toBeNull();
    expect(store.redeem(good)).toBe(1);
    store.mint(2);
    now += 31_000;
    store.mint(3);
    expect(store.size).toBe(1);
  });

  test("a flood of tickets cannot grow the store without end: the oldest goes first", () => {
    const store = createTicketStore<number>({ max: 3 });
    const first = store.mint(1);
    store.mint(2);
    store.mint(3);
    store.mint(4);
    expect(store.size).toBe(3);
    expect(store.redeem(first)).toBeNull();
  });
});

describe("per-minute limit", () => {
  test("allows the limit, refuses the next, and forgets after a minute", () => {
    let now = 0;
    const limit = createPerMinute(2, () => now);
    expect(limit.take("a")).toBe(true);
    expect(limit.take("a")).toBe(true);
    expect(limit.take("a")).toBe(false);
    expect(limit.take("b")).toBe(true);
    now += 60_001;
    expect(limit.take("a")).toBe(true);
  });
});
