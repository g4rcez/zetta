import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bindFixture, capture, createArgs, IMAGE, localImage, OUTPUT_BYTES, validatePolicy, validateTermination, WALL_MS } from "./execution-isolation-probe";

const env = { PATH: "/usr/bin:/bin" };
const run = (code: string, timeout = 1000, cap = OUTPUT_BYTES, signal?: AbortSignal) =>
  capture([process.execPath, "--no-env-file", "-e", code], env, timeout, cap, signal);

// Representative selected Docker inspection, no daemon/mock process or host fixtures.
function policy() {
  return {
    Id: "a".repeat(64), Name: "/fixture", label: "owned",
    config: { Image: IMAGE, User: "65534:65534", Entrypoint: ["/usr/local/bin/bun"], Cmd: ["--no-env-file", "/input/probe.ts", "A", "normal"], Env: ["HOME=/scratch"], WorkingDir: "/scratch", Healthcheck: { Test: ["NONE"] } },
    host: {
      NetworkMode: "none", PidMode: "", IpcMode: "none", CgroupnsMode: "private", Privileged: false,
      ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"],
      Memory: 134217728, MemorySwap: 134217728, NanoCpus: 1000000000, PidsLimit: 32,
      Tmpfs: { "/scratch": "rw,noexec,nosuid,nodev,size=16777216,mode=1777" },
      PublishAllPorts: false, RestartPolicy: { Name: "no" }, LogConfig: { Type: "none" },
      Mounts: [{ Type: "bind", Source: "/synthetic/A", Target: "/input", ReadOnly: true, BindOptions: { Propagation: "rprivate" } }],
    },
    networks: { none: {} },
    Mounts: [{ Type: "bind", Source: "/synthetic/A", Destination: "/input", RW: false, Propagation: "rprivate" }],
  };
}
const expected = { name: "fixture", token: "owned", input: "/synthetic/A", actor: "A" as const, mode: "normal", env: ["HOME=/scratch"] };

describe("execution-isolation-probe", () => {
  test("fixed image, no pulls, policy budgets and one read-only input", () => {
    const args = createArgs("fixture", "owned", "/synthetic/A", "A", "normal", "synthetic");
    expect(WALL_MS).toBe(15000);
    expect(OUTPUT_BYTES).toBe(65536);
    for (const arg of ["--pull=never", "--user=65534:65534", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only", "--network=none", "--cpus=1", "--memory=128m", "--pids-limit=32", "--log-driver=none"]) expect(args).toContain(arg);
    expect(args.some(a => a === "--pid" || a.startsWith("--pid="))).toBe(false);
    expect(args.filter(a => a === "--mount")).toHaveLength(1);
    expect(args[args.indexOf("--mount") + 1]).toBe("type=bind,src=/synthetic/A,dst=/input,readonly,bind-propagation=rprivate");
    expect(args.slice(-5)).toEqual([IMAGE, "--no-env-file", "/input/probe.ts", "A", "normal"]);
    for (const arg of ["--privileged", "--publish", "--device", "--volume", "--env-file"]) expect(args).not.toContain(arg);
  });
  test("missing or mismatched local image fails closed without exporting daemon errors", () => {
    expect(() => localImage({ exit: 1, reason: "exit", output: "synthetic private daemon failure" })).toThrow("blocked");
    expect(() => localImage({ exit: 0, reason: "exit", output: JSON.stringify({ id: "wrong", env: [] }) })).toThrow("blocked");
    expect(localImage({ exit: 0, reason: "exit", output: JSON.stringify({ id: IMAGE, env: [] }) }).id).toBe(IMAGE);
  });
  test("state selection binds actor and exclusive lease, not possession of a reference", () => {
    const leased = new Set<"A" | "B">();
    expect(() => bindFixture("A", "B", leased)).toThrow();
    expect(leased.size).toBe(0);
    expect(bindFixture("A", "A", leased)).toBe("A");
    expect(() => bindFixture("A", "A", leased)).toThrow();
  });
  test("inspection accepts exact policy, rejects weakened/foreign/unsupported settings", () => {
    expect(() => validatePolicy(policy(), expected)).not.toThrow();
    const mutations = [
      (v: any) => { v.label = "foreign"; },
      (v: any) => { v.config.Image = "untrusted"; },
      (v: any) => { v.config.User = "0"; },
      (v: any) => { v.config.Env.push("SECRET=foreign"); },
      (v: any) => { v.host.NetworkMode = "host"; },
      (v: any) => { v.host.PidMode = "host"; },
      (v: any) => { v.host.PidMode = "container:foreign"; },
      (v: any) => { v.host.PidMode = "private"; },
      (v: any) => { v.host.CgroupnsMode = "host"; },
      (v: any) => { v.host.Privileged = true; },
      (v: any) => { v.host.CapDrop = []; },
      (v: any) => { v.host.SecurityOpt = []; },
      (v: any) => { v.host.ReadonlyRootfs = false; },
      (v: any) => { v.host.PidsLimit = 0; },
      (v: any) => { v.host.Memory = 0; },
      (v: any) => { v.host.Tmpfs["/scratch"] = "rw,size=1g"; },
      (v: any) => { v.host.Devices = [{}]; },
      (v: any) => { v.host.PortBindings = { "80/tcp": [{}] }; },
      (v: any) => { v.host.Binds = ["/:/host"]; },
      (v: any) => { v.host.Mounts[0].Source = "/synthetic/B"; },
      (v: any) => { v.Mounts[0].RW = true; },
      (v: any) => { v.Mounts.push({ Type: "bind", Source: "/host" }); },
    ];
    for (const mutate of mutations) {
      const value = policy(); mutate(value);
      expect(() => validatePolicy(value, expected)).toThrow();
    }
  });
  test("captures bounded private output and child exit without inherited environment", async () => {
    process.env.ZETTA_SYNTHETIC_PROBE_PARENT = "synthetic";
    try {
      const r = await run('process.stdout.write(process.env.ZETTA_SYNTHETIC_PROBE_PARENT === undefined ? "ok" : "leaked"); process.exitCode = 7');
      expect(r).toEqual({ exit: 7, reason: "exit", output: "ok" });
    } finally { delete process.env.ZETTA_SYNTHETIC_PROBE_PARENT; }
  });
  test("combined stdout/stderr overflow cancels and discards all raw output", async () => {
    const r = await run('process.stdout.write("private".repeat(100)); process.stderr.write("private".repeat(100)); setInterval(() => {}, 1000)', 1000, 800);
    expect(r.reason).toBe("overflow"); expect(r.output).toBe("");
  });
  test("explicit cancellation discards output", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      const r = await run('process.stdout.write("private"); setInterval(() => {}, 1000)', 1000, 4096, controller.signal);
      expect(r.reason).toBe("cancel"); expect(r.output).toBe("");
    } finally { clearTimeout(timer); }
  });
  test("cancel before readiness cannot pass cancellation lifecycle evidence", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      const r = await capture([process.execPath, "--no-env-file", "-e", 'await Bun.sleep(650); process.stdout.write("rfc002-cancel-child-ready\\n"); setInterval(() => {}, 1000)'], env, 1500, OUTPUT_BYTES, controller.signal, true);
      expect(r.reason).toBe("cancel"); expect(r.output).toBe(""); expect(r.ready).toBe(false);
      expect(r.ready === true && r.reason === "cancel" && r.output === "").toBe(false);
    } finally { clearTimeout(timer); }
  });
  test("missing, partial, invalid or stderr-only readiness blocks without timer fallback", async () => {
    for (const code of [
      'setInterval(() => {}, 1000)',
      'process.stdout.write("rfc002-cancel-child-"); setInterval(() => {}, 1000)',
      'process.stdout.write("invalid\\nrfc002-cancel-child-ready\\n"); setInterval(() => {}, 1000)',
      'process.stderr.write("rfc002-cancel-child-ready\\n"); setInterval(() => {}, 1000)',
    ]) {
      const r = await capture([process.execPath, "--no-env-file", "-e", code], env, 650, OUTPUT_BYTES, undefined, true);
      expect(r.reason).toBe("deadline"); expect(r.output).toBe(""); expect(r.ready).toBe(false);
    }
  });
  test("readiness remains subject to the combined private output bound", async () => {
    const r = await capture([process.execPath, "--no-env-file", "-e", 'process.stdout.write("rfc002-cancel-child-ready\\n"); setInterval(() => {}, 1000)'], env, 1000, 8, undefined, true);
    expect(r.reason).toBe("overflow"); expect(r.output).toBe(""); expect(r.ready).toBe(false);
  });
  test("delayed A starts its actual child before readiness arms cancellation", async () => {
    const fixture = new URL("./fixtures/execution-isolation-payload.ts", import.meta.url).pathname;
    const code = `await Bun.sleep(650); Bun.spawn([process.execPath, '--no-env-file', ${JSON.stringify(fixture)}, 'A', 'cancel'], {stdout:'inherit', stderr:'inherit'}); setInterval(() => {}, 1000)`;
    const started = Date.now();
    const r = await capture([process.execPath, "--no-env-file", "-e", code], env, 2500, OUTPUT_BYTES, undefined, true);
    expect(r.reason).toBe("cancel"); expect(r.output).toBe(""); expect(r.ready).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1150);
  });
  test("deadline kills the owned process group, including a bounded child", async () => {
    const root = mkdtempSync(join(tmpdir(), "zetta-probe-test-"));
    const marker = join(root, "child-survived"), ready = join(root, "child-ready");
    const code = `Bun.spawn([process.execPath, '--no-env-file', '-e', ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'failed'), 500)`)}], {stdout:'inherit', stderr:'inherit'}); setInterval(() => {}, 1000)`;
    try {
      const r = await run(code, 250);
      expect(r.reason).toBe("deadline"); expect(r.output).toBe("");
      expect(existsSync(ready)).toBe(true); // Positive control: the finite child really started.
      await Bun.sleep(650);
      expect(existsSync(marker)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});


describe("lifecycle evidence", () => {
  test("observed child readiness does not cancel a deadline attempt", async () => {
    // Given an actual TERM-resistant payload and child, with a shortened local deadline.
    const fixture = new URL("./fixtures/execution-isolation-payload.ts", import.meta.url).pathname;
    // When readiness is observed without arming cancellation.
    const result = await capture([process.execPath, "--no-env-file", fixture, "A", "deadline"], env, 900, OUTPUT_BYTES, undefined, "observe");
    // Then the deadline owns termination and private output is discarded.
    expect(result).toMatchObject({ ready: true, reason: "deadline", output: "" });
  });
  test("accepts only stopped zero-PID SIGKILL state with the expected OOM cause", () => {
    // Given selected Docker state, not an exit code inferred from attachment.
    const stopped = { Running: false, Pid: 0, ExitCode: 137, OOMKilled: false };
    // When validating escalation and memory enforcement outcomes.
    expect(() => validateTermination(stopped, false)).not.toThrow();
    expect(() => validateTermination({ ...stopped, OOMKilled: true }, true)).not.toThrow();
    // Then live, graceful, wrong-cause and stale-PID outcomes fail closed.
    for (const state of [
      { ...stopped, Running: true }, { ...stopped, Pid: 123 },
      { ...stopped, ExitCode: 0 }, { ...stopped, OOMKilled: true },
    ]) expect(() => validateTermination(state, false)).toThrow();
    expect(() => validateTermination(stopped, true)).toThrow();
  });
});
