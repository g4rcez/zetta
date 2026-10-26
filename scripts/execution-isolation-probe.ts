// Standalone synthetic RFC-002 evidence only; never import this into app startup.
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";

export const IMAGE = "sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4";
export const WALL_MS = 15_000;
export const OUTPUT_BYTES = 65_536;
export const LABEL = "zetta.rfc002.probe";
// Trusted, observed local Colima endpoint; no context/credential discovery or fallback.
export const ENDPOINT = "unix://${HOME}/.colima/default/docker.sock";
const ENTRY = "/usr/local/bin/bun";
const PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin";
const TMPFS = "rw,noexec,nosuid,nodev,size=16777216,mode=1777";
const CANCEL_READY = Buffer.from("rfc002-cancel-child-ready\n");
type Result = { exit: number; reason: "exit" | "deadline" | "overflow" | "cancel"; output: string; ready?: boolean };
type Actor = "A" | "B";
const activeGroups = new Set<number>();
const requireTrue = (value: unknown) => { if (!value) throw new Error("blocked"); };

// Shared byte budget across both streams. No raw child output escapes the probe.
export async function capture(argv: string[], env: Record<string, string>, timeout: number, cap = OUTPUT_BYTES, signal?: AbortSignal, cancelWhenReady: boolean | "observe" = false): Promise<Result> {
  let reason: Result["reason"] = "exit", size = 0;
  let ready = false, matched = 0;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  const chunks: Buffer[] = [];
  const child = Bun.spawn(argv, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
  activeGroups.add(child.pid);
  const kill = (why: Result["reason"]) => {
    if (reason !== "exit") return;
    reason = why;
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  };
  const cancel = () => kill("cancel");
  const timer = setTimeout(() => kill("deadline"), timeout);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const drain = async (stream: ReadableStream<Uint8Array>, stdout = false) => {
    for await (const chunk of stream) {
      size += chunk.byteLength;
      if (size > cap) kill("overflow");
      if (reason === "exit") {
        chunks.push(Buffer.from(chunk));
        // Only the fixed stdout prefix can arm cancellation; never a startup timer.
        if (cancelWhenReady && stdout && !ready && matched >= 0) {
          for (const byte of chunk) {
            if (byte !== CANCEL_READY[matched]) { matched = -1; break; }
            if (++matched === CANCEL_READY.length) {
              ready = true;
              if (cancelWhenReady === true) cancelTimer = setTimeout(cancel, 500);
              break;
            }
          }
        }
      }
    }
  };
  try {
    await Promise.all([drain(child.stdout, true), drain(child.stderr)]);
    const exit = await child.exited;
    return { exit, reason, output: reason === "exit" ? Buffer.concat(chunks).toString("utf8") : "", ...(cancelWhenReady ? { ready } : {}) };
  } finally { clearTimeout(timer); clearTimeout(cancelTimer); signal?.removeEventListener("abort", cancel); activeGroups.delete(child.pid); }
}

export function localImage(result: Result): { id: string; env: string[] } {
  requireTrue(result.exit === 0 && result.reason === "exit");
  const image = JSON.parse(result.output);
  requireTrue(image.id === IMAGE && Array.isArray(image.env) && image.env.every((e: unknown) => typeof e === "string"));
  return image;
}

export function bindFixture(actor: Actor, state: Actor, leased: Set<Actor>): Actor {
  requireTrue(actor === state && !leased.has(state));
  leased.add(state);
  return state;
}

export function createArgs(name: string, token: string, input: string, actor: Actor, mode: string, marker: string): string[] {
  return ["container", "create", "--pull=never", "--name", name, "--label", `${LABEL}=${token}`,
    "--user=65534:65534", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only",
    "--network=none", "--ipc=none", "--cgroupns=private", "--cpus=1", "--memory=128m", "--memory-swap=128m", "--pids-limit=32",
    "--tmpfs", `/scratch:${TMPFS}`, "--mount", `type=bind,src=${input},dst=/input,readonly,bind-propagation=rprivate`,
    "--log-driver=none", "--no-healthcheck", "--workdir=/scratch", "--env", `PATH=${PATH}`, "--env", "HOME=/scratch",
    "--env", `FIXTURE_TOKEN=${marker}`, "--entrypoint", ENTRY, IMAGE, "--no-env-file", "/input/probe.ts", actor, mode];
}
const hc = ["NetworkMode", "PidMode", "IpcMode", "CgroupnsMode", "UTSMode", "UsernsMode", "Privileged", "CapAdd", "CapDrop", "SecurityOpt", "ReadonlyRootfs", "Memory", "MemorySwap", "NanoCpus", "PidsLimit", "Tmpfs", "Devices", "DeviceRequests", "PortBindings", "PublishAllPorts", "Binds", "VolumesFrom", "ExtraHosts", "Links", "GroupAdd", "Sysctls", "Mounts", "RestartPolicy", "LogConfig"];
const fields = (names: string[], prefix: string) => names.map(n =>
  `"${n}":{{json ${prefix ? `(index .${prefix.slice(0, -1)} "${n}")` : `.${n}`}}}`,
).join(",");
export const INSPECT = `{${fields(["Id", "Name", "Mounts"], "")},"label":{{json (index .Config.Labels "${LABEL}")}},"config":{${fields(["Image", "User", "Entrypoint", "Cmd", "Env", "WorkingDir", "Volumes", "ExposedPorts", "Healthcheck"], "Config.")}},"host":{${fields(hc, "HostConfig.")}},"networks":{{json .NetworkSettings.Networks}},"state":{${fields(["Running", "Pid", "ExitCode", "OOMKilled"], "State.")}}}`;
const empty = (v: unknown) => v == null || Object.keys(v as object).length === 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// JSON is exclusively from selected fields on our labelled synthetic containers.
export function validatePolicy(v: any, expected: { name: string; token: string; input: string; actor: Actor; mode: string; env: string[] }) {
  const h = v.host, c = v.config;
  requireTrue(/^\w{64}$/.test(v.Id) && v.Name === `/${expected.name}` && v.label === expected.token);
  requireTrue(c.Image === IMAGE && c.User === "65534:65534" && same(c.Entrypoint, [ENTRY]) && same(c.Cmd, ["--no-env-file", "/input/probe.ts", expected.actor, expected.mode]));
  requireTrue(same([...c.Env].sort(), [...expected.env].sort()) && c.WorkingDir === "/scratch" && empty(c.Volumes) && empty(c.ExposedPorts) && same(c.Healthcheck?.Test, ["NONE"]));
  requireTrue(h.NetworkMode === "none" && h.PidMode === "" && h.IpcMode === "none" && h.CgroupnsMode === "private" && !h.UTSMode && !h.UsernsMode && h.Privileged === false);
  requireTrue(h.ReadonlyRootfs === true && same(h.CapDrop, ["ALL"]) && empty(h.CapAdd) && same(h.SecurityOpt, ["no-new-privileges"]));
  requireTrue(h.Memory === 134217728 && h.MemorySwap === 134217728 && h.NanoCpus === 1000000000 && h.PidsLimit === 32);
  requireTrue(same(h.Tmpfs, { "/scratch": TMPFS }) && h.PublishAllPorts === false && h.RestartPolicy?.Name === "no" && h.LogConfig?.Type === "none");
  for (const k of ["Devices", "DeviceRequests", "PortBindings", "Binds", "VolumesFrom", "ExtraHosts", "Links", "GroupAdd", "Sysctls"]) requireTrue(empty(h[k]));
  requireTrue(Object.keys(v.networks).every(k => k === "none"));
  requireTrue(h.Mounts?.length === 1 && h.Mounts[0].Type === "bind" && h.Mounts[0].Source === expected.input && h.Mounts[0].Target === "/input" && h.Mounts[0].ReadOnly === true && h.Mounts[0].BindOptions?.Propagation === "rprivate");
  requireTrue(v.Mounts?.length === 1 && v.Mounts[0].Type === "bind" && v.Mounts[0].Source === expected.input && v.Mounts[0].Destination === "/input" && v.Mounts[0].RW === false && v.Mounts[0].Propagation === "rprivate");
}

export function validateTermination(state: { Running: boolean; Pid: number; ExitCode: number; OOMKilled: boolean }, oom: boolean): void {
  requireTrue(state.Running === false && state.Pid === 0 && state.ExitCode === 137 && state.OOMKilled === oom);
}

async function main() {
  // Only newly created synthetic actor leaves are mounted, never this repo or HOME.
  const root = mkdtempSync(join(import.meta.dir, "..", ".zetta-isolation-test-"));
  chmodSync(root, 0o700);
  const config = join(root, "docker"); mkdirSync(config, { mode: 0o700 });
  const env = { PATH, HOME: config, DOCKER_CONFIG: config, LANG: "C" };
  const token = crypto.randomUUID(), owned = new Set<string>(), leases = new Set<Actor>();
  const evidence: { case: string; passed: boolean; exit?: number; elapsedMs?: number }[] = [];
  const started = Date.now();
  let cleanup = false, success = false, cleaning = false, uncertainCreate = false;
  const remaining = () => Math.min(3000, (cleaning ? 118_000 : 95_000) - (Date.now() - started));
  const cli = async (args: string[], timeout = remaining(), cancelWhenReady: boolean | "observe" = false) => {
    requireTrue(timeout > 0);
    return capture(["docker", "--host", ENDPOINT, ...args], env, timeout, OUTPUT_BYTES, undefined, cancelWhenReady);
  };
  const ok = async (args: string[], timeout?: number) => {
    const r = await cli(args, timeout); requireTrue(r.exit === 0 && r.reason === "exit"); return r.output.trim();
  };
  const inspect = async (name: string) => JSON.parse(await ok(["container", "inspect", "--format", INSPECT, name]));
  const remove = async (name: string) => {
    const v = await inspect(name);
    requireTrue(v.label === token && v.Name === `/${name}` && /^[a-f0-9]{64}$/.test(v.Id));
    await ok(["container", "rm", "--force", v.Id]);
    owned.delete(name);
  };
  try {
    // Inspection fails closed when image missing; never pull, build or select another image.
    const image = localImage(await cli(["image", "inspect", "--format", '{"id":{{json .Id}},"env":{{json .Config.Env}}}', IMAGE]));
    let denied = false;
    try { bindFixture("A", "B", leases); } catch { denied = true; }
    requireTrue(denied && leases.size === 0);
    bindFixture("A", "A", leases);
    denied = false; try { bindFixture("A", "A", leases); } catch { denied = true; }
    requireTrue(denied); leases.clear();
    evidence.push({ case: "foreign-and-busy-state-denied-prelaunch", passed: true });
    const fakeHost = join(root, "fake-host"); mkdirSync(fakeHost, { mode: 0o700 });
    const hostMarker = crypto.randomUUID(); writeFileSync(join(fakeHost, "canary"), hostMarker);
    for (const mode of ["normal", "fresh", "overflow", "cancel", "deadline", "memory-pressure", "cpu-pressure", "pid-pressure"]) {
      const dirs = { A: join(root, `A-${mode}`), B: join(root, `B-${mode}`) };
      const markers = { A: crypto.randomUUID(), B: crypto.randomUUID() };
      const names = { A: `zetta-rfc002-${crypto.randomUUID()}`, B: `zetta-rfc002-${crypto.randomUUID()}` };
      const deadlines: ReturnType<typeof setTimeout>[] = [];
      let expired = false;
      try {
        for (const actor of ["B", "A"] as const) {
          bindFixture(actor, actor, leases);
          mkdirSync(dirs[actor], { mode: 0o755 });
          copyFileSync(new URL("./fixtures/execution-isolation-payload.ts", import.meta.url), join(dirs[actor], "probe.ts"));
          chmodSync(join(dirs[actor], "probe.ts"), 0o444);
          writeFileSync(join(dirs[actor], "canary"), markers[actor], { mode: 0o444 });
          if (actor === "A") {
            writeFileSync(join(dirs.A, "foreign-marker"), markers.B, { mode: 0o444 });
            writeFileSync(join(dirs.A, "host-marker"), hostMarker, { mode: 0o444 });
            writeFileSync(join(dirs.A, "foreign-path"), join(dirs.B, "canary"), { mode: 0o444 });
            writeFileSync(join(dirs.A, "host-path"), join(fakeHost, "canary"), { mode: 0o444 });
            symlinkSync(join(dirs.B, "canary"), join(dirs.A, "escape"));
            symlinkSync("/input/escape", join(dirs.A, "chain"));
          }
          requireTrue(owned.size < 2);
          owned.add(names[actor]); // Register BEFORE create, including uncertain/partial CLI failures.
          try {
            const made = await cli(createArgs(names[actor], token, dirs[actor], actor, mode, markers[actor]));
            requireTrue(made.exit === 0 && made.reason === "exit");
          } catch { uncertainCreate = true; throw new Error("blocked"); }
          const v = await inspect(names[actor]);
          const overrides = [`PATH=${PATH}`, "HOME=/scratch", `FIXTURE_TOKEN=${markers[actor]}`];
          const expectedEnv = [...image.env.filter((e: string) => !overrides.some(x => x.split("=")[0] === e.split("=")[0])), ...overrides];
          validatePolicy(v, { name: names[actor], token, input: dirs[actor], actor, mode, env: expectedEnv });
          requireTrue(v.state.Running === false);
        }
        deadlines.push(setTimeout(() => { expired = true; void remove(names.B).catch(() => {}); }, mode === "deadline" ? 24_000 : WALL_MS));
        await ok(["container", "start", names.B]);
        const b = await inspect(names.B); requireTrue(b.state.Running && b.state.Pid > 1);
        writeFileSync(join(dirs.A, "foreign-pid"), String(b.state.Pid), { mode: 0o444 });
        deadlines.push(setTimeout(() => { expired = true; void remove(names.A).catch(() => {}); }, mode === "deadline" ? 22_000 : WALL_MS));
        if (mode === "deadline") requireTrue(95_000 - (Date.now() - started) >= WALL_MS);
        const attachedAt = Date.now();
        const result = await cli(["container", "start", "--attach", names.A], Math.min(WALL_MS, 95_000 - (Date.now() - started)), mode === "deadline" ? "observe" : mode === "cancel");
        if (mode === "overflow") requireTrue(result.reason === "overflow" && result.output === "");
        else if (mode === "cancel") requireTrue(result.ready === true && result.reason === "cancel" && result.output === "");
        else if (mode === "deadline") {
          requireTrue(result.ready === true && result.reason === "deadline" && result.output === "" && Date.now() - attachedAt >= WALL_MS);
          requireTrue((await inspect(names.A)).state.Running === true);
          await ok(["container", "stop", "--time=1", names.A]);
          validateTermination((await inspect(names.A)).state, false);
        } else if (mode === "memory-pressure") {
          requireTrue(result.reason === "exit" && result.exit === 137 && result.output === "");
          validateTermination((await inspect(names.A)).state, true);
        } else requireTrue(result.reason === "exit" && result.exit === 0 && result.output === "ok");
        await remove(names.A); // Removes whole container process tree, not just attached Docker CLI.
        await ok(["container", "exec", "--user=65534:65534", names.B, ENTRY, "--no-env-file", "/input/probe.ts", "health"]);
        requireTrue((await inspect(names.B)).state.Running && !expired);
        await remove(names.B);
        evidence.push({ case: mode === "normal" ? "filesystem-process-env-fd-child-scratch" : mode, passed: true, exit: result.exit, elapsedMs: Date.now() - attachedAt });
      } finally { for (const timer of deadlines) clearTimeout(timer); leases.clear(); }
    }
    const recovery = await (await import("./execution-isolation-recovery")).runRecoveryProbe();
    evidence.push(...recovery.cases);
    requireTrue(recovery.cleanup && recovery.passed);
    success = true;
  } catch { evidence.push({ case: "probe-blocked", passed: false }); }
  finally {
    cleaning = true;
    // Exact label-filtered reconciliation catches partial CREATE. No prune or volume actions.
    try {
      for (let retry = 0; retry < 2; retry++) {
        const ids = (await ok(["container", "ls", "--all", "--no-trunc", "--filter", `label=${LABEL}=${token}`, "--format", "{{.ID}}"], 3000)).split("\n").filter(Boolean);
        for (const id of ids) {
          requireTrue(/^[a-f0-9]{64}$/.test(id));
          const v = await inspect(id);
          requireTrue(v.label === token && owned.has(v.Name.slice(1)));
          await remove(v.Name.slice(1));
        }
        await Bun.sleep(100);
      }
      const left = await ok(["container", "ls", "--all", "--filter", `label=${LABEL}=${token}`, "--format", "{{.ID}}"], 3000);
      cleanup = left === "" && !uncertainCreate; // A late daemon CREATE cannot be disproved by short polling.
    } catch { cleanup = false; }
    if (cleanup) rmSync(root, { recursive: true, force: true }); // Only exact created root, after container deletion.
  }
  console.log(JSON.stringify({ cases: evidence, cleanup, passed: success && cleanup }));
  process.exitCode = success && cleanup ? 0 : 1;
}
if (import.meta.main) {
  // Hard total ceiling includes cleanup; a ceiling failure never claims reconciliation.
  const ceiling = setTimeout(() => {
    for (const pid of activeGroups) { try { process.kill(-pid, "SIGKILL"); } catch {} }
    console.log('{"cases":[{"case":"total-deadline","passed":false}],"cleanup":false,"passed":false}'); process.exit(1);
  }, 120_000);
  try { await main(); } catch { console.log('{"cases":[{"case":"setup-blocked","passed":false}],"cleanup":false,"passed":false}'); process.exitCode = 1; }
  finally { clearTimeout(ceiling); }
}
