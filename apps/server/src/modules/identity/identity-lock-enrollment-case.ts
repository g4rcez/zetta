import { strict as assert } from "node:assert";
import { createEnrollmentService, EnrollmentUnavailableError } from "./enrollment";
import { readLockOrderState } from "./identity-lock-order-case";
import { awaitBarrier, observeWait, rollbackClients, traceClient, type PositiveContext } from "./identity-lock-positive-cases";
/** Direct SQL models future020's sorted account/member discipline, not a real bot service. */
export async function enrollmentDirections(c: PositiveContext) {
  const enrollment = createEnrollmentService(c.proof.secondDb);
  const issued = await enrollment.issueInvitation({ userId: "lock-b" }, { intendedEmail: "lock-a@lock.invalid", intendedUserId: "lock-a" });
  const invitationState = async () => (await c.proof.owner.query("select id,consumed_at,consumed_by_user_id,revoked_at from invitation where id=$1", [issued.invitationId])).rows;
  const invitationBefore = await invitationState();
  assert.equal(invitationBefore.length, 1);
  for (const syntheticFirst of [true, false]) {
    const before = await readLockOrderState(c.proof.owner); assert.equal(before.admin, "lock-b");
    assert.ok("lock-a" < "lock-b");
    const first = traceClient(c.proof.first, syntheticFirst ? "member-lock-b" : null);
    const second = traceClient(c.proof.second, syntheticFirst ? null : "member-lock-b");
    let synthetic: Promise<unknown> | undefined, accepted: Promise<unknown> | undefined;
    async function sortedSynthetic() {
      await c.proof.first.query("begin");
      for (const id of ["lock-a", "lock-b"]) {
        const result = await c.proof.first.query('select id from "user" where id=$1 for key share', [id]); assert.equal(result.rowCount, 1);
      }
      for (const id of ["lock-a", "lock-b"]) {
        const result = await c.proof.first.query('select user_id from "membership" where user_id=$1 for update', [id]); assert.equal(result.rowCount, 1);
      }
      await c.proof.first.query("commit");
    }
    async function denyActive() {
      try { await enrollment.acceptInvitation({ userId: "lock-a" }, { token: issued.token }); }
      catch (error) { assert.ok(error instanceof EnrollmentUnavailableError); return; }
      assert.fail("Active membership unexpectedly accepted.");
    }
    try {
      if (syntheticFirst) {
        synthetic = sortedSynthetic(); await awaitBarrier(first.reached, synthetic);
        assert.deepEqual(first.stages, ["account-lock-a", "account-lock-b", "member-lock-a", "member-lock-b"]);
        accepted = denyActive(); void accepted.catch(() => undefined);
        await observeWait(c, c.pids[2], c.pids[1], 'from "user"');
        assert.deepEqual(second.stages, ["installation"]); first.release();
      } else {
        accepted = denyActive(); await awaitBarrier(second.reached, accepted);
        assert.deepEqual(second.stages, ["installation", "account-lock-a", "account-lock-b", "member-lock-a", "member-lock-b"]);
        synthetic = sortedSynthetic(); void synthetic.catch(() => undefined);
        await observeWait(c, c.pids[1], c.pids[2], 'from "user"');
        assert.deepEqual(first.stages, []); second.release();
      }
      await Promise.all([synthetic, accepted]); first.verify(); second.verify();
      assert.ok(first.stages.includes("commit") && second.stages.includes("rollback"));
      assert.deepEqual(await readLockOrderState(c.proof.owner), before);
      assert.deepEqual(await invitationState(), invitationBefore);
    } finally {
      first.release(); second.release(); await Promise.allSettled([synthetic, accepted]); first.restore(); second.restore(); await rollbackClients(c);
    }
  }
}
