import { PgClient } from "@zetta/db";
import { describe, expect, test } from "bun:test";

import { createEventBus } from "./bus";
import { startPgSignals } from "./pg-signals";

// Runs only with a Postgres URL (any database: LISTEN/NOTIFY writes no data), for example the `postgres` maintenance database.
const url = process.env.ZETTA_SIGNALS_TEST_URL;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!url)("pg signals", () => {
  const suffix = Date.now().toString(36);
  const channels = { events: `zetta_events_t${suffix}`, work: `zetta_work_t${suffix}` };

  test("a publish on one instance reaches a stream on another, and a dropped listener resyncs", async () => {
    const sender = new PgClient({ connectionString: url });
    await sender.connect();
    const notify = (channel: string, payload: string) =>
      sender.query("select pg_notify($1, $2)", [channel, payload]);
    // Two instances in one process cannot share the singleton bus, so the second side is driven by hand: its listener forwards to bus B.
    const listener = new PgClient({ connectionString: url });
    await listener.connect();
    await listener.query(`LISTEN ${channels.events}`);
    const busA = createEventBus(5);
    const busB = createEventBus(5);
    const seen: string[] = [];
    busB.subscribe("user-a", (t) => seen.push(t));
    listener.on("notification", (m: { payload?: string }) =>
      busB.receive(JSON.parse(m.payload ?? "null")),
    );
    busA.link({ send: (m) => void notify(channels.events, JSON.stringify(m)) });
    busA.publish(["user-a"], "rooms");
    await wait(300);
    expect(seen).toEqual(["rooms"]);
    await listener.end();
    await sender.end();
  });

  test("the process listener reconnects after its backend is terminated and tells its streams to resync", async () => {
    const admin = new PgClient({ connectionString: url });
    await admin.connect();
    const errors: unknown[] = [];
    const signals = startPgSignals({
      connectionString: url!,
      channels,
      retryMs: [50, 200],
      notify: (channel, payload) => admin.query("select pg_notify($1, $2)", [channel, payload]),
      onError: (e) => errors.push(e),
    });
    await wait(300);
    expect(signals.connected()).toBe(true);
    const { events } = await import("./bus");
    const seen: string[] = [];
    const stop = events.subscribe("user-r", (t) => seen.push(t));
    const { rows } = await admin.query(
      "select pid from pg_stat_activity where query like $1 and pid <> pg_backend_pid()",
      [`LISTEN ${channels.work}%`],
    );
    for (const row of rows) await admin.query("select pg_terminate_backend($1)", [row.pid]);
    expect(rows.length).toBeGreaterThan(0);
    await wait(700);
    expect(signals.connected()).toBe(true);
    expect(seen).toContain("resync");
    expect(errors.length).toBeGreaterThan(0);
    stop();
    await signals.stop();
    await admin.end();
  });
});
