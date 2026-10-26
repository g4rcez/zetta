import { expect, test } from "bun:test";

test("operator proof import is inert and missing target fails before timers or network", async () => {
  const entry = new URL("./admin-operator.integration.ts", import.meta.url);
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import { strict as assert } from "node:assert";
    import net from "node:net";
    import tls from "node:tls";
    let forbiddenAttempts = 0;
    const forbidden = () => { forbiddenAttempts++; throw new Error("Unexpected runtime IO"); };
    net.Socket.prototype.connect = forbidden;
    tls.connect = forbidden;
    Bun.connect = forbidden;
    Bun.serve = forbidden;
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    const entry = await import(${JSON.stringify(entry.href)});
    assert.equal(forbiddenAttempts, 0);
    if (process.exitCode) throw new Error("Import started the proof");
    await entry.runIdentityOperatorProof();
    assert.equal(forbiddenAttempts, 0);
  `], { env: {}, stdout: "pipe", stderr: "pipe", timeout: 5000 });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect({ exit, stdout, stderr }).toEqual({
    exit: 1, stdout: "", stderr: "Identity operator proof failed at target validation; details suppressed.\n",
  });
});
