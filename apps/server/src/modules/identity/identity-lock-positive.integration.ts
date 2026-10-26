import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { requireIdentityAuthProofTarget } from "./signup.integration";
import type { LockOrderProof } from "./identity-lock-order.integration";
export async function runIdentityLockPositiveProof() {
  let phase = "target validation";
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => { process.stderr.write("Identity positive lock proof deadline exceeded; cleanup unverified.\n"); process.exit(1); }, 60000);
    let proof: LockOrderProof | undefined;
    let io: Awaited<ReturnType<typeof import("../../../../../packages/db/src/run-readback-proof-client").forbidRunProofIO>> | undefined;
    const secrets: Buffer[] = [];
    try {
      phase = "guarded setup";
      const { openConnectionProof } = await import("../../../../../packages/db/src/connection-proof-client");
      proof = await openConnectionProof(target.connectionString);
      const { forbidRunProofIO } = await import("../../../../../packages/db/src/run-readback-proof-client");
      io = await forbidRunProofIO();
      phase = "reserved settings";
      const pids: number[] = [];
      for (const client of [proof.owner, proof.first, proof.second]) {
        const [row] = (await client.query<{ pid: number; bounded: boolean }>(`select pg_backend_pid() as pid,
          current_setting('lock_timeout')='2s' and current_setting('statement_timeout')='4s'
          and current_setting('idle_in_transaction_session_timeout')='5s' and current_setting('deadlock_timeout')='1s' as bounded`)).rows;
        assert.ok(row?.bounded); pids.push(row.pid);
        const parameters: unknown = Reflect.get(client, "connectionParameters");
        assert.ok(typeof parameters === "object" && parameters !== null && "query_timeout" in parameters && parameters.query_timeout === 5000);
      }
      const [ownerPid, firstPid, secondPid] = pids; assert.ok(ownerPid && firstPid && secondPid); assert.equal(new Set(pids).size, 3);
      phase = "synthetic fixture";
      await proof.owner.query(`insert into "user" (id,name,email,email_verified,created_at,updated_at)
        select id,id,id||'@lock.invalid',true,now(),now() from unnest(array['lock-a','lock-b','lock-c']) id;
        insert into membership(user_id,status,joined_at,updated_at) values('lock-a','active',now(),now()),('lock-c','active',now(),now())`);
      const { createAdminLifecycleService } = await import("./admin-lifecycle");
      const { createIdentityAccess, createMembershipLookup } = await import("./access");
      const { createConnectionStore } = await import("../connections/store");
      const lifecycle = createAdminLifecycleService(proof.secondDb);
      assert.deepEqual(await lifecycle.bootstrapExistingAccount({ userId: "lock-b" }), { adminUserId: "lock-b" });
      const actor = await createIdentityAccess({ api: { getSession: async () => ({ user: { id: "lock-a" } }) } }, createMembershipLookup(proof.firstDb)).requireActive(new Headers());
      assert.equal(actor.userId, "lock-a"); assert.equal(actor.isAdmin, false);
      const key = randomBytes(32); secrets.push(key);
      const store = await createConnectionStore(proof.firstDb, { configuration: { key: key.toString("base64"), keyId: "synthetic-positive" }, allowedProviders: ["synthetic"], initializeEmpty: true });
      key.fill(0);
      for (const id of ["lock-a", "lock-b", "lock-c"]) await proof.owner.query("insert into session(id,user_id,token,expires_at,created_at,updated_at) values($1,$2,$3,now()+interval '1 hour',now(),now())", [randomUUID(), id, randomUUID()]);
      const { connectionDirections } = await import("./identity-lock-positive-cases");
      const { sessionDirections } = await import("./identity-lock-session-case");
      const { enrollmentDirections } = await import("./identity-lock-enrollment-case");
      const context = { proof, pids: [ownerPid, firstPid, secondPid] as const, actor, store, lifecycle, input() {
        const secret = Buffer.from(randomUUID(), "utf8"); secrets.push(secret);
        return { operationId: randomUUID(), provider: "synthetic", label: "synthetic", secret, expiresAt: null };
      } };
      phase = "connection directions"; await connectionDirections(context);
      phase = "session directions"; await sessionDirections(context);
      phase = "synthetic future020 enrollment directions"; await enrollmentDirections(context);
      phase = "idle verification";
      await proof.owner.query("select pg_stat_clear_snapshot()");
      const [idle] = (await proof.owner.query<{ idle: boolean }>("select count(*)=2 and bool_and(state='idle' and xact_start is null) as idle from pg_stat_activity where pid=any($1::int[])", [[firstPid, secondPid]])).rows;
      assert.equal(idle?.idle, true); proof.healthy(); io.healthy();
    } finally {
      for (const secret of secrets) secret.fill(0);
      const previous = phase; phase = "reserved client cleanup";
      try { await proof?.close(); io?.healthy(); }
      finally { io?.restore(); clearTimeout(deadline); }
      phase = previous;
    }
    process.stdout.write("PASS connection-first and replacement-first actual services\nPASS session-first and replacement-first session fence\nPASS synthetic future020 both directions with actual enrollment denial\nPASS idle clients, zero forbidden IO, clients closed; launcher disposal required\n");
  } catch { // no-excuse-ok: catch -- only a fixed phase leaves the proof; no SQL, rows or raw causes.
    process.stderr.write(`Identity positive lock proof failed at ${phase}; details suppressed.\n`); process.exitCode = 1;
  }
}
if (import.meta.main) await runIdentityLockPositiveProof();
