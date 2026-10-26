import { strict as assert } from "node:assert";
import { requireIdentityAuthProofTarget } from "./signup.integration";
import type { RoleProof } from "./membership-role-cases";
export async function runMembershipRoleProof(args: readonly string[] = process.argv.slice(2)) {
  let phase = "target validation";
  try {
    if (args.length !== 0) throw new Error("Unexpected proof arguments");
    const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => { process.stderr.write("Membership role proof deadline exceeded; cleanup unverified.\n"); process.exit(1); }, 120000);
    let fixture: RoleProof | undefined;
    let io: Awaited<ReturnType<typeof import("../../../../../packages/db/src/run-readback-proof-client").forbidRunProofIO>> | undefined;
    let passed: string[] = [];
    try {
      phase = "fresh lineage and restricted login";
      const { openMembershipRoleProof } = await import("../../../../../packages/db/src/membership-role-proof-client");
      fixture = await openMembershipRoleProof(target.connectionString);
      const { forbidRunProofIO } = await import("../../../../../packages/db/src/run-readback-proof-client"); io = await forbidRunProofIO();
      phase = "reserved client settings";
      const pids: number[] = [];
      for (const client of [fixture.proof.owner, fixture.proof.first, fixture.proof.second, fixture.client]) {
        const row = (await client.query<{ pid: number; bounded: boolean }>("select pg_backend_pid() as pid,current_setting('lock_timeout')='2s' and current_setting('statement_timeout')='4s' and current_setting('idle_in_transaction_session_timeout')='5s' as bounded")).rows[0];
        assert.equal(row?.bounded, true); assert.ok(row); pids.push(row.pid);
        const parameters: unknown = Reflect.get(client, "connectionParameters");
        assert.ok(typeof parameters === "object" && parameters !== null && Reflect.get(parameters, "query_timeout") === 5000);
      }
      assert.equal(new Set(pids).size, 4); assert.equal(pids[3], fixture.pid);
      phase = "restricted services and exact privilege denials";
      const { roleCases } = await import("./membership-role-cases"); passed = await roleCases(fixture);
      assert.equal(passed.length, 20);
      phase = "idle and sticky IO verification";
      await fixture.proof.owner.query("select pg_stat_clear_snapshot()");
      const idle = (await fixture.proof.owner.query<{ idle: boolean }>("select count(*)=3 and bool_and(state='idle' and xact_start is null) as idle from pg_stat_activity where pid=any($1::int[])", [pids.slice(1)])).rows[0];
      assert.equal(idle?.idle, true); fixture.healthy(); io.healthy();
    } finally {
      const previous = phase; phase = "reserved client cleanup";
      try { await fixture?.close(); io?.healthy(); }
      finally { io?.restore(); clearTimeout(deadline); }
      phase = previous;
    }
    for (const name of passed) process.stdout.write(`PASS ${name}\n`);
    process.stdout.write("PASS four clients drained, idle and zero forbidden IO; whole service disposal required\n");
  } catch { // no-excuse-ok: catch -- safe fixed phase only, never SQL, credentials or private rows.
    process.stderr.write(`Membership role proof failed at ${phase}; details suppressed.\n`); process.exitCode = 1;
  }
}
if (import.meta.main) await runMembershipRoleProof();
