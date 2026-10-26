import { expect, test } from "bun:test";
import { resolve } from "node:path";

test.skipIf(process.platform !== "linux")("fixed Linux store fixture guard denies local invocation before target filesystem/helper access", () => {
  const result = Bun.spawnSync([process.execPath, "--no-env-file", resolve("scripts/fixtures/journal-store-proof.ts")], {
    env: { LANG: "C", LC_ALL: "C" }, stdout: "pipe", stderr: "pipe", timeout: 2000,
  });
  expect(result.exitCode).toBe(1); expect(result.signalCode ?? null).toBeNull();
  expect(result.stdout.toString()).toBe('{"case":"guard","result":"denied"}\n');
  expect(result.stderr.length).toBe(0);
});
