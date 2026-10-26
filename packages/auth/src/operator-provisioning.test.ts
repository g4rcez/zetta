import { describe, expect, test } from "bun:test";
import {
  provisionOperatorCredentials,
  type OperatorProvisioningDependencies,
  type OperatorProvisioningReadback,
} from "./operator-provisioning";

const input = { name: "Synthetic Operator", email: "NEW@example.test", password: "synthetic-password" };
const user = { id: "new-user", email: "new@example.test" };
const account = { userId: user.id, accountId: user.id, providerId: "credential", passwordPresent: true };
const good = { users: [user], accounts: [account], sessionPresent: false };
function fixture(readback: OperatorProvisioningReadback = good) {
  const calls: { signup: unknown[]; readback: unknown[] } = { signup: [], readback: [] };
  const dependencies: OperatorProvisioningDependencies = {
    async signUpEmail(request) { calls.signup.push(request); return { user, token: null }; },
    async readback(id, email) { calls.readback.push({ id, email }); return readback; },
  };
  return { calls, dependencies };
}

describe("trusted operator credential provisioning", () => {
  test("returns only verified new ID and passes only the bounded signup body", async () => {
    const { calls, dependencies } = fixture();
    expect(await provisionOperatorCredentials(input, dependencies)).toEqual({ ok: true, userId: user.id });
    expect(calls).toEqual({ signup: [{ body: input }], readback: [{ id: user.id, email: user.email }] });
  });

  for (const [label, value] of Object.entries({
    missing: {}, null: null, array: [], invalidEmail: { ...input, email: "bad" },
    longEmail: { ...input, email: `${"a".repeat(250)}@example.test` },
    emptyName: { ...input, name: "  " }, longName: { ...input, name: "x".repeat(201) },
    shortPassword: { ...input, password: "1234567" }, longPassword: { ...input, password: "x".repeat(129) },
    role: { ...input, role: "admin" }, membership: { ...input, teamId: "team" },
    id: { ...input, id: "existing" }, callback: { ...input, callbackURL: "/" },
    invitation: { ...input, invitationToken: "secret" }, image: { ...input, image: "https://example.test/x" },
  })) {
    test(`rejects ${label} before any signup or database call`, async () => {
      const { calls, dependencies } = fixture();
      expect(await provisionOperatorCredentials(value, dependencies)).toEqual({ ok: false, code: "invalid_input" });
      expect(calls).toEqual({ signup: [], readback: [] });
    });
  }

  test("accepts exact name and password limits", async () => {
    for (const password of ["x".repeat(8), "x".repeat(128)]) {
      const { dependencies } = fixture();
      expect(await provisionOperatorCredentials({ ...input, name: "x".repeat(200), password }, dependencies))
        .toEqual({ ok: true, userId: user.id });
    }
  });

  const cases: Record<string, OperatorProvisioningReadback> = {
    "synthetic duplicate signup without returned ID persisted": { ...good, users: [] },
    "existing email with a different ID": { ...good, users: [{ ...user, id: "existing-user" }] },
    "wrong persisted email": { ...good, users: [{ ...user, email: "other@example.test" }] },
    "multiple users": { ...good, users: [user, user] },
    "missing credential": { ...good, accounts: [] },
    "multiple credentials": { ...good, accounts: [account, account] },
    "wrong credential owner": { ...good, accounts: [{ ...account, userId: "other" }] },
    "wrong credential account ID": { ...good, accounts: [{ ...account, accountId: "other" }] },
    "wrong provider": { ...good, accounts: [{ ...account, providerId: "oauth" }] },
    "missing password": { ...good, accounts: [{ ...account, passwordPresent: false }] },
    "unexpected stored session": { ...good, sessionPresent: true },
  };
  for (const [label, readback] of Object.entries(cases)) {
    test(`denies ${label} without retry or alternate lookup`, async () => {
      const { calls, dependencies } = fixture(readback);
      expect(await provisionOperatorCredentials(input, dependencies)).toEqual({ ok: false, code: "provisioning_failed" });
      expect(calls.signup).toHaveLength(1);
      expect(calls.readback).toEqual([{ id: user.id, email: user.email }]);
    });
  }

  for (const response of [
    { user, token: "unexpected-secret-token" },
    { user: { ...user, id: "" }, token: null },
    { user: { ...user, email: "wrong@example.test" }, token: null },
  ]) {
    test("denies invalid signup result before persistence readback", async () => {
      const { calls, dependencies } = fixture();
      expect(await provisionOperatorCredentials(input, { ...dependencies, async signUpEmail() { return response; } }))
        .toEqual({ ok: false, code: "provisioning_failed" });
      expect(calls.readback).toEqual([]);
    });
  }

  for (const stage of ["signUpEmail", "readback"] as const) {
    test(`hides ${stage} rejection and attempts only once`, async () => {
      const { dependencies } = fixture();
      let failures = 0;
      const result = await provisionOperatorCredentials(input, {
        ...dependencies,
        [stage]: async () => { failures++; throw new Error("sensitive password/email/SQL detail"); },
      });
      expect(result).toEqual({ ok: false, code: "provisioning_failed" });
      expect(failures).toBe(1);
    });
  }
});

test("import, construction and rejected input are inert in a fresh guarded process", async () => {
  const entry = new URL("./operator-provisioning.ts", import.meta.url);
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import net from "node:net";
    import tls from "node:tls";
    const forbidden = () => { throw new Error("Unexpected runtime IO"); };
    net.Socket.prototype.connect = forbidden;
    tls.connect = forbidden;
    Bun.connect = forbidden;
    Bun.serve = forbidden;
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    globalThis.setInterval = forbidden;
    const entry = await import(${JSON.stringify(entry.href)});
    const provision = entry.createOperatorCredentialProvisioner(
      { BETTER_AUTH_URL: "https://example.test", BETTER_AUTH_SECRET: "synthetic-secret-for-inert-check-only" },
      new Proxy({}, { get: forbidden }),
    );
    const result = await provision({ role: "admin" });
    if (JSON.stringify(result) !== JSON.stringify({ ok: false, code: "invalid_input" })) process.exit(1);
  `], { env: { NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe", timeout: 5000 });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: "", stderr: "" });
});
