import { strict as assert } from "node:assert";
import type { openIdentityProof } from "../../../../../packages/db/src/identity-proof-client";
import { AdminLifecycleUnavailableError, createAdminLifecycleService } from "./admin-lifecycle";
import { createEnrollmentService, EnrollmentUnavailableError } from "./enrollment";
export type ActivationProof = Awaited<ReturnType<typeof openIdentityProof>>;
export function exactConstraint(error: unknown, constraint: string) {
  assert.ok(typeof error === "object" && error !== null);
  assert.equal(Reflect.get(error, "code"), "23514");
  assert.equal(Reflect.get(error, "constraint"), constraint);
}
export async function rejectedSql(
  p: ActivationProof,
  statement: string,
  parameters: unknown[],
  constraint: string,
) {
  await p.owner.query("begin");
  try {
    let caught = false;
    try {
      await p.owner.query(statement, parameters);
    } catch (error) {
      caught = true;
      exactConstraint(error, constraint);
    }
    assert.equal(caught, true);
  } finally {
    await p.owner.query("rollback");
  }
}
export async function state(p: ActivationProof) {
  const result: unknown[] = [];
  // Fixed table list; values stay private, including session/token hashes.
  for (const table of [
    '"user"',
    "membership",
    "installation_identity",
    "invitation",
    "session",
    "identity_audit",
    "account",
    "verification",
  ]) {
    result.push(
      (
        await p.owner.query(
          `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as data from ${table} t`,
        )
      ).rows,
    );
  }
  return result;
}
export async function seedAccount(p: ActivationProof, id: string) {
  await p.owner.query(
    'insert into "user"(id,name,email,email_verified,created_at,updated_at) values($1,$1,$2,false,now(),now())',
    [id, `${id}@invalid.test`],
  );
}
export async function member(p: ActivationProof, id: string) {
  const rows = (
    await p.owner.query<{ activation_revision: number; status: string; joined_at: Date }>(
      "select activation_revision,status,joined_at from membership where user_id=$1",
      [id],
    )
  ).rows;
  assert.equal(rows.length, 1);
  return rows[0]!;
}
export async function removeSynthetic(p: ActivationProof, id: string) {
  assert.equal(
    (
      await p.owner.query(
        "update membership set status='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp() where user_id=$1",
        [id],
      )
    ).rowCount,
    1,
  );
}
export async function schemaCases(p: ActivationProof) {
  await seedAccount(p, "activation-sql");
  await seedAccount(p, "activation-sql-other");
  const insert =
    "insert into membership(user_id,status,activation_revision,joined_at,updated_at) values('activation-sql','active',$1,now(),now())";
  for (const value of [0, 2, 2147483647, null])
    await rejectedSql(p, insert, [value], "membership_activation_initial");
  await p.owner.query("begin");
  try {
    await p.owner.query(insert, [1]);
    assert.equal((await member(p, "activation-sql")).activation_revision, 1);
  } finally {
    await p.owner.query("rollback");
  }
  await p.owner.query(
    "insert into membership(user_id,status,joined_at,updated_at) values('activation-sql','active',now(),now())",
  );
  const original = await member(p, "activation-sql");
  assert.equal(original.activation_revision, 1);
  await rejectedSql(
    p,
    "update membership set user_id='activation-sql-other' where user_id='activation-sql'",
    [],
    "membership_activation_identity_immutable",
  );
  for (const value of [0, 2, null])
    await rejectedSql(
      p,
      "update membership set activation_revision=$1 where user_id='activation-sql'",
      [value],
      "membership_activation_transition",
    );
  await p.owner.query(
    "update membership set updated_at=clock_timestamp() where user_id='activation-sql'",
  );
  await removeSynthetic(p, "activation-sql");
  assert.equal((await member(p, "activation-sql")).activation_revision, 1);
  for (const value of [1, 3, null])
    await rejectedSql(
      p,
      "update membership set status='active',removed_at=null,activation_revision=$1 where user_id='activation-sql'",
      [value],
      "membership_activation_transition",
    );
  await p.owner.query(
    "update membership set status='active',removed_at=null,activation_revision=2 where user_id='activation-sql'",
  );
  assert.deepEqual(await member(p, "activation-sql"), { ...original, activation_revision: 2 });
  await rejectedSql(
    p,
    "update membership set activation_revision=1 where user_id='activation-sql'",
    [],
    "membership_activation_transition",
  );
}
export async function lifecycleCases(p: ActivationProof) {
  for (const id of ["activation-admin", "activation-next", "activation-join"])
    await seedAccount(p, id);
  const admin = createAdminLifecycleService(p.firstDb),
    enrollment = createEnrollmentService(p.firstDb);
  await admin.bootstrapExistingAccount({ userId: "activation-admin" });
  assert.equal((await member(p, "activation-admin")).activation_revision, 1);
  await p.owner.query(
    "insert into membership(user_id,status,joined_at,updated_at) values('activation-next','active',now(),now())",
  );
  const next = await member(p, "activation-next");
  await admin.replaceAdminWithExistingAccount({
    expectedAdminUserId: "activation-admin",
    newAdminUserId: "activation-next",
    reason: "synthetic",
  });
  assert.deepEqual(await member(p, "activation-next"), next);
  await removeSynthetic(p, "activation-admin");
  const prior = await member(p, "activation-admin");
  await admin.replaceAdminWithExistingAccount({
    expectedAdminUserId: "activation-next",
    newAdminUserId: "activation-admin",
    reason: "synthetic",
  });
  assert.deepEqual(await member(p, "activation-admin"), {
    ...prior,
    status: "active",
    activation_revision: 2,
  });
  const invite = () =>
    enrollment.issueInvitation(
      { userId: "activation-admin" },
      { intendedEmail: "activation-join@invalid.test", intendedUserId: "activation-join" },
    );
  const first = await invite();
  await enrollment.acceptInvitation({ userId: "activation-join" }, { token: first.token });
  const joined = await member(p, "activation-join");
  assert.equal(joined.activation_revision, 1);
  await removeSynthetic(p, "activation-join");
  const second = await invite();
  await enrollment.acceptInvitation({ userId: "activation-join" }, { token: second.token });
  assert.deepEqual(await member(p, "activation-join"), { ...joined, activation_revision: 2 });
  for (const token of [first.token, second.token, "x".repeat(43)]) {
    const before = await state(p);
    await assert.rejects(
      enrollment.acceptInvitation({ userId: "activation-join" }, { token }),
      EnrollmentUnavailableError,
    );
    assert.deepEqual(await state(p), before);
  }
}
export async function auditRollbackCases(p: ActivationProof) {
  const enrollment = createEnrollmentService(p.firstDb),
    admin = createAdminLifecycleService(p.firstDb);
  await removeSynthetic(p, "activation-join");
  await removeSynthetic(p, "activation-next");
  const invite = await enrollment.issueInvitation(
    { userId: "activation-admin" },
    { intendedEmail: "activation-join@invalid.test", intendedUserId: "activation-join" },
  );
  await p.owner.query(
    "insert into session(id,user_id,token,expires_at,created_at,updated_at) values('activation-session-a','activation-admin','synthetic-a',now()+interval '1 hour',now(),now()),('activation-session-b','activation-next','synthetic-b',now()+interval '1 hour',now(),now())",
  );
  await p.owner
    .query(`create function zetta.identity_activation_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'fixture' using errcode='23514',constraint='identity_activation_audit_rejected'; end $$;
    create trigger identity_activation_fail_audit before insert on zetta.identity_audit for each row execute function zetta.identity_activation_fail_audit()`);
  try {
    await rejectedSql(
      p,
      "insert into identity_audit(id,event_kind,actor_kind,occurred_at) values('activation-audit-probe','bootstrap','operator',now())",
      [],
      "identity_activation_audit_rejected",
    );
    const before = await state(p);
    await assert.rejects(
      enrollment.acceptInvitation({ userId: "activation-join" }, { token: invite.token }),
      EnrollmentUnavailableError,
    );
    assert.deepEqual(await state(p), before);
    await assert.rejects(
      admin.replaceAdminWithExistingAccount({
        expectedAdminUserId: "activation-admin",
        newAdminUserId: "activation-next",
        reason: "synthetic",
      }),
      AdminLifecycleUnavailableError,
    );
    assert.deepEqual(await state(p), before);
  } finally {
    await p.owner.query(
      "drop trigger identity_activation_fail_audit on zetta.identity_audit; drop function zetta.identity_activation_fail_audit()",
    );
  }
  await enrollment.acceptInvitation({ userId: "activation-join" }, { token: invite.token });
  assert.equal((await member(p, "activation-join")).activation_revision, 3);
  await admin.replaceAdminWithExistingAccount({
    expectedAdminUserId: "activation-admin",
    newAdminUserId: "activation-next",
    reason: "synthetic",
  });
  assert.equal((await member(p, "activation-next")).activation_revision, 2);
  await admin.replaceAdminWithExistingAccount({
    expectedAdminUserId: "activation-next",
    newAdminUserId: "activation-admin",
    reason: "synthetic",
  });
}
export async function exhaustionCases(p: ActivationProof) {
  const admin = createAdminLifecycleService(p.firstDb),
    enrollment = createEnrollmentService(p.firstDb);
  const before = await state(p);
  await rejectedSql(
    p,
    "update membership set status='active',removed_at=null where user_id='activation-exhausted'",
    [],
    "membership_activation_exhausted",
  );
  await assert.rejects(
    admin.bootstrapExistingAccount({ userId: "activation-exhausted" }),
    AdminLifecycleUnavailableError,
  );
  assert.deepEqual(await state(p), before);
  await seedAccount(p, "activation-admin");
  await seedAccount(p, "activation-positive");
  await admin.bootstrapExistingAccount({ userId: "activation-admin" });
  assert.equal((await member(p, "activation-admin")).activation_revision, 1);
  const invite = await enrollment.issueInvitation(
    { userId: "activation-admin" },
    { intendedEmail: "activation-exhausted@invalid.test", intendedUserId: "activation-exhausted" },
  );
  await p.owner.query(
    "insert into session(id,user_id,token,expires_at,created_at,updated_at) values('activation-max-session','activation-exhausted','synthetic-max',now()+interval '1 hour',now(),now()),('activation-admin-session','activation-admin','synthetic-admin',now()+interval '1 hour',now(),now())",
  );
  const stable = await state(p);
  await assert.rejects(
    enrollment.acceptInvitation({ userId: "activation-exhausted" }, { token: invite.token }),
    EnrollmentUnavailableError,
  );
  assert.deepEqual(await state(p), stable);
  await assert.rejects(
    admin.replaceAdminWithExistingAccount({
      expectedAdminUserId: "activation-admin",
      newAdminUserId: "activation-exhausted",
      reason: "synthetic",
    }),
    AdminLifecycleUnavailableError,
  );
  assert.deepEqual(await state(p), stable);
  const positive = await enrollment.issueInvitation(
    { userId: "activation-admin" },
    { intendedEmail: "activation-positive@invalid.test", intendedUserId: "activation-positive" },
  );
  await enrollment.acceptInvitation({ userId: "activation-positive" }, { token: positive.token });
  assert.equal((await member(p, "activation-positive")).activation_revision, 1);
  await admin.replaceAdminWithExistingAccount({
    expectedAdminUserId: "activation-admin",
    newAdminUserId: "activation-positive",
    reason: "synthetic",
  });
  assert.equal((await member(p, "activation-exhausted")).activation_revision, 2147483647);
}
