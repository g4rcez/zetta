import { expect, test } from "bun:test";

async function guarded(invoke: boolean, env: Record<string, string> = {}, injectAttempt = false) {
  const entry = new URL("./credential-operator.integration.ts", import.meta.url);
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import net from 'node:net'; import tls from 'node:tls'; import dns from 'node:dns';
    let attempted = false;
    const deny = () => { attempted = true; throw new Error('Unexpected IO'); };
    net.Socket.prototype.connect = deny; net.Server.prototype.listen = deny;
    tls.connect = deny; dns.lookup = deny; dns.promises.lookup = deny;
    Bun.connect = deny; Bun.listen = deny; Bun.serve = deny; Bun.spawn = deny;
    globalThis.fetch = deny; globalThis.setTimeout = deny; globalThis.setInterval = deny;
    const module = await import(${JSON.stringify(entry.href)});
    if (${injectAttempt}) { try { deny(); } catch {} }
    if (${invoke}) await module.runCredentialOperatorProof();
    if (attempted) { process.stderr.write('FORBIDDEN_IO_ATTEMPTED\\n'); process.exitCode = 97; }
  `], { env, stdout: "pipe", stderr: "pipe", timeout: 5000 });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { exit, stdout, stderr };
}

test("credential CLI proof import starts no IO or timer", async () => {
  expect(await guarded(false)).toEqual({ exit: 0, stdout: "", stderr: "" });
});
test("credential CLI proof missing target denies before spawn or IO", async () => {
  expect(await guarded(true)).toEqual({ exit: 1, stdout: "", stderr: "Credential operator proof failed at target validation; details suppressed.\n" });
});
test("credential CLI proof rejects test mode before spawn even with shaped target", async () => {
  expect(await guarded(true, {
    NODE_ENV: "test", ZETTA_TEST_DATABASE_ALLOW_MUTATION: "identity-tests",
    ZETTA_TEST_DATABASE_URL: "postgresql://zetta_identity_runner:synthetic@127.0.0.1:55432/zetta_identity_test",
  })).toEqual({ exit: 1, stdout: "", stderr: "Credential operator proof failed at target validation; details suppressed.\n" });
});
test("pretarget guard records swallowed IO attempts as failures", async () => {
  expect(await guarded(false, {}, true)).toEqual({ exit: 97, stdout: "", stderr: "FORBIDDEN_IO_ATTEMPTED\n" });
});
