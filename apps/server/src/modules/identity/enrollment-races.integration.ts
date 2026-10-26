// Test-only extension, loaded by the guarded standalone entry after dedicated proof setup.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createEnrollmentService, EnrollmentUnavailableError } from "./enrollment";
import { createAdminLifecycleService } from "./admin-lifecycle";

export interface InvitationRaceProof {
  proof: Awaited<ReturnType<typeof import("../../../../../packages/db/src/identity-proof-client").openIdentityProof>>;
  run(name: string, work: () => Promise<void>): Promise<void>;
  failAudit(work: () => Promise<void>): Promise<void>;
}

export async function runInvitationRaces({ proof, run, failAudit }: InvitationRaceProof) {
  const { owner, first, second, firstDb, secondDb } = proof;
  const enrollment = createEnrollmentService(firstDb);
  const otherEnrollment = createEnrollmentService(secondDb);
  const admin = createAdminLifecycleService(firstDb);
  const otherAdmin = createAdminLifecycleService(secondDb);
  const query = (text: string, values: unknown[] = []) => owner.query(text, values);
  const rows = async (text: string, values: unknown[] = []) => (await query(text, values)).rows;
  const old = { userId: "old" }, target = { userId: "target" };
  async function setup() {
    await query(`insert into "user" (id,name,email) values
      ('old','Synthetic Old','old@identity.invalid'), ('new','Synthetic New','new@identity.invalid'),
      ('target','Synthetic Target','target@identity.invalid'), ('wrong','Synthetic Wrong','wrong@identity.invalid')`);
    await admin.bootstrapExistingAccount({ userId: "old" });
  }
  async function issue(intendedUserId = "target", intendedEmail = "TARGET@identity.invalid") {
    return enrollment.issueInvitation(old, { intendedEmail, intendedUserId });
  }
  function opaque(error: unknown) {
    assert.ok(error instanceof EnrollmentUnavailableError);
    assert.equal(error.message, new EnrollmentUnavailableError().message);
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error), ["name"]);
  }
  async function denied(operation: Promise<unknown>) {
    const [result] = await Promise.allSettled([operation]);
    assert.equal(result!.status, "rejected");
    if (result!.status === "rejected") opaque(result!.reason);
  }
  async function counts(consumed: number, members: number, audits: number) {
    assert.deepEqual(await rows(`select
      (select count(*)::int from invitation where consumed_at is not null) as consumed,
      (select count(*)::int from membership where user_id='target' and status='active') as members,
      (select count(*)::int from identity_audit where event_kind='invite-consumed') as audits`),
    [{ consumed, members, audits }]);
  }
  const ownerPid = (await query("select pg_backend_pid() as pid")).rows[0].pid as number;
  const firstPid = (await first.query("select pg_backend_pid() as pid")).rows[0].pid as number;
  const secondPid = (await second.query("select pg_backend_pid() as pid")).rows[0].pid as number;
  assert.equal(new Set([ownerPid, firstPid, secondPid]).size, 3);
  async function waitBlocked(pid: number, blocker: number | null, until: number, relation: string) {
    while (Date.now() < until) {
      // Activity query text is transaction-cached; refresh before observing each contender.
      await query("select pg_stat_clear_snapshot()");
      const [row] = await rows(`select wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0
        and ($2::int is null or $2=any(pg_blocking_pids(pid))) and position($3 in query)>0 as blocked
        from pg_stat_activity where pid=$1`, [pid, blocker, relation]);
      if (row?.blocked === true) return;
      await Bun.sleep(10);
    }
    assert.fail("Invitation proof lock barrier unavailable.");
  }
  // Every contender is settled after releasing the owner, before run() can clean fixtures.
  async function acceptanceRace(tokens: [string, string]) {
    await query("begin");
    let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await query("select id from installation_identity where id=1 for update");
      pending = Promise.allSettled([
        enrollment.acceptInvitation(target, { token: tokens[0] }),
        otherEnrollment.acceptInvitation(target, { token: tokens[1] }),
      ]);
      const until = Date.now() + 1500;
      await waitBlocked(firstPid, null, until, "installation_identity");
      await waitBlocked(secondPid, null, until, "installation_identity");
    } finally {
      try { await query("rollback"); } finally { if (pending) await pending; }
    }
    const results = await pending!;
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    for (const result of results) {
      if (result.status === "rejected") opaque(result.reason);
      else assert.deepEqual(result.value, { userId: "target" });
    }
    await counts(1, 1, 1);
    assert.deepEqual(await rows("select user_id,status from membership order by user_id"),
      ["old", "target"].map((user_id) => ({ user_id, status: "active" })));
    assert.deepEqual(await rows("select event_kind,count(*)::int as count from identity_audit group by event_kind order by event_kind"),
      [{ event_kind: "bootstrap", count: 1 }, { event_kind: "invite-consumed", count: 1 },
        { event_kind: "invite-issued", count: tokens[0] === tokens[1] ? 1 : 2 }]);
    assert.deepEqual(await rows(`select actor_kind,actor_user_id,subject_user_id,invitation_id
      from identity_audit where event_kind='invite-consumed'`),
    [{ actor_kind: "user", actor_user_id: "target", subject_user_id: "target",
      invitation_id: (await rows("select id from invitation where consumed_at is not null"))[0]!.id }]);
  }

  await run("invitation issuance hashes canonical tokens and denies wrong account/user without consumption", async () => {
    await setup();
    const invitation = await issue();
    assert.deepEqual(Object.keys(invitation).sort(), ["expiresAt", "invitationId", "token"]);
    assert.match(invitation.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(invitation.token, "base64url").length, 32);
    assert.equal(Buffer.from(invitation.token, "base64url").toString("base64url"), invitation.token);
    assert.deepEqual(await rows(`select token_hash,intended_email,intended_user_id,issued_by_user_id,
      expires_at-created_at=interval '24 hours' as lifetime, expires_at from invitation`),
    [{ token_hash: createHash("sha256").update(invitation.token).digest("hex"),
      intended_email: "target@identity.invalid", intended_user_id: "target", issued_by_user_id: "old",
      lifetime: true, expires_at: invitation.expiresAt }]);
    await denied(enrollment.acceptInvitation({ userId: "wrong" }, { token: invitation.token }));
    // Matching email alone cannot bypass an exact intended-user binding.
    const boundElsewhere = await issue("wrong");
    await denied(enrollment.acceptInvitation(target, { token: boundElsewhere.token }));
    // Intended user matches; only the account's email is wrong.
    await denied(enrollment.acceptInvitation({ userId: "wrong" }, { token: boundElsewhere.token }));
    await counts(0, 0, 0);
    assert.deepEqual(await rows("select user_id from membership"), [{ user_id: "old" }]);
    assert.deepEqual(await rows(`select actor_kind,actor_user_id,subject_user_id from identity_audit
      where event_kind='invite-issued' order by subject_user_id`),
    ["target", "wrong"].map((subject_user_id) => ({ actor_kind: "user", actor_user_id: "old", subject_user_id })));
    await enrollment.acceptInvitation(target, { token: invitation.token });
    await counts(1, 1, 1);
  });

  await run("revoked and database-clock-expired invitations deny without activation", async () => {
    await setup();
    const revoked = await issue(), expired = await issue();
    assert.deepEqual(await enrollment.revokeInvitation(old, { invitationId: revoked.invitationId }),
      { invitationId: revoked.invitationId });
    // DB-clock fixture update, strictly valid expiry constraint; no wall-clock sleep.
    await query(`update invitation set created_at=clock_timestamp()-interval '2 days',
      expires_at=clock_timestamp()-interval '1 day' where id=$1`, [expired.invitationId]);
    await denied(enrollment.acceptInvitation(target, { token: revoked.token }));
    await denied(enrollment.acceptInvitation(target, { token: expired.token }));
    await counts(0, 0, 0);
    assert.deepEqual(await rows("select event_kind,count(*)::int as count from identity_audit group by event_kind order by event_kind"),
      [{ event_kind: "bootstrap", count: 1 }, { event_kind: "invite-issued", count: 2 }, { event_kind: "invite-revoked", count: 1 }]);
  });

  await run("two independent acceptance connections consume one token exactly once", async () => {
    await setup();
    const invitation = await issue();
    await acceptanceRace([invitation.token, invitation.token]);
    await denied(enrollment.acceptInvitation(target, { token: invitation.token }));
    await counts(1, 1, 1);
  });

  await run("distinct invitations for one user serialize with losing token unconsumed", async () => {
    await setup();
    const one = await issue(), two = await issue();
    await acceptanceRace([one.token, two.token]);
    assert.deepEqual(await rows(`select count(*)::int as count from invitation
      where consumed_at is null and consumed_by_user_id is null`), [{ count: 1 }]);
    // Existing contract denies already-active members before claiming the second token.
    for (const invitation of [one, two]) await denied(enrollment.acceptInvitation(target, { token: invitation.token }));
    await counts(1, 1, 1);
  });

  await run("acceptance audit SQL failure rolls back consumption and activation; removed joined-at survives retry", async () => {
    await setup();
    const invitation = await issue();
    const beforeInvitation = await rows("select * from invitation");
    const beforeAudits = await rows("select * from identity_audit order by id");
    await failAudit(() => denied(enrollment.acceptInvitation(target, { token: invitation.token })));
    assert.deepEqual(await rows("select * from invitation"), beforeInvitation);
    assert.deepEqual(await rows("select * from identity_audit order by id"), beforeAudits);
    await counts(0, 0, 0);
    assert.deepEqual(await rows("select user_id from membership"), [{ user_id: "old" }]);
    await query("insert into membership values ('target','removed','2020-01-01T00:00:00Z',now(),now())");
    const before = await rows("select * from membership where user_id='target'");
    await failAudit(() => denied(enrollment.acceptInvitation(target, { token: invitation.token })));
    assert.deepEqual(await rows("select * from membership where user_id='target'"), before);
    assert.deepEqual(await rows("select * from identity_audit order by id"), beforeAudits);
    assert.deepEqual(await rows("select consumed_at,consumed_by_user_id from invitation"),
      [{ consumed_at: null, consumed_by_user_id: null }]);
    await counts(0, 0, 0);
    await enrollment.acceptInvitation(target, { token: invitation.token });
    await counts(1, 1, 1);
    assert.deepEqual(await rows("select status,removed_at,joined_at from membership where user_id='target'"),
      [{ status: "active", removed_at: null, joined_at: new Date("2020-01-01T00:00:00Z") }]);
    // No schedule/readiness objects exist in this schema: this is identity-only SQL proof.
  });

  await run("acceptance membership SQL failure rolls back claim and preserves absent or removed membership", async () => {
    for (const removed of [false, true]) {
      await proof.cleanupFixtures();
      await setup();
      const invitation = await issue();
      if (removed) await query("insert into membership values ('target','removed','2020-01-01T00:00:00Z',now(),now())");
      const beforeInvitation = await rows("select * from invitation");
      const beforeMembers = await rows("select * from membership order by user_id");
      const beforeAudits = await rows("select * from identity_audit order by id");
      // Preserve existing rows; fail the real activation write after the token claim.
      await query("ALTER TABLE public.membership ADD CONSTRAINT identity_proof_fail_membership CHECK (false) NOT VALID");
      try { await denied(enrollment.acceptInvitation(target, { token: invitation.token })); }
      finally { await query("ALTER TABLE public.membership DROP CONSTRAINT identity_proof_fail_membership"); }
      assert.deepEqual(await rows("select * from invitation"), beforeInvitation);
      assert.deepEqual(await rows("select * from membership order by user_id"), beforeMembers);
      assert.deepEqual(await rows("select * from identity_audit order by id"), beforeAudits);
      await counts(0, 0, 0);
      await enrollment.acceptInvitation(target, { token: invitation.token });
      await counts(1, 1, 1);
      if (removed) assert.equal((await rows("select joined_at from membership where user_id='target'"))[0]!.joined_at.toISOString(), "2020-01-01T00:00:00.000Z");
    }
  });

  await run("replacement versus old-admin issuance honors both forced lock orders and new authority", async () => {
    for (const replacementFirst of [false, true]) {
      await proof.cleanupFixtures();
      await setup();
      const replace = () => (replacementFirst ? admin : otherAdmin).replaceAdminWithExistingAccount({
        expectedAdminUserId: "old", newAdminUserId: "new", reason: "Synthetic ordered replacement",
      });
      const issuance = () => (replacementFirst ? otherEnrollment : enrollment).issueInvitation(old,
        { intendedEmail: "TARGET@identity.invalid", intendedUserId: "target" });
      await query("begin");
      const pending: Promise<PromiseSettledResult<unknown>[]>[] = [];
      try {
        // First contender owns singleton and is positively observed waiting on this account.
        await query('select id from "user" where id=\'old\' for update');
        const until = Date.now() + 1500;
        pending.push(Promise.allSettled([replacementFirst ? replace() : issuance()]));
        await waitBlocked(firstPid, ownerPid, until, '"user"');
        pending.push(Promise.allSettled([replacementFirst ? issuance() : replace()]));
        await waitBlocked(secondPid, firstPid, until, "installation_identity");
      } finally {
        try { await query("rollback"); } finally { await Promise.allSettled(pending); }
      }
      const results = (await Promise.all(pending)).flat();
      assert.equal(results[0]!.status, "fulfilled");
      assert.equal(results[1]!.status, replacementFirst ? "rejected" : "fulfilled");
      if (results[1]!.status === "rejected") opaque(results[1]!.reason);
      assert.deepEqual(await rows("select admin_user_id from installation_identity"), [{ admin_user_id: "new" }]);
      await denied(enrollment.issueInvitation(old, { intendedEmail: "target@identity.invalid" }));
      const issued = await enrollment.issueInvitation({ userId: "new" },
        { intendedEmail: "target@identity.invalid", intendedUserId: "target" });
      assert.deepEqual(Object.keys(issued).sort(), ["expiresAt", "invitationId", "token"]);
      assert.deepEqual(await rows("select issued_by_user_id from invitation order by issued_by_user_id"),
        (replacementFirst ? ["new"] : ["new", "old"]).map((issued_by_user_id) => ({ issued_by_user_id })));
      assert.deepEqual(await rows("select event_kind,count(*)::int as count from identity_audit group by event_kind order by event_kind"),
        [{ event_kind: "admin-replacement", count: 1 }, { event_kind: "bootstrap", count: 1 },
          { event_kind: "invite-issued", count: replacementFirst ? 1 : 2 }]);
      await counts(0, 0, 0);
      assert.deepEqual(await rows("select user_id,status from membership order by user_id"),
        ["new", "old"].map((user_id) => ({ user_id, status: "active" })));
    }
  });
}
