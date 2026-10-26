import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { HarnessError, createLimiter, harnessCommands, harnessHome, harnessMessage, runCli, streamCli } from "./harness";

async function script(body: string) {
  const dir = await mkdtemp(join(tmpdir(), "zetta-fake-"));
  const path = join(dir, "fake");
  await writeFile(path, `#!/bin/sh\n${body}\n`); await chmod(path, 0o755);
  return path;
}
describe("cli harness", () => {
  test("every native harness builds an argv with the prompt as one element", () => {
    for (const h of Object.keys(harnessCommands) as (keyof typeof harnessCommands)[]) {
      const argv = harnessCommands[h]("hello; rm -rf /", "m1");
      expect(argv.at(-1)).toBe("hello; rm -rf /");
      expect(argv).toContain("m1");
    }
  });
  test("returns stdout, runs in an empty cwd with a minimal env", async () => {
    const fake = await script("echo \"cwd=$(ls | wc -l | tr -d \" \") secret=${ZETTA_SECRET:-none} arg=$2\"");
    process.env.ZETTA_SECRET = "leak";
    const out = await runCli({ harness: "claude-code", prompt: "hi", model: null, resolve: () => fake });
    expect(out).toBe("cwd=0 secret=none arg=hi");
  });
  test("maps missing binary, failure and timeout to typed errors", async () => {
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e as HarnessError).code);
    const failing = await script("exit 3");
    expect(await code(runCli({ harness: "pi", prompt: "x", model: null, resolve: () => null }))).toBe("not_installed");
    expect(await code(runCli({ harness: "pi", prompt: "x", model: null, resolve: () => failing }))).toBe("failed");
    const slow = await script("sleep 5");
    expect(await code(runCli({ harness: "pi", prompt: "x", model: null, timeoutMs: 200, resolve: () => slow }))).toBe("timeout");
  });
  test("timeout kills the whole process tree, not only the child", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zetta-tree-"));
    const marker = join(dir, "alive");
    const fake = await script(`(sleep 1; echo x > ${marker}) &\nsleep 30`);
    const code = await runCli({ harness: "pi", prompt: "x", model: null, timeoutMs: 200, resolve: () => fake }).then(() => "ok", (e) => (e as HarnessError).code);
    expect(code).toBe("timeout");
    await Bun.sleep(1500);
    expect(await Bun.file(marker).exists()).toBe(false); // the grandchild was killed too
  });
  test("an abort signal cancels the run", async () => {
    const slow = await script("sleep 30"); const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const code = await runCli({ harness: "pi", prompt: "x", model: null, signal: ac.signal, resolve: () => slow }).then(() => "ok", (e) => (e as HarnessError).code);
    expect(code).toBe("cancelled");
  });
  test("auth failures are classified without leaking stderr; other failures stay generic", async () => {
    const authFake = await script('echo "Error: Not logged in. Please run /login" >&2; exit 1');
    const other = await script('echo "boom /secret/path" >&2; exit 1');
    const run = (p: string) => runCli({ harness: "claude-code", prompt: "x", model: null, resolve: () => p }).then(() => "ok", (e: HarnessError) => e);
    const a = await run(authFake) as HarnessError, o = await run(other) as HarnessError;
    expect(a.code).toBe("auth_required"); expect(o.code).toBe("failed");
    expect(harnessMessage("claude-code", a.code)).not.toContain("login"); expect(harnessMessage("pi", "not_installed")).toContain("not installed");
  });
  test("limiter caps per-user and global concurrency and reports busy", async () => {
    const lim = createLimiter({ global: 2, perUser: 1, waitMs: 150 });
    const r1 = await lim.acquire("a");
    expect(await lim.acquire("a").then(() => "ok", (e) => e.code)).toBe("busy"); // per-user
    const r2 = await lim.acquire("b");
    expect(await lim.acquire("c").then(() => "ok", (e) => e.code)).toBe("busy"); // global
    r1(); r2();
    const r3 = await lim.acquire("a"); r3();
  });
  test("per-user HOME isolates native logins when configured", async () => {
    expect(harnessHome("u1", "codex", "/data/homes")).toBe("/data/homes/u1/codex");
    expect(harnessHome("../evil", "codex", "/data/homes")).toBe("/data/homes/___evil/codex");
    expect(harnessHome("u1", "codex", undefined)).toBeUndefined();
    const root = await mkdtemp(join(tmpdir(), "zetta-homes-")); process.env.ZETTA_HARNESS_HOME_ROOT = root;
    const fake = await script('echo "home=$HOME"');
    const out = (u: string) => runCli({ harness: "pi", prompt: "x", model: null, userId: u, resolve: () => fake });
    expect(await out("alice")).toBe(`home=${root}/alice/pi`); expect(await out("bob")).toBe(`home=${root}/bob/pi`);
    delete process.env.ZETTA_HARNESS_HOME_ROOT;
  });
  test("streams chunks as they arrive", async () => {
    const fake = await script("echo one; sleep 0.2; echo two");
    const parts: string[] = [];
    for await (const c of streamCli({ harness: "pi", prompt: "x", model: null, resolve: () => fake })) parts.push(c);
    expect(parts.join("")).toContain("one"); expect(parts.join("")).toContain("two");
  });
});

import { killGroup } from "./harness";
import { test as osTest, expect as osExpect } from "bun:test";
osTest("killGroup is safe for missing processes on every platform branch", () => {
  osExpect(() => killGroup(2 ** 22 + 12345, "linux")).not.toThrow();
  osExpect(() => killGroup(2 ** 22 + 12345, "win32")).not.toThrow(); // taskkill is absent here; the failure must be swallowed
});
