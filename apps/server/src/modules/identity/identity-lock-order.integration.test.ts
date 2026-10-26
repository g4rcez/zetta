import { expect, test } from "bun:test";
import { assertLockOrderEffects } from "./identity-lock-order-case";
import { createLockOrderInput } from "./identity-lock-order.integration";
import { ConnectionStoreError, parseCreate } from "../connections/store-contract";

const target = { ZETTA_TEST_DATABASE_URL: "postgres://zetta_identity_runner:synthetic@127.0.0.1:55432/zetta_identity_test", ZETTA_TEST_DATABASE_ALLOW_MUTATION: "identity-tests" };
for (const [name, environment] of [
  ["missing target", {}], ["missing acknowledgement", { ZETTA_TEST_DATABASE_URL: target.ZETTA_TEST_DATABASE_URL }],
  ["wrong acknowledgement", { ...target, ZETTA_TEST_DATABASE_ALLOW_MUTATION: "yes" }],
  ["ambient application target", { ...target, DATABASE_URL: target.ZETTA_TEST_DATABASE_URL }],
  ["nonloopback target", { ...target, ZETTA_TEST_DATABASE_URL: "postgres://zetta_identity_runner:synthetic@private.invalid:55432/zetta_identity_test" }],
  ["ambient libpq", { ...target, PGHOST: "private.invalid" }], ["auth test mode", { ...target, NODE_ENV: "test" }],
  ["implicit test mode", { ...target, TEST: "true" }], ["telemetry environment", { ...target, BETTER_AUTH_TELEMETRY_ENABLED: "false" }],
] as const) {
  test(`lock-order proof denies ${name} before timers or IO`, async () => {
    // Given a fresh process with no approved disposable target and sticky IO traps.
    const entry = new URL("./identity-lock-order.integration.ts", import.meta.url);
    const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
      import { strict as assert } from "node:assert";
      import net from "node:net";
      import tls from "node:tls";
      import dns from "node:dns";
      import http from "node:http";
      import https from "node:https";
      let forbiddenAttempts = 0;
      const forbidden = () => { forbiddenAttempts++; throw new Error("Unexpected proof IO"); };
      for (const [object, key] of [[net.Socket.prototype, "connect"], [net.Server.prototype, "listen"], [tls, "connect"],
        [dns, "lookup"], [dns, "resolve"], [dns.promises, "lookup"], [dns.promises, "resolve"],
        [http, "request"], [http, "get"], [https, "request"], [https, "get"],
        [Bun, "connect"], [Bun, "listen"], [Bun, "serve"], [globalThis, "fetch"], [globalThis, "setTimeout"]]) {
        assert.equal(Reflect.set(object, key, forbidden), true);
      }
      const module = await import(${JSON.stringify(entry.href)});
      assert.equal(forbiddenAttempts, 0);
      assert.equal(process.exitCode, undefined);
      await module.runIdentityLockOrderProof();
      assert.equal(forbiddenAttempts, 0);
    `], { env: environment, stdout: "pipe", stderr: "pipe", timeout: 5000 });
    // When importing and then explicitly invoking the opt-in entry.
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    // Then target denial is fixed and nothing reaches a timer, service or network.
    expect({ exit, stdout, stderr }).toEqual({ exit: 1, stdout: "", stderr: "Identity lock-order proof failed at target validation; details suppressed.\n" });
  });
}

const before = { admin: "lock-a", members: "unchanged", audits: 3, connections: 2, credentials: 2, receipts: 2,
  nonces: 3, encryptions: 3, sessions_a: ["a"], sessions_b: ["b"], sessions_c: ["c"] };
const created = { ...before, connections: 3, credentials: 3, receipts: 3, nonces: 4, encryptions: 4 };
const replaced = { ...before, admin: "lock-b", audits: 4, sessions_a: [], sessions_b: [] };

test("actual connection parser rejects deterministic malformed UTF-8 fixture bytes", () => {
  const input = createLockOrderInput();
  const malformed = Buffer.alloc(32, 255);
  try {
    expect(() => parseCreate({ ...input, secret: malformed })).toThrow(ConnectionStoreError);
  } finally { input.secret.fill(0); malformed.fill(0); }
});

test("generated lock-order credentials pass the actual parser and remain wipeable", () => {
  for (let index = 0; index < 8; index++) {
    const input = createLockOrderInput();
    let parsed: ReturnType<typeof parseCreate> | undefined;
    try {
      parsed = parseCreate(input);
      expect(parsed.secret.equals(input.secret)).toBe(true);
      expect(parsed.secret).not.toBe(input.secret);
    } finally { parsed?.secret.fill(0); input.secret.fill(0); }
    expect(input.secret.every(byte => byte === 0)).toBe(true);
    expect(parsed.secret.every(byte => byte === 0)).toBe(true);
  }
});

test("C1 state oracle accepts each coherent winner", () => {
  // Given synthetic committed-state shapes, not a database race.
  // When checking the two possible deadlock winners.
  // Then each exact effect and the other transaction's rollback are accepted.
  expect(() => assertLockOrderEffects(before, created, { created: true, admin: null })).not.toThrow();
  expect(() => assertLockOrderEffects(before, replaced, { created: false, admin: "lock-b" })).not.toThrow();
});

test("C1 state oracle rejects partial effects and cross-owner session damage", () => {
  // Given one coherent create winner.
  for (const mutation of [{ connections: 2 }, { credentials: 2 }, { receipts: 2 }, { nonces: 3 }, { encryptions: 3 },
    { admin: "lock-b" }, { audits: 4 }, { members: "changed" }, { sessions_a: [] }, { sessions_b: [] }, { sessions_c: [] }]) {
    // When one committed fact disagrees with the winner.
    // Then the oracle fails, including loss of the unrelated user's session.
    expect(() => assertLockOrderEffects(before, { ...created, ...mutation }, { created: true, admin: null })).toThrow();
  }
  expect(() => assertLockOrderEffects(before, { ...replaced, nonces: 4 }, { created: false, admin: "lock-b" })).toThrow();
  expect(() => assertLockOrderEffects(before, { ...replaced, sessions_b: ["b"] }, { created: false, admin: "lock-b" })).toThrow();
});
