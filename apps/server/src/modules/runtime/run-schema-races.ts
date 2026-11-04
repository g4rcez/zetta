import { strict as assert } from "node:assert";
import { matchesFailure, type RunSchemaContext } from "./run-schema.integration";

type Outcome = { ok: true } | { ok: false; acceptable: boolean };
async function capture(work: () => Promise<void>): Promise<Outcome> {
  try {
    await work();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      acceptable:
        matchesFailure(error, "23514", "runs_current_attempt_exists") ||
        matchesFailure(error, "40001", null) ||
        matchesFailure(error, "40P01", null),
    };
  }
}
export async function runSchemaRaces(c: RunSchemaContext) {
  const {
    proof: { first, second, owner },
    runId,
    pids: [firstPid, secondPid],
  } = c;
  for (const isolation of ["read committed", "repeatable read"] as const) {
    for (const winner of ["pointer", "delete"] as const) {
      await c.scenario(
        `${isolation} ${winner} wins observed current-pointer deletion race`,
        async () => {
          await c.reset();
          let pending: Promise<Outcome> | undefined;
          try {
            await first.query(`begin isolation level ${isolation}`);
            if (winner === "pointer") {
              await first.query("update runs set current_generation=2 where id=$1", [runId]);
              // Force deferred parent/attempt locks before exposing the competing deletion.
              await first.query("set constraints all immediate");
            } else
              await first.query("delete from run_attempts where run_id=$1 and generation=2", [
                runId,
              ]);
            await second.query(`begin isolation level ${isolation}`);
            // Establish an older snapshot deliberately for the repeatable-read stale-tuple case.
            assert.equal(
              (
                await second.query<{ generation: number }>(
                  "select current_generation as generation from runs where id=$1",
                  [runId],
                )
              ).rows[0]?.generation,
              1,
            );
            pending = capture(async () => {
              if (winner === "pointer")
                await second.query("delete from run_attempts where run_id=$1 and generation=2", [
                  runId,
                ]);
              else await second.query("update runs set current_generation=2 where id=$1", [runId]);
              await second.query("commit");
            });
            await c.wait(secondPid, firstPid);
            await first.query("commit");
            const outcome = await pending;
            assert.equal(!outcome.ok && outcome.acceptable, true);
          } finally {
            // Release the winner before settling its independent waiter, including assertion failures.
            await first.query("rollback");
            if (pending) await pending;
            await second.query("rollback");
          }
          const readback = (
            await owner.query<{ orphans: number; generation: number; attempts: number }>(
              `select
          (select count(*)::int from runs r where not exists(select 1 from run_attempts a where a.run_id=r.id and a.generation=r.current_generation)) as orphans,
          current_generation as generation,(select count(*)::int from run_attempts where run_id=$1) as attempts from runs where id=$1`,
              [runId],
            )
          ).rows[0];
          assert.ok(readback);
          assert.equal(readback.orphans, 0);
          assert.equal(readback.generation, winner === "pointer" ? 2 : 1);
          assert.equal(readback.attempts, winner === "pointer" ? 2 : 1);
        },
      );
    }
  }
  await c.reset();
  for (const pid of c.pids) {
    assert.equal(
      (
        await owner.query<{ state: string }>("select state from pg_stat_activity where pid=$1", [
          pid,
        ])
      ).rows[0]?.state,
      "idle",
    );
  }
}
