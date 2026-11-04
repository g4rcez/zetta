// Standalone proof: import never opens a database or application.
import { uuidv7 } from "@zetta/core/uuid";
import { strict as assert } from "node:assert";
import { requireIdentityAuthProofTarget } from "../identity/signup.integration";

type Proof = Awaited<
  ReturnType<typeof import("../../../../../packages/db/src/run-proof-client").openRunProof>
>;
type Client = Proof["owner"];
type Row = Readonly<Record<string, string | number | Date | null>>;
export type RunSchemaContext = {
  proof: Proof;
  runId: string;
  attemptId: string;
  pids: readonly [number, number];
  scenario(name: string, work: () => Promise<void>): Promise<void>;
  insert(client: Client, table: "runs" | "run_attempts", overrides?: Row): Promise<void>;
  rollback(work: () => Promise<void>): Promise<void>;
  reject(work: () => Promise<void>, constraint: string | null, code?: string): Promise<void>;
  reset(): Promise<void>;
  wait(waiter: number, blocker: number): Promise<void>;
};
export function matchesFailure(error: unknown, code: string, constraint: string | null) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === code &&
    (constraint === null || ("constraint" in error && error.constraint === constraint))
  );
}
export async function runRunSchemaProof() {
  let phase = "target validation";
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => {
      process.stderr.write("Run schema proof deadline exceeded; details suppressed.\n");
      process.exit(1);
    }, 120_000);
    let proof: Proof | undefined;
    let outboundAttempts = 0,
      count = 0;
    const restore: (() => void)[] = [];
    try {
      phase = "guarded database and pinned migration setup";
      const { openRunProof } = await import("../../../../../packages/db/src/run-proof-client");
      proof = await openRunProof(target.connectionString);
      const active = proof;
      const { owner, first, second } = proof;
      const forbidden = () => {
        outboundAttempts++;
        throw new Error("Unintended outbound IO.");
      };
      const net = (await import("node:net")).default,
        tls = (await import("node:tls")).default;
      const dns = (await import("node:dns")).default,
        http = (await import("node:http")).default,
        https = (await import("node:https")).default;
      for (const [object, key] of [
        [net.Socket.prototype, "connect"],
        [net.Server.prototype, "listen"],
        [tls, "connect"],
        [dns, "lookup"],
        [dns, "resolve"],
        [dns.promises, "lookup"],
        [dns.promises, "resolve"],
        [http, "request"],
        [http, "get"],
        [https, "request"],
        [https, "get"],
        [Bun, "connect"],
        [Bun, "listen"],
        [Bun, "serve"],
        [globalThis, "fetch"],
      ] as const) {
        const previous = Reflect.get(object, key);
        assert.equal(Reflect.set(object, key, forbidden), true);
        restore.push(() => {
          Reflect.set(object, key, previous);
        });
      }
      const firstPid = (await first.query<{ pid: number }>("select pg_backend_pid() as pid"))
        .rows[0]?.pid;
      const secondPid = (await second.query<{ pid: number }>("select pg_backend_pid() as pid"))
        .rows[0]?.pid;
      assert.ok(firstPid && secondPid && firstPid !== secondPid);
      const runId = uuidv7(),
        attemptId = uuidv7();
      const base = new Date("2026-01-01T00:00:00.000Z");
      async function insert(client: Client, table: "runs" | "run_attempts", overrides: Row = {}) {
        const defaults: Row =
          table === "runs"
            ? {
                id: uuidv7(),
                owner_user_id: "owner-a",
                request_key: uuidv7(),
                origin_kind: "interactive",
                bot_id: "bot",
                conversation_id: "conversation",
                configuration_id: "configuration",
                configuration_version: 1,
                input_version: 1,
                input_snapshot: "[1]",
                created_at: base,
                revision: 1,
                status: "queued",
                current_generation: 1,
              }
            : {
                id: uuidv7(),
                run_id: runId,
                owner_user_id: "owner-a",
                generation: 1,
                created_at: base,
                status: "queued",
                effect_state: "no_effect",
              };
        const row = { ...defaults, ...overrides },
          columns = Object.keys(row);
        await client.query(
          `insert into ${table} (${columns.map((key) => `"${key}"`).join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
          Object.values(row),
        );
      }
      await owner.query(`insert into "user" (id,name,email,email_verified,created_at,updated_at) values
        ('owner-a','Synthetic A','a@run.invalid',true,now(),now()),('owner-b','Synthetic B','b@run.invalid',true,now(),now());
        insert into membership(user_id,status,joined_at,updated_at) select id,'active',now(),now() from "user"`);
      const c: RunSchemaContext = {
        proof,
        runId,
        attemptId,
        pids: [firstPid, secondPid],
        insert,
        async scenario(name, work) {
          phase = name;
          await work();
          active.healthy();
          assert.equal(outboundAttempts, 0);
          count++;
          process.stdout.write(`PASS ${name}\n`);
        },
        async rollback(work) {
          await first.query("begin");
          try {
            await work();
          } finally {
            await first.query("rollback");
          }
        },
        async reject(work, constraint, code = "23514") {
          await first.query("begin");
          let matched = false;
          try {
            await work();
            await first.query("commit");
          } catch (error) {
            matched = matchesFailure(error, code, constraint);
            if (!matched)
              process.stderr.write(
                `Run schema oracle mismatch: expected-state=${matchesFailure(error, code, null)}; expected-constraint=${error instanceof Error && "constraint" in error && error.constraint === constraint}.\n`,
              );
          } finally {
            await first.query("rollback");
          }
          assert.equal(matched, true);
        },
        async reset() {
          await owner.query("begin");
          try {
            await owner.query("delete from run_attempts; delete from runs");
            await insert(owner, "runs", { id: runId });
            await insert(owner, "run_attempts", { id: attemptId });
            await insert(owner, "run_attempts", { generation: 2 });
            await owner.query("commit");
          } catch (error) {
            await owner.query("rollback");
            throw error;
          }
        },
        async wait(waiter, blocker) {
          const until = performance.now() + 1500;
          while (performance.now() < until) {
            const result = await owner.query<{ waiting: boolean }>(
              "select $2::int=any(pg_blocking_pids($1::int)) as waiting",
              [waiter, blocker],
            );
            if (result.rows[0]?.waiting) return;
          }
          throw new Error("Expected database lock unavailable.");
        },
      };
      await c.reset();
      const { runSchemaCases } = await import("./run-schema-cases");
      const { runSchemaRaces } = await import("./run-schema-races");
      await runSchemaCases(c);
      await runSchemaRaces(c);
      phase = "committed fixture cleanup readback";
      await owner.query(
        'begin; delete from run_attempts; delete from runs; delete from membership; delete from "user"; commit',
      );
      const remaining = await owner.query<{
        count: number;
      }>(`select ((select count(*) from runs)+(select count(*) from run_attempts)
        +(select count(*) from membership)+(select count(*) from "user"))::int as count`);
      assert.equal(remaining.rows[0]?.count, 0);
      active.healthy();
      assert.equal(outboundAttempts, 0);
      process.stdout.write(
        `PASS actual PostgreSQL run schema proof (${count} checks); fixtures removed; no new network attempts\n`,
      );
    } finally {
      const previousPhase = phase;
      phase = "reserved client cleanup";
      try {
        if (proof) {
          try {
            for (const client of [proof.first, proof.second, proof.owner])
              await client.query("rollback");
          } finally {
            await proof.close();
          }
        }
        assert.equal(outboundAttempts, 0);
      } finally {
        for (const undo of restore.reverse()) undo();
        clearTimeout(deadline);
      }
      phase = previousPhase;
    }
    process.stdout.write("PASS reserved run clients closed\n");
  } catch {
    // no-excuse-ok: catch -- never print SQL, private values or raw driver/assertion data.
    process.stderr.write(`Run schema proof failed at ${phase}; details suppressed.\n`);
    process.exitCode = 1;
  }
}
if (import.meta.main) await runRunSchemaProof();
