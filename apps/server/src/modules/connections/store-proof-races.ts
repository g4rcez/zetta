import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import type { StoreProofContext } from "./store.integration";

export async function runStoreRaces(c: StoreProofContext) {
  const { proof: { owner, first, second, firstDb, secondDb }, actors: [a, b], pids: [ownerPid, firstPid, secondPid] } = c;
  async function updateGate() {
    await owner.query(`create function connection_proof_update_gate() returns trigger language plpgsql as $$
      begin perform pg_advisory_xact_lock(2053461108,7010); return new; end $$;
      create trigger connection_proof_update_gate before update on connection for each row execute function connection_proof_update_gate();
      select pg_advisory_lock(2053461108,7010)`);
  }
  async function openGate() { await owner.query("select pg_advisory_unlock(2053461108,7010)"); }
  async function dropGate() { await owner.query("drop trigger connection_proof_update_gate on connection; drop function connection_proof_update_gate()"); }
  await c.scenario("concurrent empty-store bootstrap waits on shared advisory lock and yields one sentinel", async () => {
    await c.reset(); await owner.query("select pg_advisory_lock(2053461108,7002)");
    const one = c.capture(c.make(firstDb, true)); let two: ReturnType<typeof c.capture> | undefined;
    try {
      await c.wait(firstPid, ownerPid, "pg_advisory_xact_lock"); two = c.capture(c.make(secondDb, true));
      await c.wait(secondPid, ownerPid, "pg_advisory_xact_lock");
    } finally { await owner.query("select pg_advisory_unlock(2053461108,7002)"); await Promise.allSettled([one, two]); }
    const [x, y] = await Promise.all([one, two]); assert.equal(x.ok && y?.ok, true);
    const row = (await owner.query<{ checks: number; nonces: number; count: number }>(`select (select count(*)::int from connection_key_check) as checks,
      (select count(*)::int from connection_nonce) as nonces,(select encryption_count from connection_key_check) as count`)).rows[0];
    assert.equal(row?.checks === 1 && row.nonces === 1 && row.count === 1, true);
  });
  await c.scenario("concurrent duplicate create commits one result behind observed membership locks", async () => {
    const [s1, s2] = await c.fresh(); const input = c.input();
    await owner.query("begin; select user_id from membership where user_id='owner-a' for update");
    const one = c.capture(s1.createApiKey(a, input)); let two: typeof one | undefined;
    try { await c.wait(firstPid, ownerPid, "membership"); two = c.capture(s2.createApiKey(a, input)); await c.wait(secondPid, firstPid, "membership"); }
    finally { await owner.query("rollback"); await Promise.allSettled([one, two]); }
    const [x, y] = await Promise.all([one, two]); assert.equal(x.ok && y?.ok, true);
    if (!x.ok || !y?.ok) throw new Error("Duplicate create unavailable.");
    assert.equal(JSON.stringify(x.value) === JSON.stringify(y.value), true);
    const row = (await owner.query<{ connections: number; receipts: number; versions: number; nonces: number; encryptions: number }>(`select (select count(*)::int from connection) as connections,
      (select count(*)::int from connection_mutation_receipt) as receipts,(select count(*)::int from connection_credential) as versions,(select count(*)::int from connection_nonce) as nonces,
      (select encryption_count from connection_key_check) as encryptions`)).rows[0];
    assert.equal(row?.connections === 1 && row.receipts === 1 && row.versions === 1 && row.nonces === 2 && row.encryptions === 2, true);
  });
  for (const firstOperation of ["replace", "revoke"] as const) {
    await c.scenario(`${firstOperation} wins before competing mutation by observed membership ordering`, async () => {
      const [s1, s2] = await c.fresh(); const created = await s1.createApiKey(a, c.input()); await updateGate();
      const replace = { id: created.id, expectedRevision: 1, operationId: randomUUID(), secret: c.input().secret };
      const revoke = { id: created.id, expectedRevision: 1, operationId: randomUUID() };
      const one = c.capture(firstOperation === "replace" ? s1.replaceApiKey(a, replace) : s1.revoke(a, revoke));
      let two: typeof one | undefined;
      try {
        await c.wait(firstPid, ownerPid, "connection");
        two = c.capture(firstOperation === "replace" ? s2.revoke(a, revoke) : s2.replaceApiKey(a, replace));
        await c.wait(secondPid, firstPid, "membership");
      } finally { await openGate(); await Promise.allSettled([one, two]); await dropGate(); }
      {
        const [x, y] = await Promise.all([one, two]); assert.equal(x.ok && y?.ok === false && y.code === "conflict", true);
        const row = (await owner.query<{ revision: number; version: number; state: string }>("select revision,current_credential_version as version,state from connection where id=$1", [created.id])).rows[0];
        assert.equal(row?.revision === 2 && row.version === (firstOperation === "replace" ? 2 : 1) && row.state === (firstOperation === "replace" ? "active" : "revoked"), true);
      }
    });
  }
  await c.scenario("membership removal waits for earlier mutation then denies replay and later writes", async () => {
    const [store] = await c.fresh(); const input = c.input(); const created = await store.createApiKey(a, input); await updateGate();
    const one = c.capture(store.replaceApiKey(a, { id: created.id, expectedRevision: 1, operationId: randomUUID(), secret: input.secret }));
    let removal: Promise<{ readonly ok: boolean }> | undefined;
    try {
      await c.wait(firstPid, ownerPid, "connection");
      removal = c.capture(second.query("update membership set status='removed',removed_at=now() where user_id='owner-a'"));
      await c.wait(secondPid, firstPid, "membership");
    } finally { await openGate(); await Promise.allSettled([one, removal]); await dropGate(); }
    {
      assert.equal((await one).ok, true); assert.equal((await removal)?.ok, true);
      await c.deny(() => store.createApiKey(a, input), "ACCESS_DENIED");
      await c.deny(() => store.revoke(a, { id: created.id, expectedRevision: 2, operationId: randomUUID() }), "ACCESS_DENIED");
    }
  });
  await c.scenario("earlier committed removal denies waiting replacement after fresh row read", async () => {
    const [store] = await c.fresh(); const created = await store.createApiKey(a, c.input()); const before = await c.counts();
    await second.query("begin; update membership set status='removed',removed_at=now() where user_id='owner-a'");
    const mutation = c.capture(store.replaceApiKey(a, { id: created.id, expectedRevision: 1, operationId: randomUUID(), secret: c.input().secret }));
    try { await c.wait(firstPid, secondPid, "membership"); }
    finally { await second.query("commit"); await mutation; }
    const result = await mutation; assert.equal(!result.ok && result.code === "ACCESS_DENIED", true); assert.equal(await c.counts(), before);
  });
  await c.scenario("last encryption capacity is serialized across independent owners", async () => {
    const [s1, s2] = await c.fresh(); await owner.query("update connection_key_check set encryption_count=999999");
    await owner.query("begin; select id from connection_key_check for update");
    const one = c.capture(s1.createApiKey(a, c.input())); let two: typeof one | undefined;
    try {
      await c.wait(firstPid, ownerPid, "connection_key_check"); two = c.capture(s2.createApiKey(b, c.input()));
      await c.wait(secondPid, firstPid, "connection_key_check");
    } finally { await owner.query("rollback"); await Promise.allSettled([one, two]); }
    const results = await Promise.all([one, two]);
    assert.equal(results.filter(result => result?.ok).length, 1);
    assert.equal(results.filter(result => result?.ok === false && result.code === "key-capacity").length, 1);
    const row = (await owner.query<{ count: number; connections: number; nonces: number }>(`select encryption_count as count,
      (select count(*)::int from connection) as connections,(select count(*)::int from connection_nonce) as nonces from connection_key_check`)).rows[0];
    assert.equal(row?.count === 1000000 && row.connections === 1 && row.nonces === 2, true);
  });
  await c.scenario("expiry is checked using database clock after key-check lock acquisition", async () => {
    const [store] = await c.fresh(); const now = (await owner.query<{ now: string }>("select floor(extract(epoch from clock_timestamp())*1000)::text as now")).rows[0]; assert.ok(now);
    const input = { ...c.input(), expiresAt: Number(now.now) + 1000 }; const before = await c.counts();
    await owner.query("begin; select id from connection_key_check for update"); const pending = c.capture(store.createApiKey(a, input));
    try {
      await c.wait(firstPid, ownerPid, "connection_key_check");
      const beforeExpiry = (await owner.query<{ future: boolean }>("select floor(extract(epoch from clock_timestamp())*1000)<$1 as future", [input.expiresAt])).rows[0];
      assert.equal(beforeExpiry?.future, true);
      const until = performance.now() + 1500;
      while (true) {
        assert.equal(performance.now() < until, true);
        if ((await owner.query<{ expired: boolean }>("select floor(extract(epoch from clock_timestamp())*1000)>=$1 as expired", [input.expiresAt])).rows[0]?.expired) break;
      }
    } finally { await owner.query("rollback"); await pending; }
    const result = await pending; assert.equal(!result.ok && result.code === "invalid-input", true); assert.equal(await c.counts(), before);
  });
  // Readback on the independent reserved client confirms there is no lingering transaction.
  assert.equal((await first.query<{ state: string }>("select state from pg_stat_activity where pid=$1", [secondPid])).rows[0]?.state, "idle");
}
