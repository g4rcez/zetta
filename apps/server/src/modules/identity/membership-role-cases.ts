import { uuidv7 } from "@zetta/core/uuid";
import { strict as assert } from "node:assert";
import type { openMembershipRoleProof } from "../../../../../packages/db/src/membership-role-proof-client";
import { verifyMembershipRole } from "../../../../../packages/db/src/membership-role-proof-client";
import { createAdminLifecycleService } from "./admin-lifecycle";
import { createEnrollmentService } from "./enrollment";
import { createIdentityAccess, createMembershipLookup } from "./access";
import { createRunStore } from "../runtime/runs";
import { RunStoreError } from "../runtime/run-rows";
export type RoleProof = Awaited<ReturnType<typeof openMembershipRoleProof>>;
export function assertPermissionError(
  error: unknown,
  code: "42501" | "23001",
  constraint?: string,
) {
  assert.ok(typeof error === "object" && error !== null);
  assert.equal(Reflect.get(error, "code"), code);
  if (constraint !== undefined) assert.equal(Reflect.get(error, "constraint"), constraint);
}
async function rejected(
  client: RoleProof["client"],
  statement: string,
  code: "42501" | "23001",
  constraint?: string,
) {
  await client.query("begin");
  try {
    let failed = false;
    try {
      await client.query(statement);
    } catch (error) {
      failed = true;
      assertPermissionError(error, code, constraint);
    }
    assert.equal(failed, true);
  } finally {
    await client.query("rollback");
  }
}
async function snapshot(p: RoleProof) {
  const result: unknown[] = [];
  for (const table of [
    '"user"',
    "membership",
    "installation_identity",
    "invitation",
    "identity_audit",
    "account",
    "session",
    "verification",
    "connection",
    "connection_credential",
    "connection_user_key",
    "connection_key_check",
    "connection_mutation_receipt",
    "connection_nonce",
    "runs",
    "run_attempts",
  ]) {
    result.push(
      (
        await p.proof.owner.query(
          `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as data from ${table} t`,
        )
      ).rows,
    );
  }
  return result;
}
function input() {
  return {
    requestKey: uuidv7(),
    origin: "interactive",
    botId: "bot",
    conversationId: "conversation",
    configurationId: "configuration",
    configurationVersion: 1,
    input: {
      prompt: "Synthetic role proof",
      harness: "fixture",
      model: null,
      resumeReference: null,
      connections: [],
      budgets: {
        deadlineMs: 1000,
        maxEvents: 10,
        maxOutputBytes: 1000,
        maxToolBytes: 100,
        maxToolCalls: 1,
      },
    },
  };
}
export async function roleCases(p: RoleProof) {
  const { owner } = p.proof;
  await owner.query(`insert into "user"(id,name,email,email_verified,created_at,updated_at)
    select id,id,id||'@invalid.test',false,now(),now() from unnest(array['role-admin','role-member']) id;
    insert into membership(user_id,status,joined_at,removed_at,updated_at)
    values('role-member','removed','2000-01-01','2000-01-02','2000-01-02')`);
  await createAdminLifecycleService(p.proof.firstDb).bootstrapExistingAccount({
    userId: "role-admin",
  });
  const invitations = createEnrollmentService(p.proof.firstDb);
  const invitation = await invitations.issueInvitation(
    { userId: "role-admin" },
    { intendedEmail: "role-member@invalid.test", intendedUserId: "role-member" },
  );
  const enrollment = createEnrollmentService(p.db);
  await enrollment.acceptInvitation({ userId: "role-member" }, { token: invitation.token });
  const member = (
    await owner.query<{ revision: number; joined: string }>(
      "select activation_revision as revision,to_char(joined_at at time zone 'UTC','YYYY-MM-DD') as joined from membership where user_id='role-member'",
    )
  ).rows;
  assert.deepEqual(member, [{ revision: 2, joined: "2000-01-01" }]);
  // Controlled session source, real fresh membership lookup; no HTTP/signin claim.
  const actor = await createIdentityAccess(
    { api: { getSession: async () => ({ user: { id: "role-member" } }) } },
    createMembershipLookup(p.db),
  ).requireActive(new Headers());
  assert.equal(actor.isAdmin, false);
  const store = createRunStore(p.db),
    request = input();
  const run = await store.submitOwned(actor, request);
  assert.deepEqual(await store.getOwned(actor, { runId: run.id }), run);
  assert.deepEqual(await store.submitOwned(actor, request), run);
  const stamp = (
    await owner.query(
      "select producer_kind,producer_version,actor_activation_revision from runs where id=$1",
      [run.id],
    )
  ).rows;
  assert.deepEqual(stamp, [
    { producer_kind: "fixture", producer_version: 1, actor_activation_revision: 2 },
  ]);
  const stable = await snapshot(p);
  await rejected(
    owner,
    "delete from membership where user_id='role-member'",
    "23001",
    "runs_owner_user_id_membership_user_id_fkey",
  );
  assert.deepEqual(await snapshot(p), stable);
  const denied = [
    ["membership delete", "delete from membership where user_id='role-member'"],
    ["membership truncate", "truncate membership cascade"],
    [
      "membership identity update",
      "update membership set user_id=user_id where user_id='role-member'",
    ],
    ["user identity update", "update zetta.\"user\" set id=id where id='role-member'"],
    ["run history delete", "delete from runs where owner_user_id='role-member'"],
    ["attempt history delete", "delete from run_attempts where owner_user_id='role-member'"],
    ["table alter", "alter table membership add column role_fixture_forbidden text"],
    ["table drop", "drop table membership cascade"],
    ["trigger disable", "alter table membership disable trigger all"],
    [
      "function replacement",
      "create or replace function zetta.membership_guard_activation_revision() returns trigger language plpgsql as $$ begin return NEW; end $$",
    ],
    ["schema creation", "create schema role_fixture_forbidden"],
    ["public object creation", "create table public.role_fixture_forbidden(id integer)"],
    ["app schema object creation", "create table zetta.role_fixture_forbidden(id integer)"],
    ["temporary object creation", "create temporary table role_fixture_forbidden(id integer)"],
    ["owner role escalation", "set role zetta_identity_runner"],
    ["owner session authorization", "set session authorization zetta_identity_runner"],
    ["self superuser escalation", "alter role zetta_membership_runtime_proof superuser"],
    ["replication bypass", "set session_replication_role='replica'"],
  ] as const;
  for (const [, statement] of denied) {
    await rejected(p.client, statement, "42501");
    assert.deepEqual(await snapshot(p), stable);
    await verifyMembershipRole(p.client);
  }
  // Fixed owner-created failure is after the real restricted INSERT into runs.
  await owner.query(`create function zetta.membership_role_fail_attempt() returns trigger language plpgsql as $$
    begin raise exception using errcode='23514',constraint='membership_role_attempt_rejected',message='Synthetic failure'; end $$;
    create trigger membership_role_fail_attempt before insert on run_attempts for each row execute function zetta.membership_role_fail_attempt();
    revoke all on function zetta.membership_role_fail_attempt() from public`);
  const originalQuery = p.client.query;
  let rejectedAtAttempt = false;
  Reflect.set(p.client, "query", async (...args: unknown[]) => {
    try {
      return await Reflect.apply(originalQuery, p.client, args);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        Reflect.get(error, "code") === "23514" &&
        Reflect.get(error, "constraint") === "membership_role_attempt_rejected"
      )
        rejectedAtAttempt = true;
      throw error;
    }
  });
  try {
    await verifyMembershipRole(p.client);
    await assert.rejects(
      store.submitOwned(actor, input()),
      (error: unknown) => error instanceof RunStoreError && error.code === "outcome_unknown",
    );
    assert.equal(rejectedAtAttempt, true);
    assert.deepEqual(await snapshot(p), stable);
  } finally {
    Reflect.set(p.client, "query", originalQuery);
    await owner.query(
      "drop trigger membership_role_fail_attempt on run_attempts; drop function zetta.membership_role_fail_attempt()",
    );
  }
  const again = await store.submitOwned(actor, input());
  assert.notEqual(again.id, run.id);
  assert.deepEqual(await store.getOwned(actor, { runId: again.id }), again);
  await owner.query(
    "update membership set status='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp() where user_id='role-member'",
  );
  const second = await invitations.issueInvitation(
    { userId: "role-admin" },
    { intendedEmail: "role-member@invalid.test", intendedUserId: "role-member" },
  );
  await enrollment.acceptInvitation({ userId: "role-member" }, { token: second.token });
  assert.equal(
    (
      await owner.query<{ revision: number }>(
        "select activation_revision as revision from membership where user_id='role-member'",
      )
    ).rows[0]?.revision,
    3,
  );
  assert.deepEqual(
    (await owner.query("select actor_activation_revision from runs where id=$1", [run.id])).rows,
    [{ actor_activation_revision: 2 }],
  );
  await verifyMembershipRole(p.client);
  return [
    "authenticated restricted service reenrollment and stamped run submission",
    "retaining owner FK exact RESTRICT denial",
    ...denied.map(([name]) => `${name} exact permission denial`),
    "restricted transaction rollback and positive DML after denials",
  ];
}
