import { uuidv7 } from "@zetta/core/uuid";
import { strict as assert } from "node:assert";
import type { RunSchemaContext } from "./run-schema.integration";

export async function runSchemaCases(c: RunSchemaContext) {
  const { proof: { first, owner }, runId, attemptId } = c;
  const time = new Date("2026-01-01T00:00:00.000Z"), later = new Date(time.getTime() + 1000), lease = uuidv7();
  const running = { status: "running", lease_id: lease, claimed_at: time, lease_expires_at: later };
  async function denyInsert(table: "runs" | "run_attempts", name: string, fields: Readonly<Record<string, string | number | Date | null>>, constraint: string | null, code = "23514") {
    await c.scenario(name, () => c.reject(() => c.insert(first, table, { ...(table === "run_attempts" ? { generation: 3 } : {}), ...fields }), constraint, code));
  }
  await c.scenario("valid A and B owner-scoped request key and atomic initial attempts commit", async () => {
    const key = uuidv7();
    await first.query("begin");
    try {
      for (const ownerUserId of ["owner-a", "owner-b"]) {
        const id = uuidv7();
        await c.insert(first, "runs", { id, owner_user_id: ownerUserId, request_key: key });
        await c.insert(first, "run_attempts", { run_id: id, owner_user_id: ownerUserId });
      }
      await first.query("commit");
      assert.equal((await owner.query<{ count: number }>("select count(*)::int as count from runs where request_key=$1", [key])).rows[0]?.count, 2);
    } finally { await first.query("rollback"); }
    await c.reset();
  });
  await c.scenario("run insert without current attempt rejects at commit", () => c.reject(() => c.insert(first, "runs"), "runs_current_attempt_exists"));
  await c.scenario("pointer update without matching attempt rejects at commit", () => c.reject(() => first.query("update runs set current_generation=3 where id=$1", [runId]).then(() => {}), "runs_current_attempt_exists"));
  await c.scenario("current attempt deletion alone rejects at commit", () => c.reject(() => first.query("delete from run_attempts where id=$1", [attemptId]).then(() => {}), "runs_current_attempt_exists"));
  await c.scenario("deferred check rereads final pointer after deleting former current attempt", async () => {
    await first.query("begin");
    try {
      await first.query("delete from run_attempts where id=$1", [attemptId]);
      await first.query("update runs set current_generation=2 where id=$1", [runId]);
      await first.query("commit");
      assert.equal((await owner.query<{ generation: number }>("select current_generation as generation from runs where id=$1", [runId])).rows[0]?.generation, 2);
    } finally { await first.query("rollback"); }
    await c.reset();
  });
  await c.scenario("noncurrent deletion succeeds and immediate constraints validate current row", () => c.rollback(async () => {
    await first.query("delete from run_attempts where run_id=$1 and generation=2;", [runId]);
    await first.query("set constraints all immediate");
    assert.equal((await first.query<{ count: number }>("select count(*)::int as count from run_attempts where run_id=$1", [runId])).rows[0]?.count, 1);
  }));
  await denyInsert("runs", "unknown membership owner rejected", { owner_user_id: "missing" }, "runs_owner_user_id_membership_user_id_fkey", "23503");
  await denyInsert("run_attempts", "attempt cannot substitute B owner for A run", { owner_user_id: "owner-b" }, "run_attempts_owner_fk", "23503");
  await c.scenario("duplicate owner request key rejected", () => c.reject(async () => {
    const row = (await first.query<{ request_key: string }>("select request_key from runs where id=$1", [runId])).rows[0]; assert.ok(row);
    await c.insert(first, "runs", { request_key: row.request_key });
  }, "runs_owner_request_unique", "23505"));
  await denyInsert("run_attempts", "duplicate run generation rejected", { generation: 1 }, "run_attempts_run_generation_unique", "23505");
  for (const [column, value] of Object.entries({ id: uuidv7(), owner_user_id: "owner-b", request_key: uuidv7(), origin_kind: "setup",
    bot_id: "other", conversation_id: "other", configuration_id: "other", configuration_version: 2, input_version: 2, input_snapshot: "[2]", created_at: later })) {
    await c.scenario(`run immutable ${column} rejected`, () => c.reject(() => first.query(`update runs set ${column}=$1 where id=$2`, [value, runId]).then(() => {}), "runs_identity_immutable"));
  }
  for (const [column, value] of Object.entries({ id: uuidv7(), run_id: uuidv7(), owner_user_id: "owner-b", generation: 3, created_at: later })) {
    await c.scenario(`attempt immutable ${column} rejected`, () => c.reject(() => first.query(`update run_attempts set ${column}=$1 where id=$2`, [value, attemptId]).then(() => {}), "run_attempts_identity_immutable"));
  }
  for (const [column, value, constraint] of [
    ["bot_id", "é", "runs_identifiers_check"], ["conversation_id", "x".repeat(129), "runs_identifiers_check"],
    ["configuration_id", "", "runs_identifiers_check"], ["origin_kind", "routine", "runs_origin_check"],
    ["configuration_version", 0, "runs_counters_check"], ["revision", 0, "runs_counters_check"], ["current_generation", 0, "runs_counters_check"],
    ["input_version", 2, "runs_input_check"], ["input_snapshot", "{}", "runs_input_check"], ["input_snapshot", '["' + "x".repeat(98301) + '"]', "runs_input_check"],
    ["status", "unknown", "runs_lifecycle_check"], ["started_at", later, "runs_lifecycle_check"],
    ["cancel_requested_at", later, "runs_lifecycle_check"],
  ] as const) await denyInsert("runs", `run ${column} invalid variant rejected`, { [column]: value }, constraint);
  await denyInsert("runs", "run precreation terminal timestamp rejected", { status: "failed", finished_at: new Date(time.getTime() - 1) }, "runs_time_check");
  await denyInsert("runs", "run int32 overflow rejected", { revision: 2147483648 }, null, "22003");
  for (const [name, fields, constraint] of [
    ["generation zero", { generation: 0 }, "run_attempts_generation_check"],
    ["unknown status", { status: "unknown" }, "run_attempts_lifecycle_check"],
    ["unknown effect", { effect_state: "unknown" }, "run_attempts_effect_check"],
    ["partial lease", { ...running, claimed_at: null }, "run_attempts_lease_check"],
    ["nonpositive lease duration", { ...running, lease_expires_at: time }, "run_attempts_lease_check"],
    ["running without lease", { status: "running" }, "run_attempts_lifecycle_check"],
    ["running known effects", { ...running, effect_state: "known" }, "run_attempts_lifecycle_check"],
    ["queued stop fact", { stop_confirmed_at: time }, "run_attempts_lifecycle_check"],
    ["terminal without finish", { status: "interrupted", effect_state: "uncertain" }, "run_attempts_lifecycle_check"],
    ["partial result", { status: "failed", finished_at: time, result_text: "synthetic" }, "run_attempts_result_check"],
    ["unknown cancellation", { ...running, cancellation_reason: "arbitrary" }, "run_attempts_cancellation_check"],
    ["precreation claim", { ...running, claimed_at: new Date(time.getTime() - 1) }, "run_attempts_time_check"],
    ["start before claim", { ...running, started_at: new Date(time.getTime() - 1) }, "run_attempts_time_check"],
    ["stop before claim", { ...running, stop_confirmed_at: new Date(time.getTime() - 1) }, "run_attempts_time_check"],
  ] as const) await denyInsert("run_attempts", `attempt ${name} rejected`, fields, constraint);
  const terminal = { status: "failed", effect_state: "known", finished_at: time, result_version: 1, result_text: "", result_error_code: null, result_last_sequence: 0 };
  for (const [column, value, constraint] of [["result_version", null, "run_attempts_result_check"], ["result_text", null, "run_attempts_result_check"], ["result_last_sequence", null, "run_attempts_result_check"], ["result_version", 2, "run_attempts_result_check"], ["result_text", "😀".repeat(16385), "run_attempts_result_check"],
    ["result_last_sequence", -1, "run_attempts_result_check"], ["result_last_sequence", 1001, "run_attempts_result_check"],
    ["result_error_code", "unknown", "run_attempts_error_check"]] as const) {
    await denyInsert("run_attempts", `terminal ${column} invalid variant rejected`, { ...terminal, [column]: value }, constraint);
  }
  await c.scenario("positive text int32 timestamp result and stopped-running boundaries", () => c.rollback(async () => {
    const id = uuidv7();
    await c.insert(first, "runs", { id, input_snapshot: '["' + "x".repeat(98300) + '"]', configuration_version: 2147483647, revision: 2147483647 });
    await c.insert(first, "run_attempts", { run_id: id });
    await c.insert(first, "run_attempts", { generation: 3, ...running, stop_confirmed_at: time, cancellation_reason: "owner_requested" });
    await c.insert(first, "run_attempts", { generation: 2147483647, ...terminal, result_text: "😀".repeat(16384), result_last_sequence: 1000 });
    await first.query("set constraints all immediate");
    const rows = await first.query<{ bytes: number }>("select octet_length(result_text) as bytes from run_attempts where result_version=1");
    assert.equal(rows.rows.length, 1); assert.equal(rows.rows[0]?.bytes, 65536);
  }));
  await c.scenario("assigned lease identity and expiry are guarded while renewal moves forward", async () => {
    await owner.query("begin");
    await owner.query("update run_attempts set status='running',lease_id=$1,claimed_at=$2,lease_expires_at=$3 where id=$4", [lease, time, later, attemptId]);
    await owner.query("commit");
    for (const replacement of [uuidv7(), null]) await c.reject(() => first.query("update run_attempts set lease_id=$1 where id=$2", [replacement, attemptId]).then(() => {}), "run_attempts_lease_immutable");
    for (const expiry of [time, null]) await c.reject(() => first.query("update run_attempts set lease_expires_at=$1 where id=$2", [expiry, attemptId]).then(() => {}), "run_attempts_expiry_monotonic");
    await c.rollback(async () => {
      const result = await first.query("update run_attempts set lease_expires_at=$1 where id=$2 returning id", [new Date(later.getTime() + 1000), attemptId]);
      assert.equal(result.rowCount, 1); await first.query("set constraints all immediate");
    });
    await c.reset();
  });
}
