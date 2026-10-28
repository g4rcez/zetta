import { uuidv7 } from "@zetta/core/uuid";
import { strict as assert } from "node:assert";
import { readLockOrderState, assertLockOrderEffects } from "./identity-lock-order-case";
import { awaitBarrier, observeWait, replace, rollbackClients, traceClient, type PositiveContext } from "./identity-lock-positive-cases";
export async function sessionDirections(c: PositiveContext) {
  for (const sessionFirst of [true, false]) {
    for (const user of ["lock-a", "lock-b"]) await c.proof.owner.query("insert into session(id,user_id,token,expires_at,created_at,updated_at) values($1,$2,$3,now()+interval '1 hour',now(),now())", [uuidv7(), user, uuidv7()]);
    const before = await readLockOrderState(c.proof.owner), id = uuidv7();
    assert.equal(before.admin, "lock-b"); assert.ok(before.sessions_a.length && before.sessions_b.length && before.sessions_c.length);
    const first = traceClient(c.proof.first, null), second = traceClient(c.proof.second, sessionFirst ? null : "member-lock-b");
    let insertion: Promise<unknown> | undefined, replacement: Promise<unknown> | undefined;
    const insert = () => c.proof.first.query("insert into session(id,user_id,token,expires_at,created_at,updated_at) values($1,'lock-a',$2,now()+interval '1 hour',now(),now())", [id, uuidv7()]);
    try {
      await c.proof.first.query("begin");
      if (sessionFirst) {
        insertion = insert(); await insertion;
        assert.deepEqual(first.stages, ["session-insert"]);
        replacement = replace(c); void replacement.catch(() => undefined);
        await observeWait(c, c.pids[2], c.pids[1], 'from "user"');
        assert.deepEqual(second.stages, ["installation"]);
        await c.proof.first.query("commit"); await replacement;
      } else {
        replacement = replace(c); await awaitBarrier(second.reached, replacement);
        assert.deepEqual(second.stages, ["installation", "account-lock-a", "account-lock-b", "member-lock-a", "member-lock-b"]);
        insertion = insert(); void insertion.catch(() => undefined);
        await observeWait(c, c.pids[1], c.pids[2], "insert into session");
        assert.deepEqual(first.stages, []); second.release();
        await replacement; await insertion; await c.proof.first.query("commit");
      }
      first.verify(); second.verify();
      assert.ok(first.stages.includes("commit") && second.stages.includes("commit"));
      const after = await readLockOrderState(c.proof.owner);
      assert.deepEqual(after.sessions_a, sessionFirst ? [] : [id]);
      assertLockOrderEffects(before, { ...after, sessions_a: [] }, { created: false, admin: "lock-a" });
      const [present] = (await c.proof.owner.query<{ present: boolean }>("select exists(select 1 from session where id=$1) as present", [id])).rows;
      assert.equal(present?.present, !sessionFirst);
    } finally {
      second.release();
      // Release a manual FK holder before awaiting replacement on a failed observation.
      await Promise.allSettled([insertion]);
      await c.proof.first.query("rollback");
      await Promise.allSettled([insertion, replacement]); first.restore(); second.restore(); await rollbackClients(c);
    }
    await replace(c, "lock-a", "lock-b");
  }
}
