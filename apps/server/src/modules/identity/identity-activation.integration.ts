import { strict as assert } from "node:assert";
import { requireIdentityAuthProofTarget } from "./signup.integration";
import type { ActivationProof } from "./identity-activation-cases";
export function activationSelector(args: readonly string[]) {
  if (args.length !== 1 || (args[0] !== "backfill" && args[0] !== "exhaustion")) throw new Error("Invalid activation proof selector");
  return args[0];
}
export async function runIdentityActivationProof(args: readonly string[] = process.argv.slice(2)) {
  let phase = "selector validation";
  try {
    const mode = activationSelector(args);
    phase = "target validation"; const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => { process.stderr.write("Identity activation proof deadline exceeded; cleanup unverified.\n"); process.exit(1); }, 120000);
    let proof: ActivationProof | undefined;
    let io: Awaited<ReturnType<typeof import("../../../../../packages/db/src/run-readback-proof-client").forbidRunProofIO>> | undefined;
    const passed: string[] = [];
    try {
      phase = "guarded setup";
      const { openIdentityActivationBackfillProof, openIdentityActivationExhaustionProof } = await import("../../../../../packages/db/src/identity-proof-client");
      proof = await (mode === "backfill" ? openIdentityActivationBackfillProof(target.connectionString) : openIdentityActivationExhaustionProof(target.connectionString));
      const { forbidRunProofIO } = await import("../../../../../packages/db/src/run-readback-proof-client"); io = await forbidRunProofIO();
      phase = "lineage and repeat application";
      const { applyIdentityActivation, verifyIdentityActivationBackfill, verifyIdentityActivationExhaustion } = await import("../../../../../packages/db/src/identity-activation-proof");
      const verify = mode === "backfill" ? verifyIdentityActivationBackfill : verifyIdentityActivationExhaustion;
      await verify(proof.owner); await applyIdentityActivation(proof.owner); await verify(proof.owner);
      passed.push("exact fixed fixture, complete lineage, repeat application and eight tables");
      const pids: number[] = [];
      for (const client of [proof.owner, proof.first, proof.second]) {
        const row = (await client.query<{ pid: number; bounded: boolean }>("select pg_backend_pid() as pid,current_setting('lock_timeout')='2s' and current_setting('statement_timeout')='4s' and current_setting('idle_in_transaction_session_timeout')='5s' as bounded")).rows[0];
        assert.equal(row?.bounded, true); assert.ok(row); pids.push(row.pid);
        const parameters: unknown = Reflect.get(client, "connectionParameters");
        assert.ok(typeof parameters === "object" && parameters !== null && Reflect.get(parameters, "query_timeout") === 5000);
      }
      assert.equal(new Set(pids).size, 3); const firstPid = pids[1]!, secondPid = pids[2]!;
      const cases = await import("./identity-activation-cases");
      if (mode === "backfill") {
        phase = "named schema guards"; await cases.schemaCases(proof); passed.push("named activation SQL guards and positive controls");
        phase = "actual lifecycle"; await cases.lifecycleCases(proof); passed.push("actual bootstrap, replacement, reenrollment and replay denial");
        phase = "audit rollback"; await cases.auditRollbackCases(proof); passed.push("late audit rejection exact state rollback and recovery");
        phase = "invitation contention";
        const { invitationRace } = await import("./identity-activation-races"); await invitationRace(proof, firstPid, secondPid);
        passed.push("observed independent-client invitation contention, one increment and one consumption");
      } else {
        phase = "exhaustion guards and services"; await cases.exhaustionCases(proof);
        passed.push("actual MAX SQL guard and three opaque lifecycle denials with exact unchanged state and positive controls");
      }
      phase = "idle verification";
      await proof.owner.query("select pg_stat_clear_snapshot()");
      const idle = (await proof.owner.query<{ idle: boolean }>("select count(*)=2 and bool_and(state='idle' and xact_start is null) as idle from pg_stat_activity where pid=any($1::int[])", [[firstPid, secondPid]])).rows[0];
      assert.equal(idle?.idle, true); proof.healthy(); io.healthy();
      assert.equal(passed.length, mode === "backfill" ? 5 : 2);
    } finally {
      const previous = phase; phase = "reserved client cleanup";
      try { await proof?.close(); io?.healthy(); }
      finally { io?.restore(); clearTimeout(deadline); }
      phase = previous;
    }
    for (const name of passed) process.stdout.write(`PASS ${name}\n`);
    process.stdout.write("PASS idle clients, zero forbidden IO, clients closed; whole service disposal required\n");
  } catch { // no-excuse-ok: catch -- fixed phase only; SQL, private state and causes never leave this entry.
    process.stderr.write(`Identity activation proof failed at ${phase}; details suppressed.\n`); process.exitCode = 1;
  }
}
if (import.meta.main) await runIdentityActivationProof();
