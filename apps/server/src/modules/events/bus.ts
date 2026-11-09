/**
 * In-process bus behind `GET /api/events`. A publish says "this topic changed for these users"; it never carries data, so the web app
 * refetches through the normal routes and those keep deciding who may see what.
 *
 * With several servers, a `link` (Postgres NOTIFY, see pg-signals.ts) carries each publish to the other instances, which deliver it to
 * their own open streams. Without a link the bus is local only, which is exactly one process.
 *
 * A publish is delivered after `delayMs`, and equal topics in that window become one event. Writers publish inside transactions,
 * and the delay lets them commit before a client reads again.
 */
import { uuidv7 } from "@zetta/core/uuid";

/** One publish as it crosses processes: who and what changed. */
export type BusItem = { u: string[]; t: string[] };
/** What a link carries: batches from one instance. */
export type BusMessage = { v: 1; from: string; items: BusItem[] };
export type BusLink = { send(message: BusMessage): void };

export type SubscribeOptions = { max?: number; onEvict?: () => void };

type Entry = { listener: (topic: string) => void; onEvict?: () => void };

export type EventBus = {
  /**
   * Calls `listener` for each topic published to `userId`. Returns the function that stops it.
   * With `max`, a user who already has `max` listeners loses the oldest one first: its `onEvict` runs and it is removed.
   */
  subscribe(
    userId: string,
    listener: (topic: string) => void,
    options?: SubscribeOptions,
  ): () => void;
  publish(userIds: Iterable<string>, ...topics: string[]): void;
  /** How many listeners the user has now (one per open tab). */
  count(userId: string): number;
  /** Connects the bus to other instances (or disconnects it with `undefined`). */
  link(link: BusLink | undefined): void;
  /** Delivers what another instance published. Its own messages are ignored. */
  receive(message: unknown): void;
  /** Tells every open stream to refetch: events may have been missed (the link was down). */
  resync(): void;
  /** Identity of this bus on the link. */
  readonly id: string;
};

/** NOTIFY payloads are limited to 8000 bytes; stay under it with room for the envelope. */
export const MAX_MESSAGE_BYTES = 7_500;

const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Splits items into messages that each fit a NOTIFY. A single item with many users is split by users. */
export function toMessages(from: string, items: BusItem[]): BusMessage[] {
  const messages: BusMessage[] = [];
  let current: BusItem[] = [];
  const room = (next: BusItem[]) => size({ v: 1, from, items: next }) <= MAX_MESSAGE_BYTES;
  const flush = () => {
    if (current.length) messages.push({ v: 1, from, items: current });
    current = [];
  };
  for (const item of items) {
    let users = item.u;
    while (users.length) {
      // Take as many users as fit next to what is already in this message.
      let take = users.length;
      while (take > 1 && !room([...current, { u: users.slice(0, take), t: item.t }]))
        take = Math.floor(take / 2);
      const next = { u: users.slice(0, take), t: item.t };
      if (!room([...current, next])) {
        if (!current.length) {
          current = [next]; // one user alone is already too large (an absurd topic list): send it anyway
          flush();
          users = users.slice(take);
          continue;
        }
        flush();
        continue;
      }
      current.push(next);
      users = users.slice(take);
    }
  }
  flush();
  return messages;
}

export function createEventBus(delayMs = 100): EventBus {
  const id = uuidv7();
  const listeners = new Map<string, Set<Entry>>();
  const pending = new Map<string, Set<string>>();
  const outbox = new Map<string, Set<string>>(); // user -> topics, waiting to leave for other instances
  let link: BusLink | undefined;
  let outboxTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = (userId: string) => {
    const topics = pending.get(userId);
    pending.delete(userId);
    for (const topic of topics ?? [])
      for (const { listener } of Array.from(listeners.get(userId) ?? []))
        // a copy: a listener may leave while we call the others
        try {
          listener(topic);
        } catch {
          /* a closed stream: its cancel() removes the listener */
        }
  };
  const deliver = (userIds: Iterable<string>, topics: string[]) => {
    for (const userId of new Set(userIds)) {
      if (!listeners.has(userId)) continue; // nobody is listening here: queue nothing
      let set = pending.get(userId);
      if (!set) {
        pending.set(userId, (set = new Set()));
        setTimeout(() => flush(userId), delayMs);
      }
      for (const topic of topics) set.add(topic);
    }
  };
  const sendOutbox = () => {
    outboxTimer = undefined;
    if (!link || outbox.size === 0) return void outbox.clear();
    // Users with the same topics travel together.
    const byTopics = new Map<string, BusItem>();
    for (const [user, topics] of outbox) {
      const t = [...topics].sort();
      const key = t.join("\u0000");
      const item = byTopics.get(key) ?? { u: [], t };
      item.u.push(user);
      byTopics.set(key, item);
    }
    outbox.clear();
    for (const message of toMessages(id, [...byTopics.values()]))
      try {
        link.send(message);
      } catch {
        /* the link reports its own failures; other instances catch up on their next poll or resync */
      }
  };

  return {
    id,
    subscribe(userId, listener, options = {}) {
      const set = listeners.get(userId) ?? new Set<Entry>();
      listeners.set(userId, set);
      // Sets keep insertion order: the first entry is the oldest stream.
      while (options.max !== undefined && set.size >= options.max) {
        const oldest = set.values().next().value as Entry;
        set.delete(oldest);
        try {
          oldest.onEvict?.();
        } catch {
          /* a closed stream */
        }
      }
      const entry: Entry = { listener, onEvict: options.onEvict };
      set.add(entry);
      listeners.set(userId, set); // an evicted stream's own unsubscribe may have dropped an emptied set
      return () => {
        set.delete(entry);
        if (set.size === 0 && listeners.get(userId) === set) listeners.delete(userId);
      };
    },
    publish(userIds, ...topics) {
      const users = [...new Set(userIds)];
      deliver(users, topics);
      if (!link) return;
      // The send side keeps every user: the listener may be on another instance.
      for (const user of users) {
        const set = outbox.get(user) ?? new Set();
        for (const topic of topics) set.add(topic);
        outbox.set(user, set);
      }
      outboxTimer ??= setTimeout(sendOutbox, delayMs);
    },
    count: (userId) => listeners.get(userId)?.size ?? 0,
    link(next) {
      link = next;
      if (!next) {
        clearTimeout(outboxTimer);
        outboxTimer = undefined;
        outbox.clear();
      }
    },
    receive(message) {
      const m = message as Partial<BusMessage> | null;
      if (!m || m.v !== 1 || m.from === id || !Array.isArray(m.items)) return;
      for (const item of m.items)
        if (Array.isArray(item?.u) && Array.isArray(item?.t)) deliver(item.u, item.t);
    },
    resync() {
      for (const userId of listeners.keys()) deliver([userId], ["resync"]);
    },
    // Delivery of a remote publish waits the same short window, so a burst across instances is one event too.
  };
}

// `bun --hot` reloads modules: keep one bus, or open streams would hear a bus no writer uses.
const holder = globalThis as { zettaEvents?: EventBus };
export const events: EventBus = (holder.zettaEvents ??= createEventBus());
