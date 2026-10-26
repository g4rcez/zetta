import { expect, test } from "bun:test";




const target = { ZETTA_TEST_DATABASE_URL: "postgres://zetta_identity_runner:synthetic@127.0.0.1:55432/zetta_identity_test", ZETTA_TEST_DATABASE_ALLOW_MUTATION: "identity-tests" };
for (const [name, environment] of [
  ["missing target", {}], ["missing acknowledgement", { ZETTA_TEST_DATABASE_URL: target.ZETTA_TEST_DATABASE_URL }],
  ["wrong acknowledgement", { ...target, ZETTA_TEST_DATABASE_ALLOW_MUTATION: "yes" }],
  ["ambient application target", { ...target, DATABASE_URL: target.ZETTA_TEST_DATABASE_URL }],
  ["nonloopback target", { ...target, ZETTA_TEST_DATABASE_URL: "postgres://zetta_identity_runner:synthetic@private.invalid:55432/zetta_identity_test" }],
  ["ambient libpq", { ...target, PGHOST: "private.invalid" }], ["auth test mode", { ...target, NODE_ENV: "test" }],
  ["implicit test mode", { ...target, TEST: "true" }], ["telemetry environment", { ...target, BETTER_AUTH_TELEMETRY_ENABLED: "false" }],
] as const) {
  test(`membership role proof denies ${name} before timers or IO`, async () => {
    // Given a fresh process with no approved disposable target and sticky IO traps.
    const entry = new URL("./membership-role.integration.ts", import.meta.url);
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
      await module.runMembershipRoleProof();
      assert.equal(forbiddenAttempts, 0);
    `], { env: environment, stdout: "pipe", stderr: "pipe", timeout: 5000 });
    // When importing and then explicitly invoking the opt-in entry.
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    // Then target denial is fixed and nothing reaches a timer, service or network.
    expect({ exit, stdout, stderr }).toEqual({ exit: 1, stdout: "", stderr: "Membership role proof failed at target validation; details suppressed.\n" });
  });
}
import { assertRoleFacts, assertColumnPrivileges } from "../../../../../packages/db/src/membership-role-proof-client";
import { assertPermissionError } from "./membership-role-cases";
import { getTableConfig, type PgTable } from "../../../../../packages/db/node_modules/drizzle-orm/pg-core/index.js";
import * as auth from "../../../../../packages/db/src/schema/auth";
import * as identity from "../../../../../packages/db/src/schema/identity";
import * as connections from "../../../../../packages/db/src/schema/connections";
import * as runs from "../../../../../packages/db/src/schema/runs";
test("closed effective role facts deny every unsafe flag and malformed catalog shape", () => {
  const valid = { identity: true, attributes: true, memberships: true, ownership: true, database: true, schemas: true, tables: true, functions: true, parameters: true };
  expect(() => assertRoleFacts(valid)).not.toThrow();
  for (const key of Object.keys(valid)) {
    for (const value of [false, null, "true", undefined]) expect(() => assertRoleFacts({ ...valid, [key]: value })).toThrow();
  }
  for (const value of [null, [], {}, { ...valid, extra: true }]) expect(() => assertRoleFacts(value)).toThrow();
});
test("effective column oracle rejects privilege expansion, missing grants, duplicates and missing tables", () => {
  const rows = [auth.user, auth.session, auth.account, auth.verification, ...Object.values(identity), ...Object.values(connections), ...Object.values(runs)].flatMap(table => {
    const config = getTableConfig(table as PgTable);
    return config.columns.map(column => {
      const key = `${config.name}.${column.name}`;
      return { table_name: config.name, column_name: column.name,
        readable: ["membership", "installation_identity", "invitation", "runs", "run_attempts"].includes(config.name) || ["user.id", "user.email"].includes(key),
        insertable: ["membership", "identity_audit", "runs", "run_attempts"].includes(config.name),
        writable: ["user.updated_at", "membership.activation_revision", "membership.status", "membership.removed_at", "membership.updated_at", "installation_identity.id", "invitation.consumed_at", "invitation.consumed_by_user_id", "runs.revision", "run_attempts.status"].includes(key),
        referenceable: false, grantable: false };
    });
  });
  expect(() => assertColumnPrivileges(rows)).not.toThrow();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    for (const key of ["readable", "insertable", "writable", "referenceable", "grantable"] as const) {
      const changed = [...rows]; changed[index] = { ...row, [key]: !row[key] };
      expect(() => assertColumnPrivileges(changed)).toThrow();
    }
  }
  expect(() => assertColumnPrivileges([])).toThrow();
  expect(() => assertColumnPrivileges([...rows, { ...rows[0]!, table_name: "unexpected" }])).toThrow();
  expect(() => assertColumnPrivileges([...rows, rows[0]!])).toThrow();
  for (const table of new Set(rows.map(row => row.table_name))) expect(() => assertColumnPrivileges(rows.filter(row => row.table_name !== table))).toThrow();
});
test("permission and retaining FK oracles require exact SQLSTATE and constraint", () => {
  expect(() => assertPermissionError({ code: "42501" }, "42501")).not.toThrow();
  expect(() => assertPermissionError({ code: "23001", constraint: "runs_owner_user_id_membership_user_id_fkey" }, "23001", "runs_owner_user_id_membership_user_id_fkey")).not.toThrow();
  for (const error of [null, {}, { code: "23503" }, { code: "40P01" }, { code: "57014" }]) expect(() => assertPermissionError(error, "42501")).toThrow();
  expect(() => assertPermissionError({ code: "23001", constraint: "wrong" }, "23001", "runs_owner_user_id_membership_user_id_fkey")).toThrow();
});
test("helper import is inert and closed target or entry arguments reject before any timer or IO", async () => {
  const entry = new URL("./membership-role.integration.ts", import.meta.url);
  const helper = new URL("../../../../../packages/db/src/membership-role-proof-client.ts", import.meta.url);
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import { strict as assert } from "node:assert"; import net from "node:net";
    let attempts=0; const deny=()=>{attempts++;throw Error("forbidden");};
    globalThis.setTimeout=deny; net.Socket.prototype.connect=deny;
    const helper=await import(${JSON.stringify(helper.href)});
    await assert.rejects(helper.openMembershipRoleProof("postgresql://bad:bad@127.0.0.1:55432/zetta_identity_test"));
    const entry=await import(${JSON.stringify(entry.href)});
    await entry.runMembershipRoleProof(["unexpected"]);
    assert.equal(attempts,0);
  `], { env: target, stdout: "pipe", stderr: "pipe", timeout: 5000 });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ exit, stdout, stderr }).toEqual({ exit: 1, stdout: "", stderr: "Membership role proof failed at target validation; details suppressed.\n" });
});
