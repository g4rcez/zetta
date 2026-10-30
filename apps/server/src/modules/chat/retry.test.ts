import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { HarnessError, runCli } from "./harness";
import { failureKind, retryDelayMs, withRetry } from "./retry";

async function script(body: (marker: string) => string) {
  const dir = await mkdtemp(join(tmpdir(), "zetta-retry-"));
  const path = join(dir, "fake");
  await writeFile(path, `#!/bin/sh\n${body(join(dir, "seen"))}\n`);
  await chmod(path, 0o755);
  return path;
}
const cli = (resolve: () => string) => runCli({ harness: "pi", prompt: "x", model: null, resolve });

describe("failure kinds", () => {
  test("sorts error codes", () => {
    expect(failureKind("failed")).toBe("transient");
    expect(failureKind("timeout")).toBe("transient");
    expect(failureKind(undefined)).toBe("transient");
    expect(failureKind("quota")).toBe("quota");
    expect(failureKind("auth_required")).toBe("needs_person");
    expect(failureKind("not_installed")).toBe("needs_person");
    expect(failureKind("owner_inactive")).toBe("needs_person");
  });
});

describe("retry delays", () => {
  test("transient backs off, then stays at 30 minutes, then asks a person", () => {
    expect(retryDelayMs("transient", 1)).toBe(30_000);
    expect(retryDelayMs("transient", 3)).toBe(120_000);
    expect(retryDelayMs("transient", 7)).toBe(1_800_000);
    expect(retryDelayMs("transient", 10)).toBe(1_800_000);
    expect(retryDelayMs("transient", 11)).toBeNull();
  });
  test("quota waits for the limit to reset, for at most 24 hours in total", () => {
    expect(retryDelayMs("quota", 1)).toBe(900_000);
    expect(retryDelayMs("quota", 2)).toBe(1_800_000);
    expect(retryDelayMs("quota", 3)).toBe(3_600_000);
    expect(retryDelayMs("quota", 25)).toBe(3_600_000);
    expect(retryDelayMs("quota", 26)).toBeNull();
  });
  test("a person is needed at once", () => {
    expect(retryDelayMs("needs_person", 1)).toBeNull();
  });
});

describe("withRetry", () => {
  test("a CLI that fails once and then answers gives the answer", async () => {
    const fake = await script(
      (m) => `if [ -f "${m}" ]; then echo ok; else touch "${m}"; exit 3; fi`,
    );
    expect(await withRetry(() => cli(() => fake), { delays: [1, 1] })).toBe("ok");
  });
  test("a CLI that needs a sign-in is not retried", async () => {
    const fake = await script(() => `echo "not logged in, please run /login" >&2; exit 1`);
    const err = await withRetry(() => cli(() => fake), { delays: [1, 1] }).catch((e) => e);
    expect((err as HarnessError).code).toBe("auth_required");
  });
  test("gives up with the last error after the delays run out", async () => {
    const fake = await script(() => "exit 3");
    const err = await withRetry(() => cli(() => fake), { delays: [1, 1] }).catch((e) => e);
    expect((err as HarnessError).code).toBe("failed");
  });
  test("an abort stops the retries", async () => {
    const fake = await script(() => "exit 3");
    const ctl = new AbortController();
    ctl.abort();
    const err = await withRetry(() => cli(() => fake), {
      delays: [60_000],
      signal: ctl.signal,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HarnessError);
  });
});
