import { strict as assert } from "node:assert";
import type { RunStoreProofContext } from "./runs.integration";

const result = { version: 1 as const, text: "Synthetic completion", errorCode: null, lastSequence: 3 };
export async function runOwnedRaces(c: RunStoreProofContext) {
  const { proof: { owner, second, firstDb, secondDb }, actors: [a], pids: [ownerPid, firstPid, secondPid] } = c;
  async function gate() {
    await owner.query(`create function run_store_proof_update_gate() returns trigger language plpgsql as $$
      begin perform pg_advisory_xact_lock(2053461108,9002); return new; end $$;
      create trigger run_store_proof_update_gate before update on runs for each row execute function run_store_proof_update_gate();
      select pg_advisory_lock(2053461108,9002)`);
  }
  async function release() { await owner.query("select pg_advisory_unlock(2053461108,9002)"); }
  async function drop() { await owner.query("drop trigger run_store_proof_update_gate on runs; drop function run_store_proof_update_gate()"); }
  await c.scenario("concurrent same-key submissions serialize and commit exactly one attempt", async () => {
    const [oneStore, twoStore] = await c.fresh(), input = c.input();
    await owner.query("begin; select user_id from membership where user_id='owner-a' for update");
    const one = c.capture(oneStore.submitOwned(a, input)); let two: typeof one | undefined;
    try { await c.wait(firstPid, ownerPid, "membership"); two = c.capture(twoStore.submitOwned(a, input)); await c.wait(secondPid, firstPid, "membership"); }
    finally { await owner.query("rollback"); await Promise.allSettled([one, two]); }
    const [x, y] = await Promise.all([one, two]); assert.ok(x.ok && y?.ok); assert.deepEqual(x.value, y.value);
    const counts = (await owner.query<{ runs: number; attempts: number }>("select (select count(*)::int from runs) as runs,(select count(*)::int from run_attempts) as attempts")).rows[0];
    assert.equal(counts?.runs === 1 && counts.attempts === 1, true);
  });
  for (const winner of ["cancel", "completion"] as const) {
    await c.scenario(`${winner} wins observed cancel completion ordering without duplicate terminal writes`, async () => {
      const [s1, s2] = await c.fresh(), created = await s1.submitOwned(a, c.input()), running = await c.stage(s1, created);
      await gate();
      const one = c.capture(winner === "cancel" ? s1.cancelOwned(a, { runId: running.id, expectedRevision: running.revision })
        : c.backend(firstDb, a, running, { type: "completed", atMs: 0, outcome: "succeeded", result }));
      let two: typeof one | undefined;
      try {
        await c.wait(firstPid, ownerPid, "runs");
        two = c.capture(winner === "cancel" ? c.backend(secondDb, a, running, { type: "completed", atMs: 0, outcome: "succeeded", result })
          : s2.cancelOwned(a, { runId: running.id, expectedRevision: running.revision }));
        await c.wait(secondPid, firstPid, "membership");
      } finally { await release(); await Promise.allSettled([one, two]); await drop(); }
      const [x, y] = await Promise.all([one, two]); assert.ok(x.ok && y?.ok);
      const final = await s1.getOwned(a, { runId: running.id }); assert.equal(final.status, winner === "cancel" ? "cancelled" : "succeeded");
      assert.equal(final.effectState, "known"); assert.equal(final.revision, running.revision + (winner === "cancel" ? 2 : 1));
      const replay = await c.backend(secondDb, a, final, { type: "completed", atMs: 0, outcome: "succeeded", result });
      assert.deepEqual(replay, final); assert.equal(replay.finishedAtMs, final.finishedAtMs);
      assert.equal((await owner.query<{ count: number }>("select count(*)::int as count from run_attempts where run_id=$1", [final.id])).rows[0]?.count, 1);
    });
  }
  for (const duplicate of [true, false]) {
    await c.scenario(`${duplicate ? "identical" : "conflicting"} completion waits and retains first terminal timestamp`, async () => {
      const [s1] = await c.fresh(), run = await s1.submitOwned(a, c.input()), running = await c.stage(s1, run);
      await gate();
      const one = c.capture(c.backend(firstDb, a, running, { type: "completed", atMs: 0, outcome: "succeeded", result }));
      let two: typeof one | undefined;
      try {
        await c.wait(firstPid, ownerPid, "runs");
        two = c.capture(c.backend(secondDb, a, running, { type: "completed", atMs: 0, outcome: duplicate ? "succeeded" : "failed", result }));
        await c.wait(secondPid, firstPid, "membership");
      } finally { await release(); await Promise.allSettled([one, two]); await drop(); }
      const [x, y] = await Promise.all([one, two]); assert.ok(x.ok);
      if (duplicate) { assert.ok(y?.ok); assert.deepEqual(y.value, x.value); }
      else assert.equal(y?.ok === false && y.code === "transition_conflict", true);
      assert.deepEqual(await s1.getOwned(a, { runId: run.id }), x.value);
      await c.deny(() => c.backend(secondDb, a, x.value, { type: "completed", atMs: 0, outcome: "succeeded", result }, { generation: 2 }), "stale_attempt");
      await c.deny(() => c.backend(secondDb, a, x.value, { type: "completed", atMs: 0, outcome: "succeeded", result }, { leaseId: null }), "stale_attempt");
    });
  }
  await c.scenario("membership removal waits for prior cancellation then denies repair and reads", async () => {
    const [store] = await c.fresh(), input = c.input(), run = await store.submitOwned(a, input); await gate();
    const mutation = c.capture(store.cancelOwned(a, { runId: run.id, expectedRevision: 1 }));
    let removal: ReturnType<typeof c.capture> | undefined;
    try {
      await c.wait(firstPid, ownerPid, "runs");
      removal = c.capture(second.query("update membership set status='removed',removed_at=now() where user_id='owner-a'"));
      await c.wait(secondPid, firstPid, "membership");
    } finally { await release(); await Promise.allSettled([mutation, removal]); await drop(); }
    assert.equal((await mutation).ok, true); assert.equal((await removal)?.ok, true);
    await c.deny(() => store.submitOwned(a, input), "ACCESS_DENIED");
    await c.deny(() => store.getOwned(a, { runId: run.id }), "ACCESS_DENIED");
  });
  await c.scenario("earlier committed membership removal denies waiting cancellation without lifecycle write", async () => {
    const [store] = await c.fresh(), run = await store.submitOwned(a, c.input());
    await second.query("begin; update membership set status='removed',removed_at=now() where user_id='owner-a'");
    const mutation = c.capture(store.cancelOwned(a, { runId: run.id, expectedRevision: 1 }));
    try { await c.wait(firstPid, secondPid, "membership"); }
    finally { await second.query("commit"); await mutation; }
    const denied = await mutation; assert.equal(!denied.ok && denied.code === "ACCESS_DENIED", true);
    const row = (await owner.query<{ status: string; revision: number; intent: Date | null }>("select status,revision,cancel_requested_at as intent from runs where id=$1", [run.id])).rows[0];
    assert.equal(row?.status === "queued" && row.revision === 1 && row.intent === null, true);
  });
  for (const pid of [firstPid, secondPid]) assert.equal((await owner.query<{ state: string }>("select state from pg_stat_activity where pid=$1", [pid])).rows[0]?.state, "idle");
}
