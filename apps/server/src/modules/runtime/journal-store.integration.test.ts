import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
// The proof script is part of the separately reviewed Linux proof and is not in the repository yet: without it there is nothing to run.
const fixture = resolve("scripts/fixtures/journal-store-proof.ts");

test.skipIf(process.platform !== "linux" || !existsSync(fixture))(
  "fixed Linux store fixture guard denies local invocation before target filesystem/helper access",
  () => {
    const result = Bun.spawnSync([process.execPath, "--no-env-file", fixture], {
      env: { LANG: "C", LC_ALL: "C" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 2000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.signalCode ?? null).toBeNull();
    expect(result.stdout.toString()).toBe('{"case":"guard","result":"denied"}\n');
    expect(result.stderr.length).toBe(0);
  },
);
