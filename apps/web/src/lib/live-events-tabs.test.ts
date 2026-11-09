import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { HIDDEN_GRACE_MS, connectLiveEvents } from "./live-events";
import { queryClient } from "./query-client";
import { isLive, setLive } from "./query-policy";

/** A browser in miniature: tabs share the Web Lock and the BroadcastChannel; each tab has its own `document` visibility. */
const real = {
  EventSource: (globalThis as any).EventSource,
  BroadcastChannel: (globalThis as any).BroadcastChannel,
  document: (globalThis as any).document,
  window: (globalThis as any).window,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  locks: (globalThis.navigator as any)?.locks,
  invalidate: queryClient.invalidateQueries,
};

// ---- a manual clock, so the 30 s grace needs no waiting
let timers: { id: number; at: number; fn: () => void }[] = [];
let now = 0;
let nextTimer = 1;
const advance = (ms: number) => {
  const end = now + ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    now = due.at;
    timers = timers.filter((t) => t !== due);
    due.fn();
  }
  now = end;
};

// ---- the stream
class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private handlers = new Map<string, () => void>();
  constructor() {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: () => void) {
    this.handlers.set(name, fn);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(name: string) {
    this.handlers.get(name)?.();
  }
  get open() {
    return this.readyState !== FakeEventSource.CLOSED;
  }
}

// ---- tabs talking to each other
class FakeChannel {
  static all = new Set<FakeChannel>();
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor() {
    FakeChannel.all.add(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeChannel.all) if (other !== this) other.onmessage?.({ data });
  }
  close() {
    FakeChannel.all.delete(this);
  }
}

const locks = {
  held: false,
  queue: [] as {
    cb: () => Promise<void>;
    signal: AbortSignal;
    reject: (e: unknown) => void;
    resolve: () => void;
  }[],
  request(_name: string, opts: { signal: AbortSignal }, cb: () => Promise<void>) {
    return new Promise<void>((resolve, reject) => {
      const entry = { cb, signal: opts.signal, resolve, reject };
      opts.signal.addEventListener("abort", () => {
        locks.queue = locks.queue.filter((q) => q !== entry);
        reject(new Error("aborted"));
      });
      locks.queue.push(entry);
      locks.next();
    });
  },
  next() {
    if (locks.held) return;
    const entry = locks.queue.shift();
    if (!entry) return;
    locks.held = true;
    entry.cb().then(() => {
      locks.held = false;
      entry.resolve();
      locks.next();
    });
  },
};

/**
 * Each tab has its own `document` and `window`; `connectLiveEvents` reads those globals, so they are switched around each call.
 * Tabs live in separate pages in a browser, so the one-connection-per-page holder is cleared between them (`samePage` keeps it).
 */
function tab(hidden = false, { samePage = false, start = true } = {}) {
  const listeners = new Set<() => void>();
  const doc = {
    hidden,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  const events = new Map<string, Set<(e: any) => void>>();
  const win = {
    addEventListener: (name: string, fn: (e: any) => void) =>
      events.set(name, (events.get(name) ?? new Set()).add(fn)),
    removeEventListener: (name: string, fn: (e: any) => void) => events.get(name)?.delete(fn),
  };
  const use = () => {
    (globalThis as any).document = doc;
    (globalThis as any).window = win;
  };
  use();
  if (!samePage) (globalThis as any).zettaLiveEvents = undefined;
  const stop = connectLiveEvents();
  if (start) advance(0); // the connection starts on the next tick
  return {
    stop,
    listeners: () => listeners.size + [...events.values()].reduce((n, set) => n + set.size, 0),
    show: () => {
      doc.hidden = false;
      use();
      for (const fn of listeners) fn();
    },
    hide: () => {
      doc.hidden = true;
      use();
      for (const fn of listeners) fn();
    },
    fire: (name: string, event: object = {}) => {
      use();
      for (const fn of events.get(name) ?? []) fn(event);
    },
  };
}
const settle = () => new Promise<void>((r) => queueMicrotask(() => queueMicrotask(() => r())));
const open = () => FakeEventSource.instances.filter((s) => s.open);

let invalidated: unknown[][] = [];
beforeEach(() => {
  timers = [];
  now = 0;
  locks.held = false;
  locks.queue = [];
  invalidated = [];
  FakeEventSource.instances = [];
  FakeChannel.all.clear();
  Object.assign(globalThis, {
    EventSource: FakeEventSource,
    BroadcastChannel: FakeChannel,
    setTimeout: (fn: () => void, ms = 0) => {
      const id = nextTimer++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      timers = timers.filter((t) => t.id !== id);
    },
  });
  Object.defineProperty(globalThis.navigator, "locks", { value: locks, configurable: true });
  (queryClient as any).invalidateQueries = (filter: { queryKey: unknown[] }) => {
    invalidated.push(filter.queryKey);
    return Promise.resolve();
  };
});
afterEach(() => setLive(false));
afterAll(() => {
  Object.assign(globalThis, {
    EventSource: real.EventSource,
    BroadcastChannel: real.BroadcastChannel,
    document: real.document,
    window: real.window,
    setTimeout: real.setTimeout,
    clearTimeout: real.clearTimeout,
  });
  Object.defineProperty(globalThis.navigator, "locks", { value: real.locks, configurable: true });
  (queryClient as any).invalidateQueries = real.invalidate;
});

describe("live events across tabs", () => {
  test("three tabs share one stream, and a topic reaches every tab", async () => {
    const tabs = [tab(), tab(), tab()];
    await settle();
    expect(open()).toHaveLength(1);
    const stream = open()[0]!;
    stream.onopen?.();
    stream.onmessage?.({ data: JSON.stringify({ topic: "attention" }) });
    advance(300);
    // one refetch per tab for the same topic
    expect(invalidated.filter((k) => k[0] === "attention")).toHaveLength(3);
    expect(isLive()).toBe(true);
    tabs.forEach((t) => t.stop());
  });

  test("hiding and showing a tab inside the grace period keeps the same stream", async () => {
    const t = tab();
    await settle();
    t.hide();
    advance(HIDDEN_GRACE_MS - 1_000);
    t.show();
    advance(HIDDEN_GRACE_MS * 2);
    await settle();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(open()).toHaveLength(1);
    t.stop();
  });

  test("a tab hidden past the grace period gives the stream to another visible tab, which refetches everything", async () => {
    const a = tab();
    const b = tab();
    await settle();
    open()[0]!.onopen?.();
    a.hide();
    advance(HIDDEN_GRACE_MS + 1);
    await settle();
    expect(open()).toHaveLength(1); // b took over; a's stream is closed
    expect(FakeEventSource.instances).toHaveLength(2);
    invalidated = [];
    open()[0]!.onopen?.();
    advance(300);
    expect(invalidated).toContainEqual([]); // resync: every query on screen
    a.stop();
    b.stop();
  });

  test("a hidden tab does not open a stream", async () => {
    const t = tab(true);
    await settle();
    expect(FakeEventSource.instances).toHaveLength(0);
    t.stop();
  });

  test("an evicted stream closes and is not reopened at once", async () => {
    const t = tab();
    await settle();
    const stream = open()[0]!;
    stream.onopen?.();
    stream.emit("evicted");
    expect(stream.open).toBe(false);
    expect(isLive()).toBe(false);
    advance(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    advance(60_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    t.stop();
  });

  test("without Web Locks, each tab keeps its own stream", async () => {
    Object.defineProperty(globalThis.navigator, "locks", { value: undefined, configurable: true });
    const tabs = [tab(), tab()];
    expect(open()).toHaveLength(2);
    tabs.forEach((t) => t.stop());
    expect(open()).toHaveLength(0);
  });

  test("React's double mount in development opens no request for the throwaway first mount", async () => {
    const first = tab(false, { start: false });
    first.stop(); // the unmount of the first mount, before its start tick
    const second = tab(false, { samePage: true, start: false });
    advance(0);
    await settle();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(open()).toHaveLength(1);
    second.stop();
    expect(open()).toHaveLength(0);
  });

  test("a second connection on the same page lets go of the first one", async () => {
    const first = tab();
    await settle();
    expect(open()).toHaveLength(1);
    const second = tab(false, { samePage: true });
    await settle();
    expect(FakeEventSource.instances[0]!.open).toBe(false);
    expect(open()).toHaveLength(1);
    expect(first.listeners()).toBe(0);
    second.stop();
  });

  test("stopping removes every listener and closes the stream, the lock and the channel", async () => {
    const t = tab();
    await settle();
    open()[0]!.onopen?.();
    t.stop();
    t.stop(); // a second cleanup is harmless
    expect(open()).toHaveLength(0);
    expect(isLive()).toBe(false);
    expect(t.listeners()).toBe(0);
    expect(FakeChannel.all.size).toBe(0);
    await settle();
    expect(locks.held).toBe(false);
  });

  test("closing the page closes the stream at once and another tab takes the stream over", async () => {
    const a = tab();
    const b = tab();
    await settle();
    open()[0]!.onopen?.();
    a.fire("pagehide", { persisted: false });
    await settle();
    expect(FakeEventSource.instances[0]!.open).toBe(false);
    expect(open()).toHaveLength(1); // b, without waiting for the grace period
    a.stop();
    b.stop();
  });

  test("a page restored from the back/forward cache connects again", async () => {
    const t = tab();
    await settle();
    t.fire("pagehide", { persisted: true });
    await settle();
    expect(open()).toHaveLength(0);
    t.fire("pageshow", { persisted: true });
    await settle();
    expect(open()).toHaveLength(1);
    t.stop();
  });
});
