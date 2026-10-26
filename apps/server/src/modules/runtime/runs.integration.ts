// Standalone service/DB proof. Controlled sessions are not HTTP authentication proof.
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import type { Database } from "@zetta/db";
import type { ActiveActor } from "../identity/access";
import type { createRunStore } from "./runs";
import type { RunBackendFact, RunTransitionToken } from "./run-state";
import type { RunDto } from "./run-contract";
import { requireIdentityAuthProofTarget } from "../identity/signup.integration";

type Store = ReturnType<typeof createRunStore>;
type Proof = Awaited<ReturnType<typeof import("../../../../../packages/db/src/run-proof-client").openRunProof>>;
type Outcome<T> = Readonly<{ ok: true; value: T } | { ok: false; code: string }>;
export type RunStoreProofContext = Readonly<{
  proof: Proof; actors: readonly [ActiveActor, ActiveActor, ActiveActor]; pids: readonly [number, number, number];
  make: typeof createRunStore; reset(): Promise<void>; fresh(): Promise<readonly [Store, Store]>;
  input(): { requestKey: string; origin: "interactive"; botId: string; conversationId: string; configurationId: string; configurationVersion: number;
    input: { prompt: string; harness: "fixture"; model: null; resumeReference: null; connections: []; budgets: { deadlineMs: number; maxEvents: number; maxOutputBytes: number; maxToolBytes: number; maxToolCalls: number } } };
  capture<T>(promise: Promise<T>): Promise<Outcome<T>>; deny(work: () => unknown | Promise<unknown>, code: string): Promise<void>;
  scenario(name: string, work: () => Promise<void>): Promise<void>; counts(): Promise<string>;
  wait(pid: number, blocker: number, fragment: string): Promise<void>;
  backend(db: Pick<Database, "transaction">, actor: ActiveActor, run: RunDto, fact: RunBackendFact, token?: Partial<RunTransitionToken>): Promise<RunDto>;
  stage(store: Store, run: RunDto): Promise<RunDto>;
}>;
export async function runOwnedRunStoreProof() {
  let phase = "target validation";
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => { process.stderr.write("Run store proof deadline exceeded; details suppressed.\n"); process.exit(1); }, 120_000);
    let proof: Proof | undefined;
    const restore: (() => void)[] = [];
    let attempts = 0, checks = 0;
    try {
      phase = "guarded setup";
      const { openRunProof } = await import("../../../../../packages/db/src/run-proof-client");
      proof = await openRunProof(target.connectionString);
      const active = proof;
      const net = (await import("node:net")).default, tls = (await import("node:tls")).default;
      const dns = (await import("node:dns")).default, http = (await import("node:http")).default, https = (await import("node:https")).default;
      const forbidden = () => { attempts++; throw new Error("Unintended outbound IO."); };
      for (const [object, key] of [[net.Socket.prototype, "connect"], [net.Server.prototype, "listen"], [tls, "connect"],
        [dns, "lookup"], [dns, "resolve"], [dns.promises, "lookup"], [dns.promises, "resolve"], [http, "request"], [http, "get"],
        [https, "request"], [https, "get"], [Bun, "connect"], [Bun, "listen"], [Bun, "serve"], [globalThis, "fetch"]] as const) {
        const previous = Reflect.get(object, key); assert.equal(Reflect.set(object, key, forbidden), true);
        restore.push(() => { Reflect.set(object, key, previous); });
      }
      const { createRunStore, applyRunTransition } = await import("./runs");
      const { readRunRows, RunStoreError } = await import("./run-rows");
      const { RunBoundaryError } = await import("./run-contract");
      const { createIdentityAccess, createMembershipLookup, AccessError } = await import("../identity/access");
      const { and, eq, sql } = await import("@zetta/db/query");
      const { runs, runAttempts } = await import("@zetta/db/schema/runs");
      const { membership } = await import("@zetta/db/schema/identity");
      const { owner, firstDb, secondDb } = proof;
      phase = "controlled session actor fixtures";
      await owner.query(`insert into "user" (id,name,email,email_verified,created_at,updated_at)
        select id,id,id||'@run.invalid',true,now(),now() from unnest(array['owner-a','owner-b','owner-admin']) id;
        insert into membership(user_id,status,joined_at,updated_at) select id,'active',now(),now() from "user";
        insert into installation_identity(id,admin_user_id,admin_membership_status,bootstrapped_at) values(1,'owner-admin','active',now())`);
      const access = createIdentityAccess({ api: { getSession: async ({ headers }) => {
        const id = headers.get("x-synthetic-actor");
        return id && ["owner-a", "owner-b", "owner-admin"].includes(id) ? { user: { id } } : null;
      } } }, createMembershipLookup(firstDb));
      const actors: ActiveActor[] = [];
      for (const id of ["owner-a", "owner-b", "owner-admin"]) actors.push(await access.requireActive(new Headers({ "x-synthetic-actor": id })));
      const [a, b, admin] = actors; assert.ok(a && b && admin); assert.equal(admin.isAdmin, true);
      const pid = async (client: Proof["owner"]) => { const row = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]; assert.ok(row); return row.pid; };
      const pids = [await pid(owner), await pid(proof.first), await pid(proof.second)] as const;
      const reset = async () => {
        await owner.query("begin; delete from run_attempts; delete from runs; update membership set status='active',removed_at=null where user_id='owner-a'; commit");
      };
      const capture: RunStoreProofContext["capture"] = promise => promise.then(value => ({ ok: true as const, value }), error => ({ ok: false as const,
        code: error instanceof AccessError || error instanceof RunStoreError || error instanceof RunBoundaryError ? error.code : "unexpected" }));
      const backend: RunStoreProofContext["backend"] = (db, actor, run, fact, override = {}) => db.transaction(async tx => {
        const [member] = await tx.select().from(membership).where(eq(membership.userId, actor.userId)).for("update");
        if (member?.status !== "active") throw new AccessError("ACCESS_DENIED");
        const [row] = await tx.select().from(runs).where(and(eq(runs.id, run.id), eq(runs.ownerUserId, actor.userId))).for("update"); assert.ok(row);
        const [attempt] = await tx.select().from(runAttempts).where(and(eq(runAttempts.runId, run.id), eq(runAttempts.ownerUserId, actor.userId), eq(runAttempts.generation, row.currentGeneration))).for("update");
        const state = readRunRows(row, attempt).state;
        const [clock] = await tx.select({ now: sql<string>`floor(extract(epoch from clock_timestamp())*1000)::text` }).from(membership).where(eq(membership.userId, actor.userId));
        const now = Number(clock?.now); assert.equal(Number.isSafeInteger(now), true);
        const timed = fact.type === "claimed" ? { ...fact, atMs: now, leaseExpiresAtMs: now + 60000 } : { ...fact, atMs: now };
        return applyRunTransition(tx, actor.userId, { runId: run.id, attemptId: run.attemptId, generation: run.generation,
          leaseId: state.leaseId, expectedRevision: state.revision, ...override }, timed);
      }, { isolationLevel: "read committed" });
      const c: RunStoreProofContext = {
        proof, actors: [a, b, admin], pids, make: createRunStore, reset, backend,
        fresh: async () => { await reset(); return [createRunStore(firstDb), createRunStore(secondDb)] as const; },
        input: () => ({ requestKey: randomUUID(), origin: "interactive", botId: "bot", conversationId: "conversation", configurationId: "configuration", configurationVersion: 1,
          input: { prompt: " Synthetic private e\u0301 prompt ", harness: "fixture", model: null, resumeReference: null, connections: [],
            budgets: { deadlineMs: 1000, maxEvents: 10, maxOutputBytes: 1000, maxToolBytes: 100, maxToolCalls: 1 } } }),
        capture, deny: async (work, code) => { const result = await capture(Promise.resolve().then(work)); assert.equal(!result.ok && result.code === code, true); },
        stage: async (store, run) => {
          await backend(firstDb, a, run, { type: "claimed", atMs: 0, leaseId: randomUUID(), leaseExpiresAtMs: 1 });
          await backend(firstDb, a, run, { type: "admitted", atMs: 0 });
          return store.getOwned(a, { runId: run.id });
        },
        scenario: async (name, work) => { phase = name; await work(); active.healthy(); assert.equal(attempts, 0); checks++; process.stdout.write(`PASS ${name}\n`); },
        counts: async () => JSON.stringify((await owner.query("select (select count(*) from runs) as runs,(select count(*) from run_attempts) as attempts")).rows),
        wait: async (waiter, blocker, fragment) => {
          const until = performance.now() + 1500;
          while (performance.now() < until) {
            await owner.query("select pg_stat_clear_snapshot()");
            const row = (await owner.query<{ blocked: boolean }>(`select wait_event_type='Lock' and $2=any(pg_blocking_pids(pid))
              and position($3 in query)>0 as blocked from pg_stat_activity where pid=$1`, [waiter, blocker, fragment])).rows[0];
            if (row?.blocked) return;
          }
          throw new Error("Expected PostgreSQL lock unavailable.");
        },
      };
      const { runOwnedCases } = await import("./run-store-proof-cases");
      const { runOwnedRaces } = await import("./run-store-proof-races");
      await runOwnedCases(c); await runOwnedRaces(c);
      phase = "fixture cleanup readback";
      await reset();
      await owner.query('begin; delete from installation_identity; delete from membership; delete from "user"; commit');
      const row = (await owner.query<{ count: number }>('select ((select count(*) from runs)+(select count(*) from run_attempts)+(select count(*) from "user"))::int as count')).rows[0];
      assert.equal(row?.count, 0);
      process.stdout.write(`PASS actual owned run store proof (${checks} checks); controlled sessions; fixtures removed\n`);
    } finally {
      const previous = phase; phase = "reserved client cleanup";
      try {
        if (proof) { try { for (const client of [proof.first, proof.second, proof.owner]) await client.query("rollback"); } finally { await proof.close(); } }
        assert.equal(attempts, 0);
      } finally { for (const undo of restore.reverse()) undo(); clearTimeout(deadline); }
      phase = previous;
    }
    process.stdout.write("PASS reserved run clients closed; no new network attempts\n");
  } catch { // no-excuse-ok: catch -- fixed phase only, never SQL/private rows/raw errors.
    process.stderr.write(`Run store proof failed at ${phase}; details suppressed.\n`); process.exitCode = 1;
  }
}
if (import.meta.main) await runOwnedRunStoreProof();
