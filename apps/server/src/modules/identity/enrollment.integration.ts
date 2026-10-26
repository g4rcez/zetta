// Explicit standalone command only; intentionally not *.test.ts or part of broad discovery.
import { strict as assert } from "node:assert";
import { requireIdentityProofTarget } from "../../test-support/identity-proof-target";

let phase = "target validation";

async function main() {
  const target = requireIdentityProofTarget(process.env);
  // Guard first: neither runtime adapter nor service/schema imports occur on denial.
  const deadline = setTimeout(() => {
    process.stderr.write("Identity database proof deadline exceeded; details suppressed.\n");
    process.exit(1); // OS closes all sockets even if driver cleanup is stuck.
  }, 90000);
  let proof: Awaited<ReturnType<typeof import("../../../../../packages/db/src/identity-proof-client").openIdentityProof>> | undefined;
  try {
    const { openIdentityProof } = await import("../../../../../packages/db/src/identity-proof-client");
    const { createAdminLifecycleService, AdminLifecycleUnavailableError } = await import("./admin-lifecycle");
    phase = "database setup";
    proof = await openIdentityProof(target.connectionString);
    const { runInvitationRaces } = await import("./enrollment-races.integration");
    const { owner, first, second, firstDb, secondDb, cleanupFixtures } = proof;
    const service = createAdminLifecycleService(firstDb);
    const otherService = createAdminLifecycleService(secondDb);
    const query = (text: string, values: unknown[] = []) => owner.query(text, values);
    const rows = async (text: string) => (await query(text)).rows;
    async function accounts() {
      await query(`insert into "user" (id,name,email) values
        ('old','Synthetic Old','old@identity.invalid'), ('new','Synthetic New','new@identity.invalid'),
        ('other','Synthetic Other','other@identity.invalid')`);
    }
    async function deniedSql(text: string, code: string, constraint: string | string[]) {
      let rejected = false;
      try { await query(text); } catch (error) {
        rejected = true;
        const denial = error as { code?: string; constraint?: string };
        assert.equal(denial.code, code);
        assert.ok((Array.isArray(constraint) ? constraint : [constraint]).includes(denial.constraint ?? ""));
      }
      assert.equal(rejected, true);
    }
    async function deniedService(operation: Promise<unknown>) {
      let rejected = false;
      try { await operation; } catch (error) {
        rejected = true;
        assert.ok(error instanceof AdminLifecycleUnavailableError);
        assert.equal(error.message, new AdminLifecycleUnavailableError().message);
        assert.equal((error as Error & { cause?: unknown }).cause, undefined);
      }
      assert.equal(rejected, true);
    }
    async function failAudit(work: () => Promise<void>) {
      // Real SQL constraint failure on new audit writes, including after session deletion.
      await query('ALTER TABLE public.identity_audit ADD CONSTRAINT identity_proof_fail_audit CHECK (false) NOT VALID');
      try { await work(); }
      finally { await query('ALTER TABLE public.identity_audit DROP CONSTRAINT identity_proof_fail_audit'); }
    }
    async function run(name: string, work: () => Promise<void>) {
      phase = name;
      await cleanupFixtures();
      try { await work(); proof!.healthy(); }
      finally { await cleanupFixtures(); }
      process.stdout.write(`PASS ${name}\n`); // Fixed names only; no result/driver/config printing.
    }

    await run("singleton, membership removal/status and active-admin FK constraints", async () => {
      await accounts();
      await query(`insert into membership values ('old','active',now(),null,now()),
        ('new','removed',now(),now(),now())`);
      await deniedSql("update membership set status='unknown' where user_id='old'", "23514", ["membership_status_check", "membership_removal_check"]);
      await deniedSql("update membership set removed_at=now() where user_id='old'", "23514", "membership_removal_check");
      await deniedSql("update membership set removed_at=null where user_id='new'", "23514", "membership_removal_check");
      await deniedSql("insert into installation_identity values (2,'old','active',now())", "23514", "installation_identity_singleton_check");
      await deniedSql("insert into installation_identity values (1,'new','active',now())", "23503", "installation_identity_active_admin_fk");
      await deniedSql("insert into installation_identity values (1,'other','active',now())", "23503", "installation_identity_active_admin_fk");
      await deniedSql("insert into installation_identity values (1,'old','removed',now())", "23514", "installation_identity_admin_active_check");
      await query("insert into installation_identity values (1,'old','active',now())");
      await deniedSql("insert into installation_identity values (1,'old','active',now())", "23505", "installation_identity_pkey");
      // Referenced-row RESTRICT actions report restrict_violation, not a missing-reference error.
      await deniedSql("update membership set status='removed', removed_at=now() where user_id='old'", "23001", "installation_identity_active_admin_fk");
      await deniedSql("delete from membership where user_id='old'", "23001", "installation_identity_active_admin_fk");
      assert.deepEqual(await rows("select admin_user_id from installation_identity"), [{ admin_user_id: "old" }]);
    });

    await run("invitation hash uniqueness, expiry and consumption pair constraints", async () => {
      await accounts();
      await query(`insert into invitation (id,token_hash,intended_email,issued_by_user_id,created_at,expires_at)
        values ('invite','${"a".repeat(64)}','new@identity.invalid','old',now(),now()+interval '1 day')`);
      await deniedSql(`insert into invitation (id,token_hash,intended_email,issued_by_user_id,created_at,expires_at)
        select 'duplicate',token_hash,intended_email,issued_by_user_id,created_at,expires_at from invitation`,
      "23505", "invitation_token_hash_unique");
      await deniedSql("update invitation set expires_at=created_at", "23514", "invitation_expiry_check");
      await deniedSql("update invitation set expires_at=created_at-interval '1 second'", "23514", "invitation_expiry_check");
      await deniedSql("update invitation set consumed_at=now()", "23514", "invitation_consumption_check");
      await deniedSql("update invitation set consumed_by_user_id='new'", "23514", "invitation_consumption_check");
      await deniedSql("update invitation set intended_email='NEW@identity.invalid'", "23514", "invitation_email_canonical_check");
      await query("update invitation set consumed_at=now(),consumed_by_user_id='new'");
      assert.deepEqual(await rows("select consumed_at is not null as consumed, consumed_by_user_id from invitation"),
        [{ consumed: true, consumed_by_user_id: "new" }]);
    });

    await run("audit actor and operator replacement reason constraints", async () => {
      await accounts();
      await query(`insert into identity_audit (id,event_kind,actor_kind,occurred_at)
        values ('audit','bootstrap','operator',now())`);
      await deniedSql("update identity_audit set actor_kind='unknown'", "23514", ["identity_audit_actor_kind_check", "identity_audit_actor_check"]);
      await deniedSql("update identity_audit set event_kind='unknown'", "23514", "identity_audit_event_kind_check");
      await deniedSql("update identity_audit set actor_kind='user'", "23514", "identity_audit_actor_check");
      await deniedSql("update identity_audit set actor_user_id='old'", "23514", "identity_audit_actor_check");
      await deniedSql("update identity_audit set event_kind='admin-replacement'", "23514", "identity_audit_replacement_reason_check");
      await deniedSql("update identity_audit set event_kind='admin-replacement',operator_reason='   '", "23514", "identity_audit_replacement_reason_check");
      await deniedSql(`update identity_audit set event_kind='admin-replacement',actor_kind='user',
        actor_user_id='old',operator_reason='Synthetic recovery'`, "23514", "identity_audit_replacement_reason_check");
      await query("update identity_audit set event_kind='admin-replacement',operator_reason='Synthetic recovery'");
      assert.equal((await rows("select * from identity_audit")).length, 1);
    });

    await run("bootstrap commits singleton, active membership and operator audit", async () => {
      await accounts();
      assert.deepEqual(await service.bootstrapExistingAccount({ userId: "old" }), { adminUserId: "old" });
      assert.deepEqual(await rows("select admin_user_id from installation_identity"), [{ admin_user_id: "old" }]);
      assert.deepEqual(await rows("select user_id,status,removed_at from membership"), [{ user_id: "old", status: "active", removed_at: null }]);
      assert.deepEqual(await rows("select event_kind,actor_kind,actor_user_id,subject_user_id from identity_audit"),
        [{ event_kind: "bootstrap", actor_kind: "operator", actor_user_id: null, subject_user_id: "old" }]);
    });

    await run("two independent bootstrap connections have one winner and no orphan membership/audit", async () => {
      await accounts();
      const pidA = (await first.query("select pg_backend_pid() as pid")).rows[0].pid as number;
      const pidB = (await second.query("select pg_backend_pid() as pid")).rows[0].pid as number;
      assert.notEqual(pidA, pidB);
      await query("begin");
      let operations: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        // Both contenders must pass the missing singleton read before either can activate.
        await query('select id from "user" where id in (\'old\',\'new\') order by id for update');
        operations = Promise.allSettled([
          service.bootstrapExistingAccount({ userId: "old" }),
          otherService.bootstrapExistingAccount({ userId: "new" }),
        ]);
        const until = Date.now() + 1500;
        let waiting = false;
        while (Date.now() < until) {
          const result = await query(`select count(*)::int as count from pg_stat_activity
            where pid = any($1::int[]) and wait_event_type = 'Lock'`, [[pidA, pidB]]);
          if (result.rows[0].count === 2) { waiting = true; break; }
          await Bun.sleep(10);
        }
        assert.equal(waiting, true);
      } finally {
        await query("rollback");
        if (operations) await operations; // Settle both before fixture cleanup even on barrier failure.
      }
      const outcomes = await operations!;
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
      for (const outcome of outcomes) if (outcome.status === "rejected") {
        assert.ok(outcome.reason instanceof AdminLifecycleUnavailableError);
        assert.equal(outcome.reason.cause, undefined);
      }
      const winner = (await rows("select admin_user_id from installation_identity"))[0]!.admin_user_id;
      assert.ok(winner === "old" || winner === "new");
      assert.deepEqual(await rows("select user_id,status from membership"), [{ user_id: winner, status: "active" }]);
      assert.deepEqual(await rows("select event_kind,subject_user_id from identity_audit"), [{ event_kind: "bootstrap", subject_user_id: winner }]);
    });

    await run("bootstrap audit SQL failure rolls back singleton and activation", async () => {
      await accounts();
      await failAudit(() => deniedService(service.bootstrapExistingAccount({ userId: "old" })));
      for (const table of ["installation_identity", "membership", "identity_audit"]) {
        assert.equal((await rows(`select * from ${table}`)).length, 0);
      }
      // Committed success after fault removal also proves the connection left its failed transaction.
      await service.bootstrapExistingAccount({ userId: "new" });
      assert.deepEqual(await rows("select admin_user_id from installation_identity"), [{ admin_user_id: "new" }]);
    });

    await run("replacement audit failure restores pointer, reactivation and deleted sessions; retry commits", async () => {
      await accounts();
      await service.bootstrapExistingAccount({ userId: "old" });
      await query(`insert into membership values ('new','removed','2020-01-01T00:00:00Z',now(),now()),
        ('other','active',now(),null,now())`);
      await query(`insert into session (id,token,expires_at,updated_at,user_id) values
        ('session-old','synthetic-old',now()+interval '1 hour',now(),'old'),
        ('session-new','synthetic-new',now()+interval '1 hour',now(),'new'),
        ('session-other','synthetic-other',now()+interval '1 hour',now(),'other')`);
      const beforeMembers = await rows("select * from membership order by user_id");
      const beforeSessions = await rows("select * from session order by id");
      const input = { expectedAdminUserId: "old", newAdminUserId: "new", reason: "  Synthetic recovery  " };
      await failAudit(() => deniedService(service.replaceAdminWithExistingAccount(input)));
      assert.deepEqual(await rows("select admin_user_id from installation_identity"), [{ admin_user_id: "old" }]);
      assert.deepEqual(await rows("select * from membership order by user_id"), beforeMembers);
      assert.deepEqual(await rows("select * from session order by id"), beforeSessions);
      assert.deepEqual(await rows("select event_kind from identity_audit"), [{ event_kind: "bootstrap" }]);
      assert.deepEqual(await service.replaceAdminWithExistingAccount(input), { previousAdminUserId: "old", adminUserId: "new" });
      assert.deepEqual(await rows("select admin_user_id from installation_identity"), [{ admin_user_id: "new" }]);
      assert.deepEqual(await rows("select user_id from session"), [{ user_id: "other" }]);
      assert.deepEqual(await rows("select user_id,status,removed_at from membership order by user_id"),
        ["new", "old", "other"].map((user_id) => ({ user_id, status: "active", removed_at: null })));
      assert.equal((await rows("select joined_at from membership where user_id='new'"))[0]!.joined_at.toISOString(), "2020-01-01T00:00:00.000Z");
      assert.deepEqual(await rows("select event_kind,actor_kind,subject_user_id,operator_reason from identity_audit where event_kind='admin-replacement'"),
        [{ event_kind: "admin-replacement", actor_kind: "operator", subject_user_id: "new", operator_reason: "Synthetic recovery" }]);
    });
    await runInvitationRaces({ proof, run, failAudit });
    proof.healthy();
  } finally {
    // Keep the hard deadline armed during cleanup/Pool.end too.
    try { await proof?.close(); } finally { clearTimeout(deadline); }
  }
  process.stdout.write("PASS identity database proof (14 checks)\n");
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const setupFailure = /^Identity database proof unavailable \((connection|service identity|empty target|migration source|driver setup|migration apply)\)\.$/.test(message);
  process.stderr.write(setupFailure ? `${message}\n` : `Identity database proof failed at ${phase}; details suppressed.\n`);
  process.exitCode = 1;
});
