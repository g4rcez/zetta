import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { requireIdentityProofTarget } from "../../test-support/identity-proof-target";

export async function runIdentityOperatorProof() {
  let phase = "target validation";
  try {
    const target = requireIdentityProofTarget(process.env);
    const children = new Set<Bun.Subprocess<"pipe", "pipe", "pipe">>();
    const deadline = setTimeout(() => {
      for (const child of children) child.kill("SIGKILL");
      process.stderr.write("Identity operator proof deadline exceeded; details suppressed.\n");
      process.exit(1);
    }, 90_000);
    let proof: Awaited<ReturnType<typeof import("../../../../../packages/db/src/identity-proof-client").openIdentityProof>> | undefined;
    try {
      phase = "database setup";
      const { openIdentityProof } = await import("../../../../../packages/db/src/identity-proof-client");
      proof = await openIdentityProof(target.connectionString);
      const { owner } = proof;
      const cli = fileURLToPath(new URL("./admin-operator-cli.ts", import.meta.url));
      const env = {
        ZETTA_OPERATOR_DATABASE_URL: target.connectionString,
        ZETTA_OPERATOR_ALLOW_MUTATION: "identity-admin",
      };
      function command(args: string[], input: object | Uint8Array, patch: Readonly<Record<string, string | undefined>> = {}) {
        const child = Bun.spawn([process.execPath, "--no-env-file", cli, ...args], {
          env: { ...env, ...patch }, stdin: "pipe", stdout: "pipe", stderr: "pipe", timeout: 25_000,
        });
        children.add(child);
        child.stdin.write(input instanceof Uint8Array ? input : JSON.stringify(input));
        child.stdin.end();
        async function capture(stream: ReadableStream<Uint8Array>) {
          const reader = stream.getReader();
          let text = "", bytes = 0;
          const decoder = new TextDecoder("utf-8", { fatal: true });
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) return text + decoder.decode();
              bytes += part.value.byteLength;
              assert.equal(bytes <= 4096, true);
              text += decoder.decode(part.value, { stream: true });
            }
          } finally { reader.releaseLock(); }
        }
        const result = Promise.all([
          child.exited, capture(child.stdout), capture(child.stderr),
        ]).then(([exit, stdout, stderr]) => ({ exit, stdout, stderr }));
        void result.catch(() => { child.kill("SIGKILL"); });
        return { child, result };
      }
      async function run(action: "bootstrap" | "replace", input: object | Uint8Array, failure?: string) {
        const { result } = command([action], input);
        const actual = await result;
        assert.equal(actual.exit === (failure ? 1 : 0)
          && actual.stdout === (failure ? "" : "Admin operator completed.\n")
          && actual.stderr === (failure ? `Admin operator unavailable (${failure}).\n` : ""), true);
      }
      async function snapshot() {
        const state = await owner.query<{ state: unknown }>(`select jsonb_build_object(
          'users', (select jsonb_agg(to_jsonb(t) order by id) from "user" t),
          'accounts', (select jsonb_agg(to_jsonb(t) order by id) from account t),
          'verification', (select jsonb_agg(to_jsonb(t) order by id) from verification t),
          'members', (select jsonb_agg(to_jsonb(t) order by user_id) from membership t),
          'admin', (select jsonb_agg(to_jsonb(t) order by id) from installation_identity t),
          'invites', (select jsonb_agg(to_jsonb(t) order by id) from invitation t),
          'sessions', (select jsonb_agg(to_jsonb(t) order by id) from session t),
          'audits', (select jsonb_agg(to_jsonb(t) order by id) from identity_audit t)) as state`);
        assert.equal(state.rows.length, 1);
        return state.rows[0]?.state;
      }
      async function seed() {
        // Auth user/session rows are fixtures only: no passwords, credentials or login proof.
        await owner.query(`insert into "user" (id,name,email) select id,id,id || '@identity.invalid'
          from unnest($1::text[]) as id`, [["candidate-a", "candidate-b", "control"]]);
      }
      async function check(name: string, work: () => Promise<void>) {
        phase = name;
        await work();
        proof?.healthy();
        process.stdout.write(`PASS ${name}\n`);
      }
      await seed();
      await check("CLI help configuration and input denials preserve all rows", async () => {
        const before = await snapshot();
        const help = await command(["--help"], {}).result;
        assert.equal(help.exit === 0 && help.stderr === "" && help.stdout.includes("bootstrap | replace"), true);
        for (const patch of [{ ZETTA_OPERATOR_ALLOW_MUTATION: "no" }, { ZETTA_OPERATOR_DATABASE_URL: "" }]) {
          const denied = await command(["bootstrap"], { userId: "candidate-a" }, patch).result;
          assert.equal(denied.exit === 1 && denied.stdout === ""
            && denied.stderr === "Admin operator unavailable (configuration).\n", true);
        }
        for (const input of [{ userId: "candidate-a", isOperator: true }, new Uint8Array([0xff])]) {
          await run("bootstrap", input, "input");
        }
        await run("replace", { expectedAdminUserId: "candidate-a", newAdminUserId: "candidate-a", reason: "planned-transfer" }, "input");
        await run("replace", { expectedAdminUserId: "candidate-a", newAdminUserId: "candidate-b", reason: "private freeform" }, "input");
        await run("bootstrap", { userId: "missing-account" }, "operation");
        assert.deepEqual(await snapshot(), before);
      });
      await check("selected existing account bootstraps with one operator audit", async () => {
        await run("bootstrap", { userId: "candidate-a" });
        assert.deepEqual((await owner.query("select admin_user_id from installation_identity")).rows, [{ admin_user_id: "candidate-a" }]);
        assert.deepEqual((await owner.query("select user_id,status from membership")).rows, [{ user_id: "candidate-a", status: "active" }]);
        assert.deepEqual((await owner.query("select event_kind,actor_kind,actor_user_id,subject_user_id,operator_reason from identity_audit")).rows,
          [{ event_kind: "bootstrap", actor_kind: "operator", actor_user_id: null, subject_user_id: "candidate-a", operator_reason: null }]);
      });
      await check("repeated bootstrap and stale or missing replacement deny unchanged", async () => {
        const before = await snapshot();
        for (const userId of ["candidate-a", "candidate-b"]) await run("bootstrap", { userId }, "operation");
        for (const input of [
          { expectedAdminUserId: "control", newAdminUserId: "candidate-b", reason: "planned-transfer" },
          { expectedAdminUserId: "candidate-a", newAdminUserId: "missing-account", reason: "admin-unavailable" },
        ]) await run("replace", input, "operation");
        assert.deepEqual(await snapshot(), before);
      });
      await owner.query(`insert into membership (user_id,status,joined_at,updated_at,removed_at) values
        ('candidate-b','removed','2020-01-01Z','2020-01-02Z','2020-01-02Z'),
        ('control','active','2020-01-01Z','2020-01-01Z',null)`);
      await owner.query(`insert into session (id,token,user_id,expires_at,updated_at)
        select 'session-' || id, 'synthetic-token-' || id, id, now() + interval '1 hour', now() from "user"`);
      const replacement = { expectedAdminUserId: "candidate-a", newAdminUserId: "candidate-b", reason: "planned-transfer" };
      await check("audit failure rolls back pointer memberships sessions and audit", async () => {
        const before = await snapshot();
        await owner.query("alter table identity_audit add constraint operator_proof_audit_fault check (false) not valid");
        try {
          await run("replace", replacement, "operation");
          assert.deepEqual(await snapshot(), before);
        } finally {
          await owner.query("alter table identity_audit drop constraint operator_proof_audit_fault");
        }
      });
      await check("replacement preserves membership history and unrelated stored session", async () => {
        await run("replace", replacement);
        assert.deepEqual((await owner.query("select admin_user_id from installation_identity")).rows, [{ admin_user_id: "candidate-b" }]);
        assert.deepEqual((await owner.query("select user_id,status,removed_at,joined_at = '2020-01-01Z'::timestamptz as preserved from membership order by user_id")).rows,
          [{ user_id: "candidate-a", status: "active", removed_at: null, preserved: false },
            { user_id: "candidate-b", status: "active", removed_at: null, preserved: true },
            { user_id: "control", status: "active", removed_at: null, preserved: true }]);
        assert.deepEqual((await owner.query("select user_id from session")).rows, [{ user_id: "control" }]);
        assert.deepEqual((await owner.query("select event_kind,actor_kind,actor_user_id,subject_user_id,operator_reason from identity_audit where event_kind='admin-replacement'")).rows,
          [{ event_kind: "admin-replacement", actor_kind: "operator", actor_user_id: null, subject_user_id: "candidate-b", operator_reason: "planned-transfer" }]);
      });
      await check("two independent blocked bootstrap commands commit one winner", async () => {
        await proof?.cleanupFixtures();
        await seed();
        await owner.query("begin");
        const contenders: ReturnType<typeof command>[] = [];
        try {
          await owner.query("select id from \"user\" where id in ('candidate-a','candidate-b') order by id for update");
          contenders.push(command(["bootstrap"], { userId: "candidate-a" }), command(["bootstrap"], { userId: "candidate-b" }));
          const barrier = AbortSignal.timeout(1500);
          // Observe both real FOR UPDATE waiters before releasing; no scheduling sleeps.
          while (true) {
            barrier.throwIfAborted();
            await owner.query("select pg_stat_clear_snapshot()");
            const waiting = await owner.query<{ count: number }>(`select count(*)::int as count from pg_stat_activity
              where application_name='zetta-identity-admin' and wait_event_type='Lock'
              and query ilike '%for update%' and pg_backend_pid() = any(pg_blocking_pids(pid))`);
            if (waiting.rows[0]?.count === 2) break;
          }
        } finally {
          await owner.query("rollback");
        }
        const results = await Promise.all(contenders.map(({ result }) => result));
        assert.equal(results.filter((r) => r.exit === 0 && r.stdout === "Admin operator completed.\n" && r.stderr === "").length, 1);
        assert.equal(results.filter((r) => r.exit === 1 && r.stdout === "" && r.stderr === "Admin operator unavailable (operation).\n").length, 1);
        assert.deepEqual((await owner.query(`select
          (select count(*)::int from installation_identity) as admins,
          (select count(*)::int from membership) as members,
          (select count(*)::int from identity_audit) as audits,
          (select count(*)::int from membership m join installation_identity i on i.admin_user_id=m.user_id where m.status='active') as matched`)).rows,
        [{ admins: 1, members: 1, audits: 1, matched: 1 }]);
      });
    } finally {
      const previousPhase = phase;
      phase = "cleanup";
      try {
        for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
        await Promise.allSettled([...children].map((child) => child.exited));
        try { if (proof) await proof.cleanupFixtures(); }
        finally { await proof?.close(); }
      } finally { clearTimeout(deadline); }
      phase = previousPhase;
    }
    process.stdout.write("PASS actual admin operator CLI proof (6 checks); synthetic rows only\n");
  } catch {
    process.stderr.write(`Identity operator proof failed at ${phase}; details suppressed.\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await runIdentityOperatorProof();
