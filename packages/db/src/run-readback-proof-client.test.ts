import { expect, test } from "bun:test";
import { openRunReadbackProof, forbidRunProofIO } from "./run-readback-proof-client";

test("readback helper rejects non-dedicated targets before any connection", async () => {
  const url = `postgresql://zetta_identity_runner:${"a".repeat(64)}@127.0.0.1:55432/zetta_identity_test`;
  for (const target of [url.replace("127.0.0.1", "localhost"), url.replace("55432", "5432"), url + "?sslmode=require", url.replace("zetta_identity_test", "application")]) {
    await expect(openRunReadbackProof(target, 1, "read")).rejects.toThrow("Run readback proof unavailable.");
  }
  await expect(openRunReadbackProof(url, 0, "read")).rejects.toThrow("Run readback proof unavailable.");
});
test("new IO guard records a swallowed forbidden attempt and restores the original surface", async () => {
  const before = globalThis.fetch, guard = await forbidRunProofIO();
  try {
    guard.healthy();
    expect(() => globalThis.fetch("https://synthetic.invalid")).toThrow("Unintended proof IO.");
    expect(() => guard.healthy()).toThrow("Run readback proof unavailable.");
  } finally { guard.restore(); }
  expect(globalThis.fetch).toBe(before);
});
test("reconnect verifies activation only after parent and table identity, before returning DB", async () => {
  const source = await Bun.file(new URL("./run-readback-proof-client.ts", import.meta.url)).text();
  const verify = source.indexOf("await verifyIdentityActivation(client)");
  expect(verify).toBeGreaterThan(source.indexOf("check(parent.rows[0]?.owned)"));
  expect(verify).toBeGreaterThan(source.indexOf("const tables ="));
  expect(verify).toBeLessThan(source.indexOf("return { client, db:"));
  expect(source).not.toMatch(/await migrate\(|applyIdentityActivation\(|seedIdentityActivationBackfill\(/);
});
test("reconnect verifies provenance after existing ownership and activation without applying or seeding", async () => {
  const source = await Bun.file(new URL("./run-readback-proof-client.ts", import.meta.url)).text();
  const verify = source.indexOf("await verifyRunProvenance(client)");
  expect(verify).toBeGreaterThan(source.indexOf("await verifyIdentityActivation(client)"));
  expect(verify).toBeLessThan(source.indexOf("return { client, db:"));
  expect(source).not.toMatch(/await migrate\(|applyRunProvenance\(|seedRun/);
});
