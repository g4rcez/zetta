import { strict as assert } from "node:assert";
import { createEnrollmentService, EnrollmentUnavailableError } from "./enrollment";
import { member, removeSynthetic, type ActivationProof } from "./identity-activation-cases";
export function completedMembershipLock(text: string, parameters: readonly unknown[]) {
  return text.includes('from "membership"') && text.includes('for update') && parameters.includes("activation-join");
}
export async function invitationRace(p: ActivationProof, firstPid: number, secondPid: number) {
  await removeSynthetic(p, "activation-join");
  const before = await member(p, "activation-join");
  const firstService = createEnrollmentService(p.firstDb), secondService = createEnrollmentService(p.secondDb);
  const input = { intendedEmail: "activation-join@invalid.test", intendedUserId: "activation-join" };
  const firstInvite = await firstService.issueInvitation({ userId: "activation-admin" }, input);
  const secondInvite = await firstService.issueInvitation({ userId: "activation-admin" }, input);
  const loserBefore = (await p.owner.query("select to_jsonb(i) as row from invitation i where id=$1", [secondInvite.invitationId])).rows;
  const auditBefore = (await p.owner.query<{ count: number }>("select count(*)::int as count from identity_audit")).rows[0]!.count;
  const reached = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const original = p.first.query; let paused = false, expired = false;
  const deadline = setTimeout(() => { expired = true; release.resolve(); }, 1500);
  Reflect.set(p.first, "query", async function (...args: unknown[]) {
    const pending: unknown = Reflect.apply(original, p.first, args); assert.ok(pending instanceof Promise);
    const result: unknown = await pending;
    const query = args[0]; const text = typeof query === "string" ? query : typeof query === "object" && query !== null ? Reflect.get(query, "text") : undefined;
    const parameters = Array.isArray(args[1]) ? args[1] : [];
    if (!paused && typeof text === "string" && completedMembershipLock(text, parameters)) {
      paused = true; reached.resolve(); await release.promise;
    }
    return result;
  });
  let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined;
  try {
    first = firstService.acceptInvitation({ userId: "activation-join" }, { token: firstInvite.token });
    await Promise.race([reached.promise, first.then(() => assert.fail("missing stage"), () => assert.fail("first operation failed"))]);
    second = secondService.acceptInvitation({ userId: "activation-join" }, { token: secondInvite.token });
    void second.catch(() => undefined);
    let blocked = false; const until = performance.now() + 1000;
    while (performance.now() < until) {
      await p.owner.query("select pg_stat_clear_snapshot()");
      const rows = (await p.owner.query<{ blocked: boolean }>("select $1::int=any(pg_blocking_pids(pid)) and wait_event_type='Lock' and query like '%installation_identity%' as blocked from pg_stat_activity where pid=$2", [firstPid, secondPid])).rows;
      if (rows[0]?.blocked) { blocked = true; break; }
    }
    assert.equal(blocked, true); assert.equal(expired, false); release.resolve();
    await first; await assert.rejects(second, EnrollmentUnavailableError);
    assert.equal(expired, false);
    assert.deepEqual(await member(p, "activation-join"), { ...before, status: "active", activation_revision: before.activation_revision + 1 });
    assert.deepEqual((await p.owner.query("select to_jsonb(i) as row from invitation i where id=$1", [secondInvite.invitationId])).rows, loserBefore);
    const consumed = (await p.owner.query<{ correct: boolean }>("select consumed_at is not null and consumed_by_user_id='activation-join' as correct from invitation where id=$1", [firstInvite.invitationId])).rows;
    assert.equal(consumed.length, 1); assert.equal(consumed[0]?.correct, true);
    assert.equal((await p.owner.query<{ count: number }>("select count(*)::int as count from identity_audit")).rows[0]?.count, auditBefore + 1);
  } finally {
    release.resolve(); clearTimeout(deadline);
    await Promise.allSettled([first, second]); Reflect.set(p.first, "query", original);
  }
}
