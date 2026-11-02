import { expect, test } from "bun:test";

const target = {
  ZETTA_TEST_DATABASE_URL:
    "postgres://zetta_identity_runner:synthetic@127.0.0.1:55432/zetta_identity_test",
  ZETTA_TEST_DATABASE_ALLOW_MUTATION: "identity-tests",
};
for (const [name, environment] of [
  ["missing target", {}],
  ["missing acknowledgement", { ZETTA_TEST_DATABASE_URL: target.ZETTA_TEST_DATABASE_URL }],
  ["wrong acknowledgement", { ...target, ZETTA_TEST_DATABASE_ALLOW_MUTATION: "yes" }],
  ["ambient application target", { ...target, DATABASE_URL: target.ZETTA_TEST_DATABASE_URL }],
  [
    "nonloopback target",
    {
      ...target,
      ZETTA_TEST_DATABASE_URL:
        "postgres://zetta_identity_runner:synthetic@private.invalid:55432/zetta_identity_test",
    },
  ],
  ["ambient libpq", { ...target, PGHOST: "private.invalid" }],
  ["auth test mode", { ...target, NODE_ENV: "test" }],
  ["implicit test mode", { ...target, TEST: "true" }],
  ["telemetry environment", { ...target, BETTER_AUTH_TELEMETRY_ENABLED: "false" }],
] as const) {
  test(`lock-order proof denies ${name} before timers or IO`, async () => {
    // Given a fresh process with no approved disposable target and sticky IO traps.
    const entry = new URL("./identity-lock-positive.integration.ts", import.meta.url);
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--eval",
        `
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
      await module.runIdentityLockPositiveProof();
      assert.equal(forbiddenAttempts, 0);
    `,
      ],
      { env: environment, stdout: "pipe", stderr: "pipe", timeout: 5000 },
    );
    // When importing and then explicitly invoking the opt-in entry.
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    // Then target denial is fixed and nothing reaches a timer, service or network.
    expect({ exit, stdout, stderr }).toEqual({
      exit: 1,
      stdout: "",
      stderr: "Identity positive lock proof failed at target validation; details suppressed.\n",
    });
  });
}
import { queryStage } from "./identity-lock-positive-cases";
import { assertLockOrderEffects } from "./identity-lock-order-case";
test("stage classifier distinguishes actual account/member completion without treating other queries as locks", () => {
  expect(queryStage('select id from "zetta"."user" where id=$1 for key share', ["lock-a"])).toBe(
    "account-lock-a",
  );
  expect(queryStage('select id from "zetta"."user" where id=$1 for update', ["lock-b"])).toBe(
    "account-lock-b",
  );
  expect(
    queryStage('select user_id from "zetta"."membership" where user_id=$1 for update', ["lock-a"]),
  ).toBe("member-lock-a");
  for (const sql of [
    'select id from "zetta"."user"',
    'select user_id from "zetta"."membership"',
    'update "zetta"."user" set name=$1',
  ])
    expect(queryStage(sql, ["lock-a"])).toBe("other");
  expect(queryStage('select id from "zetta"."user" where id=$1 for update', ["lock-c"])).toBe(
    "other",
  );
});
test("combined-success oracle rejects partial commits and unrelated session damage (synthetic shapes only)", () => {
  const before = {
    admin: "lock-b",
    members: "same",
    audits: 1,
    connections: 0,
    credentials: 0,
    receipts: 0,
    nonces: 1,
    encryptions: 1,
    sessions_a: ["a"],
    sessions_b: ["b"],
    sessions_c: ["c"],
  };
  const after = {
    ...before,
    admin: "lock-a",
    audits: 2,
    connections: 1,
    credentials: 1,
    receipts: 1,
    nonces: 2,
    encryptions: 2,
    sessions_a: [],
    sessions_b: [],
  };
  expect(() =>
    assertLockOrderEffects(before, after, { created: true, admin: "lock-a" }),
  ).not.toThrow();
  for (const change of [
    { connections: 0 },
    { credentials: 0 },
    { receipts: 0 },
    { nonces: 1 },
    { encryptions: 1 },
    { audits: 1 },
    { admin: "lock-b" },
    { members: "changed" },
    { sessions_a: ["a"] },
    { sessions_b: ["b"] },
    { sessions_c: [] },
  ])
    expect(() =>
      assertLockOrderEffects(before, { ...after, ...change }, { created: true, admin: "lock-a" }),
    ).toThrow();
});
