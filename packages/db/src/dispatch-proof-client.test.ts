import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

test("dispatch SQL executable import is inert under denied network and timers", async () => {
  const file = new URL("../../../apps/server/src/modules/runtime/dispatch-schema.integration.ts", import.meta.url).pathname;
  const script = `import net from 'node:net'; import tls from 'node:tls';
    const deny=()=>{throw new Error('unexpected IO')};
    net.Socket.prototype.connect=deny; tls.connect=deny; Bun.connect=deny; Bun.serve=deny;
    globalThis.fetch=deny; globalThis.setTimeout=deny; globalThis.setInterval=deny;
    const m=await import(${JSON.stringify(file)}); if(typeof m.runDispatchSchemaProof!=='function') throw new Error('export');
    console.log('inert PASS');`;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], { env: {}, stdout: "pipe", stderr: "pipe" });
  expect(await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])).toEqual([0, "inert PASS\n", ""]);
});

test("proof adapter pins all four accepted migration files and exact18-table boundary", async () => {
  const source = await Bun.file(new URL("./dispatch-proof-client.ts", import.meta.url)).text();
  const folder = new URL("../dispatch-test-migrations/", import.meta.url).pathname;
  const files = await Array.fromAsync(new Bun.Glob("*/*").scan({ cwd: folder, absolute: true }));
  expect(files).toHaveLength(4);
  for (const file of files) expect(source).toContain(createHash("sha256").update(await Bun.file(file).bytes()).digest("hex"));
  for (const table of ["dispatch_capacity", "dispatch_claims", "dispatch_grants", "runs", "run_attempts"]) expect(source).toContain(`"${table}"`);
  expect(source).toContain("openRunProof(connectionString)");
  expect(source).not.toMatch(/new Pool|cleanupFixtures|truncate|delete from/i);
});

test("constraint oracle requires exact SQLSTATE and named constraint", async () => {
  const { matchesDispatchFailure } = await import("../../../apps/server/src/modules/runtime/dispatch-schema.integration");
  const expected = Object.assign(new Error("synthetic suppressed"), { code: "23514", constraint: "dispatch_claims_initial" });
  expect(matchesDispatchFailure(expected, "23514", "dispatch_claims_initial")).toBe(true);
  expect(matchesDispatchFailure(expected, "23503", "dispatch_claims_initial")).toBe(false);
  expect(matchesDispatchFailure(expected, "23514", "dispatch_grants_initial")).toBe(false);
  expect(matchesDispatchFailure(new Error("synthetic"), "23514", "dispatch_claims_initial")).toBe(false);
});

test("executable denies missing dedicated target before setup", async () => {
  const file = new URL("../../../apps/server/src/modules/runtime/dispatch-schema.integration.ts", import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, "--no-env-file", file], { env: {}, stdout: "pipe", stderr: "pipe" });
  expect(await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]))
    .toEqual([1, "", "Dispatch schema proof failed at target validation; details suppressed.\n"]);
});
