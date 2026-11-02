import { uuidv7 } from "@zetta/core/uuid";
import { strict as assert } from "node:assert";
import type { LockOrderProof } from "./identity-lock-order.integration";
import type { createAdminLifecycleService } from "./admin-lifecycle";
import type { createConnectionStore } from "../connections/store";
import type { ActiveActor } from "./access";
import { readLockOrderState, assertLockOrderEffects } from "./identity-lock-order-case";
export type PositiveContext = Readonly<{
  proof: LockOrderProof;
  pids: readonly [number, number, number];
  actor: ActiveActor;
  store: Awaited<ReturnType<typeof createConnectionStore>>;
  lifecycle: ReturnType<typeof createAdminLifecycleService>;
  input(): {
    operationId: string;
    provider: string;
    label: string;
    secret: Buffer;
    expiresAt: null;
  };
}>;
export function queryStage(text: string, params: readonly unknown[]): string {
  if (text === "commit" || text === "rollback") return text;
  if (text.startsWith("insert into session")) return "session-insert";
  if (!/ for (update|key share)$/.test(text)) return "other";
  if (text.includes('from "zetta"."installation_identity"')) return "installation";
  const id = params[0];
  if (id !== "lock-a" && id !== "lock-b") return "other";
  if (text.includes('from "zetta"."user"')) return `account-${id}`;
  if (text.includes('from "zetta"."membership"')) return `member-${id}`;
  return "other";
}
/** Test-only query observer: forwards the actual query and result, never supplies rows. */
export function traceClient(client: LockOrderProof["first"], pauseAt: string | null) {
  const original = client.query,
    reached = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const stages: string[] = [],
    errors: string[] = [];
  let hits = 0,
    expired = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  assert.ok(
    Reflect.set(client, "query", async (...args: readonly unknown[]) => {
      const q = args[0],
        text =
          typeof q === "string"
            ? q
            : typeof q === "object" && q !== null && "text" in q && typeof q.text === "string"
              ? q.text
              : "";
      const params: readonly unknown[] = Array.isArray(args[1]) ? args[1] : [];
      let result: unknown;
      try {
        const pending: unknown = Reflect.apply(original, client, args);
        assert.ok(pending instanceof Promise);
        result = await pending;
      } catch (error) {
        errors.push(
          error instanceof Error &&
            "code" in error &&
            typeof error.code === "string" &&
            ["40P01", "55P03", "57014"].includes(error.code)
            ? error.code
            : "unexpected",
        );
        throw error;
      }
      const stage = queryStage(text, params);
      if (stage !== "other") stages.push(stage);
      if (stage === pauseAt) {
        assert.equal(++hits, 1);
        timer = setTimeout(() => {
          expired = true;
          release.resolve();
        }, 1000);
        reached.resolve();
        await release.promise;
      }
      return result;
    }),
  );
  return {
    stages,
    errors,
    reached: reached.promise,
    release() {
      clearTimeout(timer);
      release.resolve();
    },
    verify() {
      assert.equal(expired, false);
      assert.deepEqual(errors, []);
      if (pauseAt !== null) assert.equal(hits, 1);
    },
    restore() {
      clearTimeout(timer);
      release.resolve();
      assert.ok(Reflect.set(client, "query", original));
    },
  };
}
export async function awaitBarrier(barrier: Promise<void>, operation: Promise<unknown>) {
  await Promise.race([
    barrier,
    operation.then(
      () => assert.fail("Operation passed barrier."),
      () => assert.fail("Operation failed before barrier."),
    ),
  ]);
}
export async function observeWait(
  c: PositiveContext,
  waiter: number,
  holder: number,
  queryPart: string,
) {
  const until = performance.now() + 650;
  while (performance.now() < until) {
    await c.proof.owner.query("select pg_stat_clear_snapshot()");
    const [row] = (
      await c.proof.owner.query<{ waiting: boolean; reverse: boolean }>(
        `select
      exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid)) and position($3 in query)>0) as waiting,
      $1=any(pg_blocking_pids($2)) as reverse`,
        [waiter, holder, queryPart],
      )
    ).rows;
    assert.equal(row?.reverse, false);
    if (row?.waiting) return;
  }
  assert.fail("Expected forward wait missing.");
}
export async function rollbackClients(c: PositiveContext) {
  const results = await Promise.allSettled([
    c.proof.first.query("rollback"),
    c.proof.second.query("rollback"),
  ]);
  assert.ok(results.every((r) => r.status === "fulfilled"));
}
export async function replace(c: PositiveContext, from = "lock-b", to = "lock-a") {
  assert.deepEqual(
    await c.lifecycle.replaceAdminWithExistingAccount({
      expectedAdminUserId: from,
      newAdminUserId: to,
      reason: "synthetic positive control",
    }),
    { previousAdminUserId: from, adminUserId: to },
  );
}
export async function connectionDirections(c: PositiveContext) {
  for (const connectionFirst of [true, false]) {
    for (const user of ["lock-a", "lock-b"])
      await c.proof.owner.query(
        "insert into session(id,user_id,token,expires_at,created_at,updated_at) values($1,$2,$3,now()+interval '1 hour',now(),now())",
        [uuidv7(), user, uuidv7()],
      );
    const before = await readLockOrderState(c.proof.owner);
    assert.equal(before.admin, "lock-b");
    assert.ok(before.sessions_a.length && before.sessions_b.length && before.sessions_c.length);
    const first = traceClient(c.proof.first, connectionFirst ? "member-lock-a" : null);
    const second = traceClient(c.proof.second, connectionFirst ? null : "member-lock-b");
    let creation: Promise<unknown> | undefined, replacement: Promise<unknown> | undefined;
    const input = c.input();
    try {
      if (connectionFirst) {
        creation = c.store.createApiKey(c.actor, input);
        await awaitBarrier(first.reached, creation);
        assert.deepEqual(first.stages, ["account-lock-a", "member-lock-a"]);
        replacement = replace(c);
        void replacement.catch(() => undefined);
        await observeWait(c, c.pids[2], c.pids[1], 'from "zetta"."user"');
        assert.deepEqual(second.stages, ["installation"]);
        first.release();
      } else {
        replacement = replace(c);
        await awaitBarrier(second.reached, replacement);
        assert.deepEqual(second.stages, [
          "installation",
          "account-lock-a",
          "account-lock-b",
          "member-lock-a",
          "member-lock-b",
        ]);
        creation = c.store.createApiKey(c.actor, input);
        void creation.catch(() => undefined);
        await observeWait(c, c.pids[1], c.pids[2], 'from "zetta"."user"');
        assert.deepEqual(first.stages, []);
        second.release();
      }
      await Promise.all([creation, replacement]);
      first.verify();
      second.verify();
      assert.ok(first.stages.includes("commit") && second.stages.includes("commit"));
      assertLockOrderEffects(before, await readLockOrderState(c.proof.owner), {
        created: true,
        admin: "lock-a",
      });
    } finally {
      first.release();
      second.release();
      await Promise.allSettled([creation, replacement]);
      first.restore();
      second.restore();
      await rollbackClients(c);
      input.secret.fill(0);
    }
    await replace(c, "lock-a", "lock-b");
  }
}
