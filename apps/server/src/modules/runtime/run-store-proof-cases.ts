import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import type { Database } from "@zetta/db";
import type { RunStoreProofContext } from "./runs.integration";

const result = { version: 1 as const, text: "Synthetic private result", errorCode: null, lastSequence: 3 };
export async function runOwnedCases(c: RunStoreProofContext) {
  const { proof: { owner, firstDb, secondDb }, actors: [a, b, admin] } = c;
  await c.scenario("same-key A and B submissions are independent and replay current DTO exactly", async () => {
    const [store, other] = await c.fresh(), input = c.input();
    const one = await store.submitOwned(a, input), two = await other.submitOwned(b, input);
    assert.notEqual(one.id, two.id); assert.notEqual(one.attemptId, two.attemptId);
    assert.deepEqual(await store.submitOwned(a, input), one);
    const { model: _model, resumeReference: _resume, ...omitted } = input.input;
    assert.deepEqual(await store.submitOwned(a, { ...input, input: omitted }), one);
    await c.deny(() => store.getResultOwned(a, { runId: one.id, attemptId: one.attemptId }), "result_pending");
    const cancelled = await store.cancelOwned(a, { runId: one.id, expectedRevision: one.revision });
    assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.effectState, "no_effect");
    assert.deepEqual(await store.submitOwned(a, input), cancelled);
    assert.deepEqual(await store.cancelOwned(a, { runId: one.id, expectedRevision: one.revision }), cancelled);
    const terminal = await store.getResultOwned(a, { runId: one.id, attemptId: one.attemptId }); assert.equal(terminal.result, null);
    const counts = (await owner.query<{ runs: number; attempts: number }>("select (select count(*)::int from runs) as runs,(select count(*)::int from run_attempts) as attempts")).rows[0];
    assert.equal(counts?.runs === 2 && counts.attempts === 2, true);
  });
  await c.scenario("each supported semantic change conflicts and unsupported or extra syntax cannot enqueue", async () => {
    const [store] = await c.fresh(), input = c.input(); await store.submitOwned(a, input); const before = await c.counts();
    const changed = [
      { ...input, origin: "setup" }, { ...input, botId: "different" }, { ...input, conversationId: "different" },
      { ...input, configurationId: "different" }, { ...input, configurationVersion: 2 },
      { ...input, input: { ...input.input, prompt: input.input.prompt.normalize("NFC") } },
      { ...input, input: { ...input.input, prompt: input.input.prompt.trim() } }, { ...input, input: { ...input.input, model: "model" } },
      ...Object.entries({ deadlineMs: 2000, maxEvents: 11, maxOutputBytes: 1001, maxToolBytes: 101, maxToolCalls: 2 })
        .map(([key, value]) => ({ ...input, input: { ...input.input, budgets: { ...input.input.budgets, [key]: value } } })),
    ];
    for (const request of changed) await c.deny(() => store.submitOwned(a, request), "request_conflict");
    for (const change of [{ harness: "pi" }, { connections: [{ reference: "synthetic", credentialVersion: 1 }] }, { resumeReference: "synthetic" }])
      await c.deny(() => store.submitOwned(a, { ...input, input: { ...input.input, ...change } }), "unsupported");
    for (const change of [{ ownerUserId: "owner-b" }, { configurationVersion: "1" }, { requestKey: "bad" }])
      await c.deny(() => store.submitOwned(a, { ...input, ...change }), "invalid_input");
    for (const change of [{ prompt: 1 }, { budgets: { ...input.input.budgets, maxEvents: "10" } }, { connections: null }])
      await c.deny(() => store.submitOwned(a, { ...input, input: { ...input.input, ...change } }), "invalid_input");
    assert.equal(await c.counts(), before);
  });
  await c.scenario("foreign admin forged and removed actors cannot access another owner or bypass all method gates", async () => {
    const [store] = await c.fresh(), input = c.input(), run = await store.submitOwned(a, input);
    for (const actor of [b, admin]) {
      await c.deny(() => store.getOwned(actor, { runId: run.id }), "not_found");
      await c.deny(() => store.getResultOwned(actor, { runId: run.id, attemptId: run.attemptId }), "not_found");
      await c.deny(() => store.cancelOwned(actor, { runId: run.id, expectedRevision: 1 }), "not_found");
      await c.deny(() => store.submitOwned(actor, { ...input, ownerUserId: a.userId }), "invalid_input");
    }
    const forged = Object.freeze({ ...a, isAdmin: true });
    for (const actor of [forged, a]) {
      if (actor === a) await owner.query("update membership set status='removed',removed_at=now() where user_id='owner-a'");
      const code = actor === a ? "ACCESS_DENIED" : "NOT_FOUND";
      for (const work of [() => store.submitOwned(actor, input), () => store.getOwned(actor, { runId: run.id }),
        () => store.getResultOwned(actor, { runId: run.id, attemptId: run.attemptId }), () => store.cancelOwned(actor, { runId: run.id, expectedRevision: 1 })]) await c.deny(work, code);
    }
  });
  await c.scenario("stale revision denies queued and running cancellation while intent retains actual effects", async () => {
    const [store] = await c.fresh(), run = await store.submitOwned(a, c.input());
    await c.deny(() => store.cancelOwned(a, { runId: run.id, expectedRevision: 2 }), "stale_revision");
    const running = await c.stage(store, run);
    await c.deny(() => store.getResultOwned(a, { runId: run.id, attemptId: run.attemptId }), "result_pending");
    await c.deny(() => store.cancelOwned(a, { runId: run.id, expectedRevision: 1 }), "stale_revision");
    const cancelled = await store.cancelOwned(a, { runId: run.id, expectedRevision: running.revision });
    assert.equal(cancelled.status, "running"); assert.equal(cancelled.effectState, "uncertain"); assert.ok(cancelled.cancelRequestedAtMs);
    assert.equal(cancelled.finishedAtMs, null);
    const done = await c.backend(firstDb, a, cancelled, { type: "completed", atMs: 0, outcome: "succeeded", result });
    assert.equal(done.status, "cancelled"); assert.equal(done.effectState, "known");
    const row = (await owner.query<{ stopped: Date | null }>("select stop_confirmed_at as stopped from run_attempts where id=$1", [run.attemptId])).rows[0];
    assert.equal(row?.stopped, null);
  });
  await c.scenario("current and historical private results bind run owner attempt and original budget", async () => {
    const [store, other] = await c.fresh(), run = await store.submitOwned(a, c.input());
    const foreign = await other.submitOwned(b, c.input()), another = await store.submitOwned(a, c.input()); await c.stage(store, run);
    const done = await c.backend(firstDb, a, run, { type: "completed", atMs: 0, outcome: "succeeded", result });
    const original = await store.getResultOwned(a, { runId: run.id, attemptId: run.attemptId }); assert.deepEqual(original.result, result);
    assert.deepEqual(await c.make(secondDb).getResultOwned(a, { runId: run.id, attemptId: run.attemptId }), original);
    await c.deny(() => store.getResultOwned(a, { runId: run.id, attemptId: another.attemptId }), "not_found");
    await c.deny(() => store.getResultOwned(a, { runId: run.id, attemptId: foreign.attemptId }), "not_found");
    await c.deny(() => store.getResultOwned(a, { runId: foreign.id, attemptId: run.attemptId }), "not_found");
    await c.deny(() => store.getResultOwned(a, { runId: run.id, attemptId: randomUUID() }), "not_found");
    // Synthetic future-generation fixture only; no retry API or retry authority is supplied by009.
    const next = randomUUID(); await owner.query("begin");
    try {
      await owner.query("insert into run_attempts(id,run_id,owner_user_id,generation,created_at,status,effect_state) values($1,$2,'owner-a',2,clock_timestamp(),'queued','no_effect')", [next, run.id]);
      await owner.query("update runs set current_generation=2,revision=revision+1,status='queued',started_at=null,finished_at=null,cancel_requested_at=null where id=$1", [run.id]);
      await owner.query("commit");
    } finally { await owner.query("rollback"); }
    const current = await store.getOwned(a, { runId: run.id }); assert.equal(current.attemptId, next); assert.equal(current.generation, 2);
    assert.deepEqual(await store.getResultOwned(a, { runId: run.id, attemptId: run.attemptId }), original);
    await owner.query("update run_attempts set result_last_sequence=11 where id=$1", [run.attemptId]);
    await c.deny(() => store.getResultOwned(a, { runId: run.id, attemptId: run.attemptId }), "storage_unavailable");
    await owner.query("update run_attempts set result_last_sequence=3 where id=$1", [run.attemptId]);
    assert.equal((await store.getResultOwned(a, { runId: run.id, attemptId: run.attemptId })).finishedAtMs, done.finishedAtMs);
  });
  await c.scenario("cross-row projection corruption denies reads and immutable canonical input survives fresh factory", async () => {
    const [store] = await c.fresh(), input = c.input(), run = await store.submitOwned(a, input);
    const snapshot = (await owner.query<{ value: string }>("select input_snapshot as value from runs where id=$1", [run.id])).rows[0]?.value; assert.ok(snapshot);
    const fresh = c.make(secondDb); assert.deepEqual(await fresh.getOwned(a, { runId: run.id }), run); assert.deepEqual(await fresh.submitOwned(a, input), run);
    assert.equal((await owner.query<{ value: string }>("select input_snapshot as value from runs where id=$1", [run.id])).rows[0]?.value, snapshot);
    await owner.query("update runs set status='cancelled',finished_at=clock_timestamp() where id=$1", [run.id]);
    await c.deny(() => fresh.getOwned(a, { runId: run.id }), "storage_unavailable");
    await c.deny(() => fresh.submitOwned(a, input), "storage_unavailable");
  });
  await c.scenario("forced attempt insert failure rolls back its newly inserted run", async () => {
    const [store] = await c.fresh(); const before = await c.counts();
    await owner.query(`create function run_store_proof_insert_failure() returns trigger language plpgsql as $$
      begin raise exception using errcode='23514',message='Synthetic failure'; end $$;
      create trigger run_store_proof_insert_failure before insert on run_attempts for each row execute function run_store_proof_insert_failure()`);
    try { await c.deny(() => store.submitOwned(a, c.input()), "outcome_unknown"); assert.equal(await c.counts(), before); }
    finally { await owner.query("drop trigger run_store_proof_insert_failure on run_attempts; drop function run_store_proof_insert_failure()"); }
  });
  await c.scenario("exception after actual commit is repaired by identical key without another attempt", async () => {
    await c.reset(); const input = c.input();
    const lostAck: Pick<Database, "transaction"> = { transaction: async (work, options) => {
      await firstDb.transaction(work, options); throw new Error("Synthetic post-commit acknowledgement loss.");
    } };
    await c.deny(() => c.make(lostAck).submitOwned(a, input), "outcome_unknown");
    const stored = (await owner.query<{ id: string; attempts: number }>("select id,(select count(*)::int from run_attempts where run_id=runs.id) as attempts from runs where request_key=$1 and owner_user_id='owner-a'", [input.requestKey])).rows[0];
    assert.ok(stored); assert.equal(stored.attempts, 1); const before = await c.counts();
    const repair = c.make(secondDb), replay = await repair.submitOwned(a, input);
    assert.equal(replay.id, stored.id); assert.deepEqual(await repair.getOwned(a, { runId: replay.id }), replay); assert.equal(await c.counts(), before);
  });
}
