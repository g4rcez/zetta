import { expect, test } from "bun:test";
import { createDb, type Database } from "@zetta/db";
import { createRequire } from "node:module";
import { runs, runAttempts } from "@zetta/db/schema/runs";
import { and, eq } from "@zetta/db/query";
import { createIdentityAccess } from "../identity/access";
import { createRunStore } from "./runs";
import { runProjection } from "./run-rows";
import { parseRunState } from "./run-state";
import { canonicalRunInput } from "./run-contract";
const id = "00000000-0000-4000-8000-000000000001";
const forged = Object.freeze({ userId: "owner", isAdmin: true });
const request = {
  requestKey: id,
  origin: "interactive",
  botId: "bot",
  conversationId: "conversation",
  configurationId: "configuration",
  configurationVersion: 1,
  input: {
    prompt: "private",
    harness: "fixture",
    connections: [],
    budgets: {
      deadlineMs: 1000,
      maxEvents: 3,
      maxOutputBytes: 100,
      maxToolBytes: 100,
      maxToolCalls: 0,
    },
  },
};
test("owner API is frozen with no backend completion authority and rejects syntax before transaction", async () => {
  let calls = 0;
  const store = createRunStore({
    transaction: async () => {
      calls++;
      throw new Error("Transaction must not open.");
    },
  });
  expect(Object.isFrozen(store)).toBe(true);
  expect(Object.keys(store).sort()).toEqual([
    "cancelOwned",
    "getOwned",
    "getResultOwned",
    "submitOwned",
  ]);
  await expect(store.submitOwned(forged, { ...request, extra: true })).rejects.toThrow(
    "invalid_input",
  );
  for (const patch of [
    { producerKind: "fixture" },
    { producerVersion: 1 },
    { actorActivationRevision: 1 },
  ]) {
    await expect(store.submitOwned(forged, { ...request, ...patch })).rejects.toThrow(
      "invalid_input",
    );
  }
  await expect(store.getOwned(forged, { runId: id, ownerUserId: "other" })).rejects.toThrow(
    "invalid_input",
  );
  await expect(store.cancelOwned(forged, { runId: id, expectedRevision: 0 })).rejects.toThrow(
    "invalid_input",
  );
  await expect(
    store.getResultOwned(forged, { runId: id, attemptId: id, extra: true }),
  ).rejects.toThrow("invalid_input");
  expect(calls).toBe(0);
});

type Call = Readonly<{ text: string; params: readonly unknown[] }>;
const requireDb = createRequire(import.meta.resolve("@zetta/db"));
const {
  drizzle,
}: {
  drizzle: (options: {
    client: {
      query: (query: { text: string }, params?: unknown[]) => Promise<{ rows: unknown[][] }>;
    };
  }) => Pick<Database, "transaction">;
} = requireDb("drizzle-orm/node-postgres");
const {
  getTableColumns,
}: { getTableColumns: (table: unknown) => Record<string, { name: string }> } =
  requireDb("drizzle-orm");
function bindings(call: Call) {
  const match = call.text.match(/insert into "zetta"\."\w+" \(([^)]+)\) values \(([^)]+)\)/);
  if (!match?.[1] || !match[2]) throw new Error("Expected bound INSERT");
  const values = match[2].split(", ");
  return Object.fromEntries(
    match[1].split(", ").map((name, i) => {
      const token = values[i];
      return [
        name.replaceAll('"', ""),
        token?.startsWith("$") ? call.params[Number(token.slice(1)) - 1] : null,
      ];
    }),
  );
}
async function storageFixture(
  options: Readonly<{
    member?: readonly unknown[] | null;
    prior?: "legacy" | "older";
    conflict?: boolean;
    failAt?: "attempt" | "commit";
  }> = {},
) {
  const calls: Call[] = [],
    canonical = canonicalRunInput(request);
  const run: Record<string, unknown> = {
    id,
    owner_user_id: "owner",
    request_key: id,
    origin_kind: "interactive",
    bot_id: "bot",
    conversation_id: "conversation",
    configuration_id: "configuration",
    configuration_version: 1,
    input_version: 1,
    input_snapshot: canonical,
    producer_kind: options.prior === "older" ? "fixture" : null,
    producer_version: options.prior === "older" ? 1 : null,
    actor_activation_revision: options.prior === "older" ? 2 : null,
    created_at: "1970-01-01T00:00:00.001Z",
    revision: 1,
    status: "queued",
    current_generation: 1,
    cancel_requested_at: null,
    started_at: null,
    finished_at: null,
  };
  const attempt: Record<string, unknown> = {
    id,
    run_id: id,
    owner_user_id: "owner",
    generation: 1,
    created_at: "1970-01-01T00:00:00.001Z",
    status: "queued",
    effect_state: "no_effect",
    lease_id: null,
    lease_expires_at: null,
    claimed_at: null,
    started_at: null,
    finished_at: null,
    stop_confirmed_at: null,
    result_version: null,
    result_text: null,
    result_error_code: null,
    result_last_sequence: null,
    cancellation_reason: null,
  };
  const row = (table: unknown, data: Record<string, unknown>) =>
    Object.values(getTableColumns(table)).map((column) => data[column.name]);
  let reads = 0;
  const db = drizzle({
    client: {
      async query({ text }, params = []) {
        const call = { text, params };
        calls.push(call);
        if (text === "commit" && options.failAt === "commit")
          throw new Error("synthetic commit response lost");
        if (text.startsWith("begin") || text === "commit" || text === "rollback")
          return { rows: [] };
        if (text.includes('from "zetta"."membership"'))
          return {
            rows: text.includes("clock_timestamp")
              ? [["1"]]
              : options.member === null
                ? []
                : [[...(options.member ?? ["active", 9])]],
          };
        if (text.startsWith("select") && text.includes('from "zetta"."runs"'))
          return {
            rows: options.prior && (++reads > 1 || !options.conflict) ? [row(runs, run)] : [],
          };
        if (text.startsWith("select") && text.includes('from "zetta"."run_attempts"'))
          return { rows: [row(runAttempts, attempt)] };
        if (text.startsWith('insert into "zetta"."runs"')) {
          if (options.conflict) return { rows: [] };
          Object.assign(run, bindings(call));
          return { rows: [row(runs, run)] };
        }
        if (text.startsWith('insert into "zetta"."run_attempts"')) {
          if (options.failAt === "attempt") throw new Error("synthetic attempt failure");
          Object.assign(attempt, bindings(call));
          return { rows: [row(runAttempts, attempt)] };
        }
        throw new Error("Unexpected protocol fixture query");
      },
    },
  });
  const actor = await createIdentityAccess(
    { api: { getSession: async () => ({ user: { id: "owner" } }) } },
    async () => ({ isAdmin: false }),
  ).requireActive(new Headers());
  return { calls, run, store: createRunStore(db), actor };
}
test("new fixture SQL binds the locked server activation revision atomically with its attempt", async () => {
  for (const revision of [1, 9, 2147483647]) {
    const f = await storageFixture({ member: ["active", revision] });
    const result = await f.store.submitOwned(f.actor, request);
    const member = f.calls.find(
      (call) => call.text.includes('from "zetta"."membership"') && call.text.endsWith("for update"),
    );
    expect(member?.text).toContain('"activation_revision"');
    expect(member?.params).toEqual(["owner"]);
    const insert = f.calls.find((call) => call.text.startsWith('insert into "zetta"."runs"'));
    if (!insert) throw new Error("Missing run insert");
    expect(bindings(insert)).toMatchObject({
      producer_kind: "fixture",
      producer_version: 1,
      actor_activation_revision: revision,
      input_snapshot: canonicalRunInput(request),
    });
    expect(insert.text).not.toContain("private");
    expect(f.calls.findIndex((call) => call === member)).toBeLessThan(f.calls.indexOf(insert));
    expect(f.calls.findIndex((call) => call.text.includes("clock_timestamp"))).toBeGreaterThan(
      f.calls.findIndex((call) => call === member),
    );
    expect(
      f.calls.findIndex((call) => call.text.startsWith('insert into "zetta"."run_attempts"')),
    ).toBeGreaterThan(f.calls.indexOf(insert));
    expect(f.calls.at(-1)?.text).toBe("commit");
    expect(JSON.stringify(result)).not.toMatch(/producer|activation|private|owner/);
  }
});
test("identical request replay preserves legacy or old activation metadata, including insert-conflict reread", async () => {
  for (const prior of ["legacy", "older"] as const)
    for (const conflict of [false, true]) {
      const f = await storageFixture({ prior, conflict });
      const before = { ...f.run };
      expect((await f.store.submitOwned(f.actor, request)).id).toBe(id);
      expect(f.run).toEqual(before);
      expect(f.calls.some((call) => call.text.startsWith("update"))).toBe(false);
      expect(
        f.calls.some((call) => call.text.startsWith('insert into "zetta"."run_attempts"')),
      ).toBe(false);
      expect(
        f.calls.filter((call) => call.text.startsWith('insert into "zetta"."runs"')),
      ).toHaveLength(conflict ? 1 : 0);
      expect(f.calls.at(-1)?.text).toBe("commit");
    }
  const f = await storageFixture({ prior: "older" });
  await expect(
    f.store.submitOwned(f.actor, { ...request, input: { ...request.input, prompt: "different" } }),
  ).rejects.toMatchObject({ code: "request_conflict" });
  expect(f.calls.at(-1)?.text).toBe("rollback");
});
test("every owner operation rejects stale membership and malformed activation revision before resource access", async () => {
  for (const member of [
    null,
    ["removed", 9],
    ["active"],
    ...[null, 0, -1, 1.5, 2147483648, NaN, Infinity, "1", true].map((revision) => [
      "active",
      revision,
    ]),
  ]) {
    for (const operation of ["submitOwned", "getOwned", "getResultOwned", "cancelOwned"] as const) {
      const f = await storageFixture({ member });
      const value = {
        submitOwned: request,
        getOwned: { runId: id },
        getResultOwned: { runId: id, attemptId: id },
        cancelOwned: { runId: id, expectedRevision: 1 },
      };
      await expect(f.store[operation](f.actor, value[operation])).rejects.toMatchObject({
        code: member?.[0] === "active" ? "storage_unavailable" : "ACCESS_DENIED",
      });
      expect(
        f.calls.some((call) =>
          /from "zetta"."runs"|from "zetta"."run_attempts"|insert into|clock_timestamp/.test(
            call.text,
          ),
        ),
      ).toBe(false);
      expect(f.calls.at(-1)?.text).toBe("rollback");
    }
  }
});
test("attempt failure and lost commit response preserve opaque unknown-mutation classification", async () => {
  for (const failAt of ["attempt", "commit"] as const) {
    const f = await storageFixture({ failAt });
    await expect(f.store.submitOwned(f.actor, request)).rejects.toMatchObject({
      code: "outcome_unknown",
      message: "outcome_unknown",
    });
    expect(f.calls.some((call) => call.text.startsWith('insert into "zetta"."runs"'))).toBe(true);
    expect(f.calls.at(-1)?.text).toBe("rollback");
  }
});
test("structurally forged admin never opens a transaction with otherwise valid syntax", async () => {
  let calls = 0;
  const store = createRunStore({
    transaction: async () => {
      calls++;
      throw new Error("Transaction must not open.");
    },
  });
  for (const operation of [
    () => store.submitOwned(forged, request),
    () => store.getOwned(forged, { runId: id }),
    () => store.getResultOwned(forged, { runId: id, attemptId: id }),
    () => store.cancelOwned(forged, { runId: id, expectedRevision: 1 }),
  ]) {
    await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
  expect(calls).toBe(0);
});
test("typed projection SQL binds private result and scopes both run and attempt by owner", async () => {
  const state = parseRunState({
    runId: id,
    attemptId: id,
    generation: 1,
    revision: 2,
    status: "failed",
    effectState: "known",
    maxEvents: 3,
    leaseId: id,
    leaseExpiresAtMs: 100,
    createdAtMs: 1,
    claimedAtMs: 2,
    startedAtMs: 3,
    finishedAtMs: 4,
    cancelRequestedAtMs: null,
    stopConfirmedAtMs: null,
    cancellationReason: null,
    result: { version: 1, text: "private'\\é", errorCode: "adapter_failed", lastSequence: 3 },
  });
  const patch = runProjection(state),
    db = createDb({ DATABASE_URL: "postgresql://127.0.0.1:1/offline_sql_only" });
  const runSql = db
    .update(runs)
    .set(patch.run)
    .where(and(eq(runs.ownerUserId, "owner"), eq(runs.id, id), eq(runs.revision, 1)))
    .toSQL();
  const attemptSql = db
    .update(runAttempts)
    .set(patch.attempt)
    .where(
      and(
        eq(runAttempts.ownerUserId, "owner"),
        eq(runAttempts.runId, id),
        eq(runAttempts.id, id),
        eq(runAttempts.generation, 1),
      ),
    )
    .toSQL();
  expect(runSql.params).toContain("owner");
  expect(runSql.params).toContain(id);
  expect(attemptSql.params).toContain(state.result?.text);
  expect(attemptSql.params).toContain("owner");
  expect(attemptSql.sql).not.toContain("private");
  expect(runSql.sql.split(" where ")[0]).not.toMatch(
    /input_snapshot|configuration_id|owner_user_id/,
  );
  expect(attemptSql.sql.split(" where ")[0]).not.toMatch(
    /"generation"|"run_id"|"owner_user_id"|"created_at"/,
  );
  await db.$client.end();
});

test("outer transaction failure has fixed read or unknown-mutation error without cause", async () => {
  // A throwing transaction boundary verifies error classification only, not transaction behavior.
  const access = createIdentityAccess(
    { api: { getSession: async () => ({ user: { id: "owner" } }) } },
    async () => ({ isAdmin: false }),
  );
  const actor = await access.requireActive(new Headers());
  const store = createRunStore({
    transaction: async () => {
      throw new Error("private SQL and input must not escape");
    },
  });
  for (const [operation, code] of [
    [() => store.submitOwned(actor, request), "outcome_unknown"],
    [() => store.cancelOwned(actor, { runId: id, expectedRevision: 1 }), "outcome_unknown"],
    [() => store.getOwned(actor, { runId: id }), "storage_unavailable"],
    [() => store.getResultOwned(actor, { runId: id, attemptId: id }), "storage_unavailable"],
  ] as const) {
    let caught: unknown;
    try {
      await operation();
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code, message: code });
    expect(JSON.stringify(caught)).not.toContain("private");
    expect(caught instanceof Error && "cause" in caught).toBe(false);
  }
});

test("store module imports without startup or network access", () => {
  const body = `
    import net from 'node:net'; import tls from 'node:tls';
    let attempts = 0; const deny = () => { attempts++; throw new Error('unexpected IO'); };
    net.Socket.prototype.connect = deny; net.Server.prototype.listen = deny; tls.connect = deny;
    Bun.connect = deny; Bun.listen = deny; Bun.serve = deny; globalThis.fetch = deny;
    await import(${JSON.stringify(import.meta.resolve("./runs"))});
    if (attempts !== 0) throw new Error('non-inert import');
  `;
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", body], {
    env: {},
    timeout: 5000,
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toBe("");
});
