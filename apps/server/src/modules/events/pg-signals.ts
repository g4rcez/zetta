import { PgClient } from "@zetta/db";

import { events, type BusLink } from "./bus";
import { work, type WorkLink } from "./work";

export type SignalChannels = { events: string; work: string };
export const CHANNELS: SignalChannels = { events: "zetta_events", work: "zetta_work" };

type Options = {
  connectionString: string;
  /** Sends one NOTIFY. Runs on the normal pool: a NOTIFY is queued by Postgres until the sending transaction commits. */
  notify: (channel: string, payload: string) => Promise<unknown>;
  channels?: SignalChannels;
  /** First and last wait before a reconnect. */
  retryMs?: [number, number];
  onError?: (error: unknown) => void;
};

/**
 * Connects the event bus and the work kicks of this process to the other instances through Postgres LISTEN/NOTIFY.
 * One dedicated connection per process listens; sending uses the pool. NOTIFY loses what happens while the listener is down, so after
 * every reconnect the bus tells its open streams to refetch (`resync`). Returns `stop`.
 */
export function startPgSignals({
  connectionString,
  notify,
  channels = CHANNELS,
  retryMs = [1_000, 30_000],
  onError,
}: Options) {
  let client: PgClient | undefined;
  let stopped = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let connected = false;

  const send = (channel: string, message: unknown) => {
    const payload = JSON.stringify(message);
    void notify(channel, payload).catch((e) => onError?.(e));
  };
  const busLink: BusLink = { send: (m) => send(channels.events, m) };
  const workLink: WorkLink = { send: (m) => send(channels.work, m) };

  const lost = (e?: unknown) => {
    if (e) onError?.(e);
    connected = false;
    const dead = client;
    client = undefined;
    dead?.removeAllListeners();
    dead?.on("error", () => {}); // a late error on a dropped client must not crash the process
    void dead?.end().catch(() => {});
    if (stopped || retry) return;
    const wait = Math.min(retryMs[1], retryMs[0] * 2 ** attempt++);
    retry = setTimeout(() => {
      retry = undefined;
      void open();
    }, wait);
  };

  async function open() {
    if (stopped || client) return;
    const next = new PgClient({ connectionString, keepAlive: true });
    client = next;
    next.on("error", lost);
    next.on("end", () => client === next && lost());
    next.on("notification", (m: { channel: string; payload?: string }) => {
      let payload: unknown;
      try {
        payload = JSON.parse(m.payload ?? "null");
      } catch {
        return;
      }
      if (m.channel === channels.events) events.receive(payload);
      else if (m.channel === channels.work) work.receive(payload);
    });
    try {
      await next.connect();
      await next.query(`LISTEN ${channels.events}`);
      await next.query(`LISTEN ${channels.work}`);
    } catch (e) {
      if (client === next) lost(e);
      return;
    }
    const reconnected = attempt > 0;
    attempt = 0;
    connected = true;
    // Events published while the listener was away are gone: the open streams refetch what they show.
    if (reconnected) events.resync();
  }

  events.link(busLink);
  work.link(workLink);
  void open();

  return {
    connected: () => connected,
    async stop() {
      stopped = true;
      clearTimeout(retry);
      events.link(undefined);
      work.link(undefined);
      const last = client;
      client = undefined;
      last?.removeAllListeners();
      await last?.end().catch(() => {});
    },
  };
}
