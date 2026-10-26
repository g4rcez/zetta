import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { adminOperatorPoolOptions } from "./admin-operator-client";
import { createAdminOperatorClientOwner } from "./admin-operator-client-owner";
import { runAdminOperator } from "../../../apps/server/src/modules/identity/admin-operator";
import type { OperatorDependencies } from "../../../apps/server/src/modules/identity/admin-operator";

const env = { ZETTA_OPERATOR_DATABASE_URL: "postgresql://operator:synthetic@127.0.0.1:55432/identity_local", ZETTA_OPERATOR_ALLOW_MUTATION: "identity-admin" };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

// Only the lifecycle contract: no pg Pool, driver connection, SQL or shared module mocks.
function ownershipFixture() {
  const calls: string[] = [];
  const client = Object.assign(new EventEmitter(), { release: () => { calls.push("release"); } });
  const pool = Object.assign(new EventEmitter(), { end: async () => { calls.push("pool-end"); } });
  const owner = createAdminOperatorClientOwner(pool);
  const connect = () => { pool.emit("connect", client); owner.reserve(client); };
  return { calls, client, pool, owner, connect };
}

function runnerFixture(owner: Pick<ReturnType<typeof createAdminOperatorClientOwner>, "close" | "healthy">) {
  const stdout: string[] = [], stderr: string[] = [];
  let deadlineActive = false;
  let expire: (() => void) | undefined;
  let terminations = 0;
  const deps: OperatorDependencies = {
    isTTY: () => false,
    readInput: async () => '{"userId":"selected"}',
    startDeadline: (expired) => { deadlineActive = true; expire = expired; return () => { deadlineActive = false; }; },
    terminate: () => { terminations++; },
    open: async () => ({
      ...owner,
      service: {
        bootstrapExistingAccount: async () => ({ adminUserId: "PRIVATE" }),
        replaceAdminWithExistingAccount: async () => ({ previousAdminUserId: "PRIVATE", adminUserId: "PRIVATE" }),
      },
    }),
    stdout: (text) => { stdout.push(text); }, stderr: (text) => { stderr.push(text); },
  };
  return { deps, stdout, stderr, deadlineActive: () => deadlineActive, expire: () => expire?.(), terminations: () => terminations };
}

test("admin-operator-client pool end alone cannot finish close, print success or clear deadline", async () => {
  const f = ownershipFixture(); f.connect();
  const runner = runnerFixture(f.owner);
  let result: number | undefined;
  const pending = runAdminOperator(["bootstrap"], env, runner.deps).then((code) => { result = code; });
  await turn();
  expect(f.calls).toEqual(["release", "pool-end"]);
  expect(result).toBeUndefined();
  expect(runner.stdout).toEqual([]); expect(runner.stderr).toEqual([]);
  expect(runner.deadlineActive()).toBe(true);
  f.client.emit("end");
  await pending;
  expect(result).toBe(0);
  expect(runner.stdout).toEqual(["Admin operator completed.\n"]);
  expect(runner.stderr).toEqual([]); expect(runner.deadlineActive()).toBe(false);
});

test("admin-operator-client late error after pool end stays unhealthy and emits only fixed cleanup failure", async () => {
  for (const source of ["client", "pool"] as const) {
    const f = ownershipFixture(); f.connect();
    const runner = runnerFixture(f.owner);
    const pending = runAdminOperator(["bootstrap"], env, runner.deps);
    await turn();
    f[source].emit("error", new Error("PRIVATE late driver cause"));
    expect(() => f.owner.healthy()).toThrow("Admin operator client unavailable.");
    expect(runner.stdout).toEqual([]); expect(runner.stderr).toEqual([]);
    expect(runner.deadlineActive()).toBe(true);
    f.client.emit("end");
    expect(await pending).toBe(1);
    expect(() => f.owner.healthy()).toThrow("Admin operator client unavailable.");
    expect(runner.stdout).toEqual([]);
    expect(runner.stderr).toEqual(["Admin operator unavailable (cleanup).\n"]);
    expect(runner.deadlineActive()).toBe(false);
  }
});

test("admin-operator-client shutdown rejection cannot clear deadline before reserved termination", async () => {
  for (const failure of ["release", "pool-end"] as const) {
    const f = ownershipFixture(); f.connect();
    if (failure === "release") f.client.release = () => { f.calls.push("release"); throw new Error("PRIVATE release cause"); };
    else f.pool.end = async () => { f.calls.push("pool-end"); throw new Error("PRIVATE pool shutdown cause"); };
    const runner = runnerFixture(f.owner);
    let result: number | undefined;
    const pending = runAdminOperator(["bootstrap"], env, runner.deps).then((code) => { result = code; });
    await turn();
    expect(f.calls).toEqual(["release", "pool-end"]);
    expect(result).toBeUndefined(); expect(runner.deadlineActive()).toBe(true);
    expect(runner.stdout).toEqual([]); expect(runner.stderr).toEqual([]);
    const close = f.owner.close();
    expect(f.owner.close()).toBe(close);
    f.client.emit("end");
    await pending;
    expect(result).toBe(1);
    expect(runner.stdout).toEqual([]);
    expect(runner.stderr).toEqual(["Admin operator unavailable (cleanup).\n"]);
    expect(runner.deadlineActive()).toBe(false);
    await expect(close).rejects.toThrow("Admin operator client unavailable.");
    expect(f.calls).toEqual(["release", "pool-end"]);
    expect(() => f.owner.healthy()).toThrow("Admin operator client unavailable.");
  }
});

test("admin-operator-client end before reservation is remembered and close remains idempotent", async () => {
  const f = ownershipFixture();
  f.pool.emit("connect", f.client);
  f.client.emit("end");
  f.owner.reserve(f.client);
  const close = f.owner.close();
  expect(f.owner.close()).toBe(close);
  await close;
  expect(f.owner.close()).toBe(close);
  expect(f.calls).toEqual(["release", "pool-end"]);
  f.client.emit("error", new Error("PRIVATE error after close"));
  f.pool.emit("error", new Error("PRIVATE pool error after close"));
  expect(() => f.owner.healthy()).toThrow("Admin operator client unavailable.");
});

test("admin-operator-client termination alone cannot finish close before pool shutdown", async () => {
  const f = ownershipFixture(); f.connect();
  let finishPool = () => {};
  f.pool.end = () => { f.calls.push("pool-end"); return new Promise<void>((resolve) => { finishPool = resolve; }); };
  let closed = false;
  const close = f.owner.close();
  const pending = close.then(() => { closed = true; });
  f.client.emit("end");
  await turn();
  expect(closed).toBe(false); expect(f.owner.close()).toBe(close);
  finishPool(); await pending;
  expect(closed).toBe(true); expect(f.calls).toEqual(["release", "pool-end"]);
});

test("admin-operator-client observes synchronous termination during release", async () => {
  const f = ownershipFixture(); f.connect();
  f.client.release = () => { f.calls.push("release"); f.client.emit("end"); };
  await f.owner.close();
  expect(f.calls).toEqual(["release", "pool-end"]);
});

test("admin-operator-client modeled init readback failure waits for cleanup; handshake failure still ends pool", async () => {
  for (const reserved of [true, false]) {
    const f = ownershipFixture();
    const runner = runnerFixture(f.owner);
    // The opener's catch/close composition is also checked in source below. This
    // models failed readback/handshake, not execution of pg.connect or query.
    runner.deps.open = async () => {
      try {
        if (reserved) f.connect();
        throw new Error("PRIVATE initialization cause");
      } catch {
        try { await f.owner.close(); } catch { /* Fixed opener failure remains opaque. */ }
        throw new Error("Admin operator client unavailable.");
      }
    };
    let result: number | undefined;
    const pending = runAdminOperator(["bootstrap"], env, runner.deps).then((code) => { result = code; });
    await turn();
    expect(f.calls).toEqual(reserved ? ["release", "pool-end"] : ["pool-end"]);
    expect(runner.stdout).toEqual([]);
    if (reserved) {
      expect(result).toBeUndefined(); expect(runner.stderr).toEqual([]);
      expect(runner.deadlineActive()).toBe(true);
      f.client.emit("end");
    }
    await pending;
    expect(result).toBe(1);
    expect(runner.stdout).toEqual([]);
    expect(runner.stderr).toEqual(["Admin operator unavailable (connection).\n"]);
    expect(runner.deadlineActive()).toBe(false);
    await f.owner.close();
    expect(f.calls).toEqual(reserved ? ["release", "pool-end"] : ["pool-end"]);
  }
});

test("admin-operator-client pending termination retains the executable hard deadline", async () => {
  const f = ownershipFixture(); f.connect();
  const runner = runnerFixture(f.owner);
  const pending = runAdminOperator(["bootstrap"], env, runner.deps);
  await turn();
  expect(runner.deadlineActive()).toBe(true);
  runner.expire();
  expect(runner.terminations()).toBe(1);
  expect(runner.stdout).toEqual([]);
  expect(runner.stderr).toEqual(["Admin operator unavailable (deadline).\n"]);
  f.client.emit("end");
  expect(await pending).toBe(1);
  expect(runner.stdout).toEqual([]);
  expect(runner.stderr).toEqual(["Admin operator unavailable (deadline).\n"]);
  expect(runner.deadlineActive()).toBe(false);
});

test("admin-operator-client uses only explicit bounded driver fields, never a URL or app fallback", () => {
  expect(adminOperatorPoolOptions({ host: "::1", port: 55432, database: "identity_local", user: "operator", password: "synthetic" })).toEqual({
    host: "::1", port: 55432, database: "identity_local", user: "operator", password: "synthetic",
    ssl: false, sslnegotiation: "postgres", client_encoding: "UTF8", options: "-c search_path=public", application_name: "zetta-identity-admin",
    connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000, lock_timeout: 2000,
    idle_in_transaction_session_timeout: 5000, max: 1, idleTimeoutMillis: 1000, allowExitOnIdle: true,
    keepAlive: true, keepAliveInitialDelayMillis: 1000,
  });
});

test("admin-operator-client source retains owned release/end, error flags and fixed parameterized identity check", async () => {
  // Source evidence only: no Pool factory/connect or actual SQL executes here.
  const source = await Bun.file(new URL("./admin-operator-client.ts", import.meta.url)).text();
  expect(source).toContain('drizzle({ client, relations, logger: false })');
  expect(source).toContain("const { reserve, close, healthy } = createAdminOperatorClientOwner(pool)");
  expect(source.indexOf("createAdminOperatorClientOwner(pool)")).toBeLessThan(source.indexOf("await pool.connect()"));
  expect(source).toContain("reserve(client)");
  expect(source).toContain("try { await close(); } catch");
  expect(source).toContain('"select current_database() = $1 and current_user = $2 and session_user = $2 as matches"');
  expect(source).toContain("[target.database, target.user]");
  expect(source).not.toMatch(/\bas unknown\b|\bas Database\b|process\.env|^\s*connectionString:|console\.|\b(?:TRUNCATE|CREATE|ALTER|DROP|migrate|reset)\b/);
});
