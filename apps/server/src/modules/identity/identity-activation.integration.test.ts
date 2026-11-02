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
  test(`activation proof denies ${name} before timers or IO`, async () => {
    // Given a fresh process with no approved disposable target and sticky IO traps.
    const entry = new URL("./identity-activation.integration.ts", import.meta.url);
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
      await module.runIdentityActivationProof(["backfill"]);
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
      stderr: "Identity activation proof failed at target validation; details suppressed.\n",
    });
  });
}
import { activationSelector } from "./identity-activation.integration";
import { exactConstraint } from "./identity-activation-cases";
import { completedMembershipLock } from "./identity-activation-races";
test("closed selectors and exact named SQL oracle reject unrelated failures", () => {
  expect(activationSelector(["backfill"])).toBe("backfill");
  expect(activationSelector(["exhaustion"])).toBe("exhaustion");
  for (const args of [[], ["other"], ["backfill", "extra"], [" exhaustion"]])
    expect(() => activationSelector(args)).toThrow();
  expect(() =>
    exactConstraint(
      { code: "23514", constraint: "membership_activation_transition" },
      "membership_activation_transition",
    ),
  ).not.toThrow();
  for (const error of [
    null,
    {},
    { code: "23503", constraint: "membership_activation_transition" },
    { code: "23514", constraint: "other" },
  ])
    expect(() => exactConstraint(error, "membership_activation_transition")).toThrow();
  expect(
    completedMembershipLock('select status from "zetta"."membership" where user_id=$1 for update', [
      "activation-join",
    ]),
  ).toBe(true);
  for (const text of [
    'select status from "zetta"."membership"',
    'select id from "zetta"."user" for update',
    'update "zetta"."membership" set status=$1',
  ])
    expect(completedMembershipLock(text, ["activation-join"])).toBe(false);
  expect(
    completedMembershipLock('select status from "zetta"."membership" for update', ["other"]),
  ).toBe(false);
});
test("malformed invocation denies before timers or network even with a valid target", async () => {
  const entry = new URL("./identity-activation.integration.ts", import.meta.url);
  for (const args of [[], ["other"], ["backfill", "extra"]]) {
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--eval",
        `
      import { strict as assert } from "node:assert";
      import net from "node:net";
      let attempts=0;
      const deny=()=>{attempts++;throw Error("forbidden");};
      globalThis.setTimeout=deny; net.Socket.prototype.connect=deny;
      const module=await import(${JSON.stringify(entry.href)});
      assert.equal(attempts,0);
      await module.runIdentityActivationProof(${JSON.stringify(args)});
      assert.equal(attempts,0);
    `,
      ],
      { env: target, stdout: "pipe", stderr: "pipe", timeout: 5000 },
    );
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exit, stdout, stderr }).toEqual({
      exit: 1,
      stdout: "",
      stderr: "Identity activation proof failed at selector validation; details suppressed.\n",
    });
  }
});
