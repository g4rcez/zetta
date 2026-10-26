import { expect, test } from "bun:test";

async function guarded(invoke: boolean, env: Record<string, string> = {}, injectAttempt = false) {
  const entry = new URL("./credential-provisioning.integration.ts", import.meta.url);
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import net from "node:net";
    import tls from "node:tls";
    import dns from "node:dns";
    let attempted = false;
    const forbidden = () => { attempted = true; throw new Error("Unexpected runtime IO"); };
    net.Socket.prototype.connect = forbidden;
    net.Server.prototype.listen = forbidden;
    tls.connect = forbidden;
    dns.lookup = forbidden;
    dns.promises.lookup = forbidden;
    Bun.connect = forbidden;
    Bun.listen = forbidden;
    Bun.serve = forbidden;
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    globalThis.setInterval = forbidden;
    const entry = await import(${JSON.stringify(entry.href)});
    if (${injectAttempt}) { try { forbidden(); } catch {} }
    if (${invoke}) await entry.runCredentialProvisioningProof();
    if (attempted) { process.stderr.write("FORBIDDEN_IO_ATTEMPTED\\n"); process.exitCode = 97; }
  `], { env, stdout: "pipe", stderr: "pipe", timeout: 5000 });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { exit, stdout, stderr };
}

test("credential proof import is inert", async () => {
  expect(await guarded(false)).toEqual({ exit: 0, stdout: "", stderr: "" });
});

test("credential proof missing target denies before any attempted timers or network", async () => {
  expect(await guarded(true)).toEqual({ exit: 1, stdout: "", stderr: "Credential proof failed at target validation; details suppressed.\n" });
});

test("credential proof test mode denies even with a shaped dedicated target", async () => {
  expect(await guarded(true, {
    NODE_ENV: "test", ZETTA_TEST_DATABASE_ALLOW_MUTATION: "identity-tests",
    ZETTA_TEST_DATABASE_URL: "postgresql://zetta_identity_runner:synthetic@127.0.0.1:55432/zetta_identity_test",
  })).toEqual({ exit: 1, stdout: "", stderr: "Credential proof failed at target validation; details suppressed.\n" });
});

test("offline guard detects attempted IO even when its exception was swallowed", async () => {
  expect(await guarded(false, {}, true)).toEqual({ exit: 97, stdout: "", stderr: "FORBIDDEN_IO_ATTEMPTED\n" });
});
