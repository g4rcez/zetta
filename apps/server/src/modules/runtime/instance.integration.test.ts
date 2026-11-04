import { createDb } from "@zetta/db";
import { and, eq, inArray, sql } from "@zetta/db/query";
import { chatQueue } from "@zetta/db/schema/chat";
import { serverInstance } from "@zetta/db/schema/runtime";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createInstance, recoverable, setInstance } from "./instance";

// Needs a database with the migrations applied (a scratch one, never the dev database): ZETTA_INSTANCE_TEST_DATABASE_URL=postgresql://...
const url = process.env.ZETTA_INSTANCE_TEST_DATABASE_URL;

describe.skipIf(!url)("server instances and owner-scoped recovery", () => {
  const db = createDb({ DATABASE_URL: url! } as never);
  const name = (n: string) => `test-${n}-${Date.now().toString(36)}`;
  const instances: ReturnType<typeof createInstance>[] = [];
  const made = (role: "all" | "api" | "worker", n: string) => {
    const i = createInstance({ db, role, name: name(n), fresh: true, onFenced: () => {} });
    instances.push(i);
    return i;
  };
  const ago = (id: string, seconds: number) =>
    db.execute(
      sql`update ${serverInstance} set heartbeat_at = now() - make_interval(secs => ${seconds}) where id = ${id}`,
    );
  const ids = [
    "01900000-0000-7000-8000-0000000000e1",
    "01900000-0000-7000-8000-0000000000e2",
    "01900000-0000-7000-8000-0000000000e3",
    "01900000-0000-7000-8000-0000000000e4",
  ];
  /** The queue rows a recovery with this scope would take. */
  const taken = async (scope: { unowned: boolean }) =>
    (
      await db
        .select({ id: chatQueue.id })
        .from(chatQueue)
        .where(
          and(
            inArray(chatQueue.id, ids),
            eq(chatQueue.status, "running"),
            recoverable(chatQueue.ownerInstance, scope),
          ),
        )
    )
      .map((r) => ids.indexOf(r.id))
      .sort();

  beforeEach(async () => {
    // A scratch database: every instance left over from an earlier test or run counts as stopped, so each test starts alone.
    await db.execute(sql`update ${serverInstance} set stopped_at = now() where stopped_at is null`);
    await db.delete(chatQueue).where(eq(chatQueue.ownerUserId, "u1"));
  });
  afterEach(async () => {
    await Promise.all(instances.splice(0).map((i) => i.stop()));
  });
  afterAll(async () => {
    setInstance(undefined);
    await db.delete(chatQueue).where(eq(chatQueue.ownerUserId, "u1"));
    await Promise.all(instances.map((i) => i.stop()));
    await db.execute(sql`delete from ${serverInstance} where name like 'test-%'`);
  });

  async function seed(owners: (string | null)[]) {
    // One conversation per row: the unique index allows one running row per conversation. Foreign keys are skipped (no users here).
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      for (const [i, owner] of owners.entries())
        await tx.execute(sql`insert into zetta.chat_queue (id, owner_user_id, conversation_id, message_id, status, owner_instance)
          values (${ids[i]}, 'u1', ${`01900000-0000-7000-8000-0000000000c${i}`}, ${`01900000-0000-7000-8000-0000000000a${i}`}, 'running', ${owner})`);
    });
  }

  test("starting registers the process, and a restart with the same name retires the old row", async () => {
    const first = made("worker", "restart");
    await first.start();
    const second = createInstance({
      db,
      role: "worker",
      name: first.name,
      fresh: true,
      onFenced: () => {},
    });
    instances.push(second);
    await second.start();
    const rows = await db.select().from(serverInstance).where(eq(serverInstance.name, first.name));
    expect(rows.find((r) => r.id === first.id)?.stoppedAt).not.toBeNull();
    expect(rows.find((r) => r.id === second.id)?.stoppedAt).toBeNull();
  });

  test("a live peer's work is left alone; a dead peer's is taken", async () => {
    const me = made("worker", "me");
    await me.start();
    const live = made("worker", "live");
    await live.start();
    const dead = made("worker", "dead");
    await dead.start();
    await ago(dead.id, 3600);
    await seed([live.id, dead.id, me.id, null]);
    // Periodic: only the dead owner's row (index 1). Unowned rows wait for a boot.
    expect(await taken({ unowned: false })).toEqual([1]);
    // Boot while another worker is alive: the scope does not take unowned rows.
    expect(await me.recoveryScope(true)).toEqual({ unowned: false });
    // Boot with no live peer: dead owner and unowned rows (1 and 3), still not a live row.
    await ago(live.id, 3600);
    expect(await me.recoveryScope(true)).toEqual({ unowned: true });
    expect(await taken({ unowned: true })).toEqual([0, 1, 3]);
  });

  test("an instance that stopped counts as dead at once", async () => {
    const me = made("all", "stopped");
    await me.start();
    const other = made("worker", "stopper");
    await other.start();
    await seed([other.id]);
    expect(await taken({ unowned: false })).toEqual([]);
    await other.stop();
    setInstance(me);
    expect(await taken({ unowned: false })).toEqual([0]);
  });

  test("api instances do not block unowned recovery at boot", async () => {
    const me = made("worker", "boot");
    await me.start();
    const api = made("api", "front");
    await api.start();
    expect(await me.recoveryScope(true)).toEqual({ unowned: true });
  });

  test("the heartbeat refreshes the row, and a replaced instance is told to stop", async () => {
    const reasons: string[] = [];
    const me = createInstance({
      db,
      role: "worker",
      name: name("fence"),
      heartbeatMs: 30,
      onFenced: (r) => reasons.push(r),
    });
    instances.push(me);
    await me.start();
    await db.execute(
      sql`update ${serverInstance} set heartbeat_at = now() - interval '1 hour' where id = ${me.id}`,
    );
    await new Promise((r) => setTimeout(r, 150));
    const [row] = await db.select().from(serverInstance).where(eq(serverInstance.id, me.id));
    expect(Date.now() - row!.heartbeatAt.getTime()).toBeLessThan(10_000); // refreshed by the heartbeat
    expect(reasons).toEqual([]);
    await db.execute(sql`update ${serverInstance} set stopped_at = now() where id = ${me.id}`);
    await new Promise((r) => setTimeout(r, 150));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("took this instance's name");
  });
});
