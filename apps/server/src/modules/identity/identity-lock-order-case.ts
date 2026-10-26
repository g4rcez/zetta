import { strict as assert } from "node:assert";
import { AdminLifecycleUnavailableError, type createAdminLifecycleService } from "./admin-lifecycle";
import { ConnectionStoreError } from "../connections/store-contract";
import type { createConnectionStore } from "../connections/store";
import type { ActiveActor } from "./access";
import type { LockOrderProof } from "./identity-lock-order.integration";

type State = Readonly<{
  admin: string; members: string; audits: number; connections: number; credentials: number; receipts: number;
  nonces: number; encryptions: number; sessions_a: readonly string[]; sessions_b: readonly string[]; sessions_c: readonly string[];
}>;
type Context = Readonly<{
  proof: LockOrderProof; pids: readonly [number, number, number]; actor: ActiveActor;
  store: Awaited<ReturnType<typeof createConnectionStore>>;
  lifecycle: ReturnType<typeof createAdminLifecycleService>;
  input: Readonly<{ operationId: string; provider: string; label: string; secret: Buffer; expiresAt: null }>;
}>;

export async function readLockOrderState(owner: LockOrderProof["owner"]): Promise<State> {
  const [row] = (await owner.query<State>(`select
    (select admin_user_id from installation_identity where id=1) as admin,
    (select jsonb_agg(to_jsonb(m) order by user_id)::text from membership m) as members,
    (select count(*)::int from identity_audit) as audits,
    (select count(*)::int from connection) as connections,
    (select count(*)::int from connection_credential) as credentials,
    (select count(*)::int from connection_mutation_receipt) as receipts,
    (select count(*)::int from connection_nonce) as nonces,
    (select encryption_count from connection_key_check where id=1) as encryptions,
    array(select id from session where user_id='lock-a' order by id) as sessions_a,
    array(select id from session where user_id='lock-b' order by id) as sessions_b,
    array(select id from session where user_id='lock-c' order by id) as sessions_c`)).rows;
  assert.ok(row);
  return row;
}

export function assertLockOrderEffects(before: State, after: State, effects: Readonly<{ created: boolean; admin: string | null }>) {
  const increment = Number(effects.created);
  for (const key of ["connections", "credentials", "receipts", "nonces", "encryptions"] as const) assert.equal(after[key], before[key] + increment);
  assert.equal(after.admin, effects.admin ?? before.admin);
  assert.equal(after.audits, before.audits + Number(effects.admin !== null));
  assert.equal(after.members, before.members);
  assert.deepEqual(after.sessions_a, effects.admin === null ? before.sessions_a : []);
  assert.deepEqual(after.sessions_b, effects.admin === null ? before.sessions_b : []);
  assert.deepEqual(after.sessions_c, before.sessions_c);
}

export async function reproduceConnectionAdminCycle(c: Context) {
  const { owner, first, second } = c.proof;
  const [, firstPid, secondPid] = c.pids;
  const before = await readLockOrderState(owner);
  assert.equal(before.admin, "lock-a");
  assert.equal(before.sessions_a.length === 1 && before.sessions_b.length === 1 && before.sessions_c.length === 1, true);
  const atMember = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const restored: (() => void)[] = [];
  const adminStages: string[] = [];
  const driverErrors: { service: "create" | "replace"; code: string; statement: string }[] = [];
  let pauseHits = 0, nonceInserts = 0, pauseExpired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let creation: ReturnType<Context["store"]["createApiKey"]> | undefined;
  let replacement: ReturnType<Context["lifecycle"]["replaceAdminWithExistingAccount"]> | undefined;
  function instrument(client: LockOrderProof["first"], service: "create" | "replace") {
    const original = client.query;
    assert.equal(Reflect.set(client, "query", async (...args: readonly unknown[]) => {
      const query = args[0];
      const text = typeof query === "string" ? query : typeof query === "object" && query !== null && "text" in query && typeof query.text === "string" ? query.text : "";
      const params: readonly unknown[] = Array.isArray(args[1]) ? args[1] : [];
      const memberB = text.includes('from "membership"') && text.endsWith(" for update") && params.length === 1 && params[0] === "lock-b";
      let result: unknown;
      try {
        const pending: unknown = Reflect.apply(original, client, args);
        assert.ok(pending instanceof Promise);
        result = await pending;
      } catch (error) {
        const code = error instanceof Error && "code" in error && typeof error.code === "string" && ["40P01", "55P03", "57014"].includes(error.code) ? error.code : "unexpected";
        driverErrors.push({ service, code, statement: memberB ? "member-b" : text.startsWith('insert into "connection" ') ? "connection-insert" : "other" });
        throw error;
      }
      if (service === "replace" && text.endsWith(" for update")) {
        if (text.includes('from "installation_identity"')) adminStages.push("installation");
        else if (text.includes('from "user"') && params.length === 1 && (params[0] === "lock-a" || params[0] === "lock-b")) adminStages.push(`account-${params[0]}`);
        else if (text.includes('from "membership"') && params.length === 1 && params[0] === "lock-a") adminStages.push("member-a");
      }
      if (service === "create" && text.startsWith('insert into "connection_nonce" ')) nonceInserts++;
      if (service === "create" && memberB) {
        pauseHits++;
        assert.equal(pauseHits, 1);
        timer = setTimeout(() => { pauseExpired = true; release.resolve(); }, 750);
        atMember.resolve();
        await release.promise;
      }
      return result;
    }), true);
    restored.push(() => { assert.equal(Reflect.set(client, "query", original), true); });
  }
  async function observe(cycle: boolean) {
    const until = performance.now() + 600;
    while (performance.now() < until) {
      await owner.query("select pg_stat_clear_snapshot()");
      const [row] = (await owner.query<{ forward: boolean; reverse: boolean }>(`select
        exists(select 1 from pg_stat_activity where pid=$2 and wait_event_type='Lock'
          and $1=any(pg_blocking_pids(pid)) and position('from "membership"' in query)>0) as forward,
        exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'
          and $2=any(pg_blocking_pids(pid)) and position('insert into "connection"' in query)>0) as reverse`, [firstPid, secondPid])).rows;
      if (row?.forward && (!cycle || row.reverse)) return;
    }
    assert.fail("Expected lock edges unavailable.");
  }
  try {
    instrument(first, "create"); instrument(second, "replace");
    creation = c.store.createApiKey(c.actor, c.input);
    const creationSettled = creation.then(() => { assert.fail("Create settled before its barrier."); }, () => { assert.fail("Create rejected before its barrier."); });
    await Promise.race([atMember.promise, creationSettled]);
    replacement = c.lifecycle.replaceAdminWithExistingAccount({ expectedAdminUserId: "lock-a", newAdminUserId: "lock-b", reason: "synthetic lock-order proof" });
    const settled = Promise.allSettled([creation, replacement]);
    await observe(false);
    assert.deepEqual(adminStages, ["installation", "account-lock-a", "account-lock-b", "member-a"]);
    release.resolve(); clearTimeout(timer);
    assert.equal(pauseExpired, false);
    await observe(true);
    const [createResult, replaceResult] = await settled;
    assert.ok(createResult && replaceResult);
    assert.equal(Number(createResult.status === "fulfilled") + Number(replaceResult.status === "fulfilled"), 1);
    assert.equal(nonceInserts, 1);
    switch (createResult.status) {
      case "rejected":
        assert.ok(createResult.reason instanceof ConnectionStoreError);
        assert.equal(createResult.reason.code, "outcome-unknown");
        assert.deepEqual(driverErrors, [{ service: "create", code: "40P01", statement: "connection-insert" }]);
        assert.ok(replaceResult.status === "fulfilled");
        assert.deepEqual(replaceResult.value, { previousAdminUserId: "lock-a", adminUserId: "lock-b" });
        break;
      case "fulfilled":
        assert.equal(createResult.value.revision, 1);
        assert.ok(replaceResult.status === "rejected" && replaceResult.reason instanceof AdminLifecycleUnavailableError);
        assert.deepEqual(driverErrors, [{ service: "replace", code: "40P01", statement: "member-b" }]);
        break;
      default: {
        const unreachable: never = createResult;
        assert.fail(unreachable);
      }
    }
    assertLockOrderEffects(before, await readLockOrderState(owner), { created: createResult.status === "fulfilled", admin: replaceResult.status === "fulfilled" ? "lock-b" : null });
    return Object.freeze({ observedMembershipWait: true, observedCycle: true, driverSqlstate: "40P01", stagedNonce: true,
      atomicWinnerRollback: true, createWon: createResult.status === "fulfilled", replacementWon: replaceResult.status === "fulfilled" });
  } finally {
    release.resolve(); clearTimeout(timer);
    await Promise.allSettled([creation, replacement]);
    for (const restore of restored.reverse()) restore();
    const rolledBack = await Promise.allSettled([first.query("rollback"), second.query("rollback")]);
    assert.equal(rolledBack.every(result => result.status === "fulfilled"), true);
    c.input.secret.fill(0);
  }
}
