import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { requireIdentityAuthProofTarget } from "./signup.integration";

export type LockOrderProof = Awaited<ReturnType<typeof import("../../../../../packages/db/src/connection-proof-client").openConnectionProof>>;

export function createLockOrderInput() {
  return { operationId: randomUUID(), provider: "synthetic", label: "synthetic", secret: Buffer.from(randomUUID(), "utf8"), expiresAt: null };
}

export async function runIdentityLockOrderProof() {
  let phase = "target validation";
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => { process.stderr.write("Identity lock-order proof deadline exceeded; cleanup unverified.\n"); process.exit(1); }, 45000);
    let proof: LockOrderProof | undefined;
    const restore: (() => void)[] = [], secrets: Buffer[] = [];
    let forbiddenAttempts = 0;
    let outcome: Awaited<ReturnType<typeof import("./identity-lock-order-case").reproduceConnectionAdminCycle>> | undefined;
    try {
      phase = "guarded setup";
      const { openConnectionProof } = await import("../../../../../packages/db/src/connection-proof-client");
      proof = await openConnectionProof(target.connectionString);
      const net = (await import("node:net")).default, tls = (await import("node:tls")).default;
      const dns = (await import("node:dns")).default, http = (await import("node:http")).default, https = (await import("node:https")).default;
      const forbidden = () => { forbiddenAttempts++; throw new Error("Unintended proof IO."); };
      for (const [object, key] of [[net.Socket.prototype, "connect"], [net.Server.prototype, "listen"], [tls, "connect"],
        [dns, "lookup"], [dns, "resolve"], [dns.promises, "lookup"], [dns.promises, "resolve"],
        [http, "request"], [http, "get"], [https, "request"], [https, "get"],
        [Bun, "connect"], [Bun, "listen"], [Bun, "serve"], [globalThis, "fetch"]] as const) {
        const previous: unknown = Reflect.get(object, key);
        assert.equal(Reflect.set(object, key, forbidden), true);
        restore.push(() => { assert.equal(Reflect.set(object, key, previous), true); });
      }
      phase = "reserved client settings";
      const { owner, first, second, firstDb, secondDb } = proof;
      const pids: number[] = [];
      for (const client of [owner, first, second]) {
        const [row] = (await client.query<{ pid: number; bounded: boolean }>(`select pg_backend_pid() as pid,
          current_setting('lock_timeout')='2s' and current_setting('statement_timeout')='4s'
          and current_setting('idle_in_transaction_session_timeout')='5s' and current_setting('deadlock_timeout')='1s' as bounded`)).rows;
        assert.ok(row?.bounded);
        pids.push(row.pid);
        const parameters: unknown = Reflect.get(client, "connectionParameters");
        assert.ok(typeof parameters === "object" && parameters !== null && "query_timeout" in parameters && parameters.query_timeout === 5000);
      }
      const [ownerPid, firstPid, secondPid] = pids;
      assert.ok(ownerPid && firstPid && secondPid); assert.equal(new Set(pids).size, 3);
      const { createAdminLifecycleService } = await import("./admin-lifecycle");
      const { createConnectionStore } = await import("../connections/store");
      const { createIdentityAccess, createMembershipLookup } = await import("./access");
      const { readLockOrderState, assertLockOrderEffects, reproduceConnectionAdminCycle } = await import("./identity-lock-order-case");
      phase = "synthetic fixture setup";
      await owner.query(`insert into "user" (id,name,email,email_verified,created_at,updated_at)
        select id,id,id||'@lock.invalid',true,now(),now() from unnest(array['lock-a','lock-b','lock-c']) id;
        insert into membership (user_id,status,joined_at,updated_at) values ('lock-b','active',now(),now()),('lock-c','active',now(),now())`);
      const lifecycle = createAdminLifecycleService(secondDb);
      assert.deepEqual(await lifecycle.bootstrapExistingAccount({ userId: "lock-a" }), { adminUserId: "lock-a" });
      const access = createIdentityAccess({ api: { getSession: async () => ({ user: { id: "lock-b" } }) } }, createMembershipLookup(firstDb));
      const actor = await access.requireActive(new Headers());
      assert.equal(actor.userId, "lock-b"); assert.equal(actor.isAdmin, false);
      const key = randomBytes(32); secrets.push(key);
      const store = await createConnectionStore(firstDb, { configuration: { key: key.toString("base64"), keyId: "synthetic-lock-proof" }, allowedProviders: ["synthetic"], initializeEmpty: true });
      key.fill(0);
      const input = () => {
        const value = createLockOrderInput(); secrets.push(value.secret);
        return value;
      };
      async function seedSessions(ids: readonly string[]) {
        for (const id of ids) await owner.query("insert into session(id,user_id,token,expires_at,created_at,updated_at) values($1,$2,$3,now()+interval '1 hour',now(),now())", [randomUUID(), id, randomUUID()]);
      }
      await seedSessions(["lock-a", "lock-b", "lock-c"]);
      phase = "create then replacement control";
      let before = await readLockOrderState(owner);
      assert.equal((await store.createApiKey(actor, input())).revision, 1);
      let after = await readLockOrderState(owner);
      assertLockOrderEffects(before, after, { created: true, admin: null }); before = after;
      assert.deepEqual(await lifecycle.replaceAdminWithExistingAccount({ expectedAdminUserId: "lock-a", newAdminUserId: "lock-b", reason: "synthetic control" }), { previousAdminUserId: "lock-a", adminUserId: "lock-b" });
      after = await readLockOrderState(owner);
      assertLockOrderEffects(before, after, { created: false, admin: "lock-b" });
      phase = "replacement then create control";
      before = after;
      assert.deepEqual(await lifecycle.replaceAdminWithExistingAccount({ expectedAdminUserId: "lock-b", newAdminUserId: "lock-a", reason: "synthetic reverse control" }), { previousAdminUserId: "lock-b", adminUserId: "lock-a" });
      after = await readLockOrderState(owner);
      assertLockOrderEffects(before, after, { created: false, admin: "lock-a" }); before = after;
      assert.equal((await store.createApiKey(actor, input())).revision, 1);
      assertLockOrderEffects(before, await readLockOrderState(owner), { created: true, admin: null });
      await seedSessions(["lock-a", "lock-b"]);
      phase = "current-service opposing locks";
      outcome = await reproduceConnectionAdminCycle({ proof, pids: [ownerPid, firstPid, secondPid], actor, store, lifecycle, input: input() });
      phase = "idle backend verification";
      await owner.query("select pg_stat_clear_snapshot()");
      const [idle] = (await owner.query<{ idle: boolean }>("select count(*)=2 and bool_and(state='idle' and xact_start is null) as idle from pg_stat_activity where pid=any($1::int[])", [[firstPid, secondPid]])).rows;
      assert.equal(idle?.idle, true);
      proof.healthy(); assert.equal(forbiddenAttempts, 0);
    } finally {
      for (const secret of secrets) secret.fill(0);
      const previous = phase; phase = "reserved client cleanup";
      try { await proof?.close(); assert.equal(forbiddenAttempts, 0); }
      finally { for (const undo of restore.reverse()) undo(); clearTimeout(deadline); }
      phase = previous;
    }
    assert.ok(outcome);
    process.stdout.write(JSON.stringify({ ...outcome, sequentialControls: 2, boundedSettings: true, idleBackends: true,
      forbiddenAttempts, clientsClosed: true, serviceDisposal: "launcher_required", controlledSessionSource: true, actualAuthentication: false }) + "\n");
  } catch { // no-excuse-ok: catch -- fixed phase only; never expose driver, assertion or credential details.
    process.stderr.write(`Identity lock-order proof failed at ${phase}; details suppressed.\n`); process.exitCode = 1;
  }
}
if (import.meta.main) await runIdentityLockOrderProof();
