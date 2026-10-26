import { expect, test } from "bun:test";
import { requireIdentityAuthProofTarget } from "./signup.integration";
import type { runIdentityAuthProof } from "./signup.integration";

const fixture = {
  ZETTA_TEST_DATABASE_ALLOW_MUTATION: "identity-tests",
  ZETTA_TEST_DATABASE_URL: "postgresql://zetta_identity_runner:synthetic@127.0.0.1:55432/zetta_identity_test",
};
// Compile-only: never call the live runner from this test process.
const runnerSignature: typeof runIdentityAuthProof = async () => {};
void runnerSignature;

test("signup.integration rejects installed test-mode origin bypass before runtime imports", () => {
  for (const env of [{}, { ...fixture, NODE_ENV: "test" }, { ...fixture, TEST: "1" },
    { ...fixture, TEST: "true" }, { ...fixture, TEST: "0" },
    ...["BETTER_AUTH_TELEMETRY", "BETTER_AUTH_TELEMETRY_DEBUG", "BETTER_AUTH_TELEMETRY_ENDPOINT", "BETTER_AUTH_TELEMETRY_UNKNOWN"]
      .flatMap((key) => ["", "false", "1"].map((value) => ({ ...fixture, [key]: value })))]) {
    expect(() => requireIdentityAuthProofTarget(env)).toThrow("Identity auth proof target or environment unavailable.");
  }
  for (const env of [fixture, { ...fixture, NODE_ENV: "development" }, { ...fixture, TEST: "false" }, { ...fixture, TEST: "" }]) {
    expect(requireIdentityAuthProofTarget(env).connectionString === fixture.ZETTA_TEST_DATABASE_URL).toBe(true);
  }
});

test("signup.integration is inert on import; missing target denies before IO or auth initialization", async () => {
  const entry = new URL("./signup.integration.ts", import.meta.url).href;
  const script = `
    import net from "node:net";
    import tls from "node:tls";
    import dns from "node:dns";
    import http from "node:http";
    import https from "node:https";
    const forbidden = () => { throw new Error("Unexpected IO or startup"); };
    net.Socket.prototype.connect = forbidden;
    net.Server.prototype.listen = forbidden;
    tls.connect = forbidden;
    dns.lookup = forbidden;
    dns.resolve = forbidden;
    dns.promises.lookup = forbidden;
    dns.promises.resolve = forbidden;
    http.request = forbidden;
    http.get = forbidden;
    https.request = forbidden;
    https.get = forbidden;
    Bun.connect = forbidden;
    Bun.listen = forbidden;
    Bun.serve = forbidden;
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    globalThis.setInterval = forbidden;
    const entry = await import(${JSON.stringify(entry)});
    if (process.exitCode) throw new Error("Import was not inert");
    await entry.runIdentityAuthProof();
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
    env: { NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([child.exited,
    new Response(child.stdout).text(), new Response(child.stderr).text()]);
  // Boolean assertions never dump subprocess diagnostics.
  expect(code === 1 && out === "" && err === "Identity auth proof failed at target validation; details suppressed.\n").toBe(true);
});

test("signup.integration preserves guarded import order, supported config and installed 1.7.7 contracts", async () => {
  const source = await Bun.file(new URL("./signup.integration.ts", import.meta.url)).text();
  const guard = source.indexOf("requireIdentityAuthProofTarget(process.env)");
  const open = source.indexOf("proof = await openIdentityProof(target.connectionString)");
  expect(guard).toBeGreaterThan(0);
  expect(guard).toBeLessThan(source.indexOf("await import("));
  expect(open).toBeLessThan(source.indexOf('await import("@zetta/auth")'));
  expect(open).toBeLessThan(source.indexOf('await import("better-auth")'));
  expect(source).toContain("if (import.meta.main) await runIdentityAuthProof();");
  expect(source).toContain("90000");
  expect(source).toContain("await proof.cleanupFixtures()");
  expect(source).toContain("await proof?.close()");
  expect(source).toContain("logger: { disabled: true }");
  expect(source).toContain("telemetry: { enabled: false, debug: false }");
  for (const forbidden of ["disableCSRFCheck:", "disableOriginCheck:", "autoSignIn:", "additionalFields:",
    "services", "varlock", "axiom", "createAuth("]) expect(source).not.toContain(forbidden);
  expect(source).toContain("assert.equal(diagnosticAttempted, false)");
  expect(source).toContain("console.error = originalError");
  const base = new URL("./", import.meta.resolve("better-auth"));
  expect((await Bun.file(new URL("../package.json", base)).json()).version).toBe("1.7.7");
  expect(await Bun.file(new URL("context/create-context.mjs", base)).text()).toContain(
    'skipOriginCheck: options.advanced?.disableOriginCheck !== void 0 ? options.advanced.disableOriginCheck : isTest() ? true : false');
  expect(await Bun.file(new URL("api/routes/sign-up.mjs", base)).text()).toContain(
    'if (!createdUser) throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.FAILED_TO_CREATE_USER)');
});
