// Standalone, bundle-only Linux fixture. No app composition; root authorizes execution separately.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beginJournalLock, parseJournalLockPolicy } from "../../apps/server/src/modules/runtime/journal-lock";
import type { JournalLockOwner, JournalLockPolicy } from "../../apps/server/src/modules/runtime/journal-lock";

const root = "/var/lib/zetta-journal-proof-67f4c850-0a39-42a8-8ea6-8d69312bb2d0", script = join(root, "proof.mjs");
const policyPath = join(root, "policy.json");
const receiptA = "11111111-1111-4111-8111-111111111111", receiptB = "22222222-2222-4222-8222-222222222222";
const mode = process.argv[2];
const children = new Set<Bun.Subprocess>();
let orphan: { pid: number; identity: string } | undefined;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function emit(value: object) { process.stdout.write(JSON.stringify(value) + "\n"); }
async function policy(): Promise<JournalLockPolicy> {
  assert((await stat(policyPath)).size <= 4096, "policy bound");
  const parsed = parseJournalLockPolicy(JSON.parse(await readFile(policyPath, "utf8")));
  assert(parsed.root === root && parsed.scope.type === "admission", "fixed fixture root");
  return parsed;
}
async function acquire(value: JournalLockPolicy): Promise<JournalLockOwner> {
  const pending = beginJournalLock(value);
  // Attach settlement immediately so failure cleanup cannot become an unhandled rejection.
  const outcome = pending.settled.then(() => null, () => new Error("settlement failed"));
  try { const owner = await pending.ready; assert(await outcome === null, "settlement"); return owner; }
  catch (error) { await outcome; throw error; }
}
async function busy(value: JournalLockPolicy) {
  try { const owner = await acquire(value); await owner.close(); throw new Error("unexpected ownership"); }
  catch (error) { assert(error instanceof Error && error.message === "journal_locked", "busy oracle"); }
}
async function processIdentity(pid: number) {
  try {
    const value = await readFile(`/proc/${pid}/stat`, "utf8"), end = value.lastIndexOf(")");
    return value.slice(end + 2).split(" ")[19] ?? null;
  } catch { return null; }
}
async function stopOrphan() {
  if (!orphan) return;
  const owned = orphan;
  if (await processIdentity(owned.pid) === owned.identity) process.kill(owned.pid, "SIGKILL");
  const until = performance.now() + 5000;
  while (await processIdentity(owned.pid) === owned.identity) {
    assert(performance.now() < until, "orphan cleanup deadline");
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  orphan = undefined;
}
async function cleanup() {
  for (const child of children) { try { child.kill("SIGKILL"); } catch { /* Await exact exit below. */ } }
  await Promise.all([...children].map(child => child.exited));
  children.clear(); await stopOrphan();
}
function child(childMode: "owner" | "hold" | "offset", scope = "admission", fd?: number) {
  const ready = Promise.withResolvers<unknown>();
  const spawned = Bun.spawn([process.execPath, "--no-env-file", script, childMode, scope], {
    stdin: fd ?? "ignore", stdout: "ignore", stderr: "ignore", env: { LANG: "C", LC_ALL: "C" },
    ipc(message) { ready.resolve(message); },
  });
  children.add(spawned);
  void spawned.exited.then(() => ready.reject(new Error("child exited before ready")));
  return { spawned, ready: ready.promise };
}
async function finish(spawned: Bun.Subprocess) {
  spawned.send("close");
  assert(await spawned.exited === 0, "child normal exit"); children.delete(spawned);
}
async function inventory() {
  const binary = await open("/usr/bin/flock", constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await binary.stat(); assert(info.isFile() && info.size > 0 && info.size <= 16_777_216, "binary bound");
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) { const read = await binary.read(bytes, offset, bytes.length - offset, offset); assert(read.bytesRead > 0, "binary read"); offset += read.bytesRead; }
    const version = Bun.spawnSync(["/usr/bin/flock", "--version"], { stdout: "pipe", stderr: "pipe", timeout: 2000, maxBuffer: 4096, env: { LANG: "C", LC_ALL: "C" } });
    assert(version.exitCode === 0, "flock version");
    emit({ mode: "inventory", platform: process.platform, bunVersion: Bun.version, bunRevision: Bun.revision,
      flockVersion: version.stdout.toString().trim(), sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: info.size, uid: info.uid, modeBits: info.mode & 0o7777 });
  } finally { await binary.close(); }
}
async function ownerMode() {
  const base = await policy(), scope = process.argv[3];
  assert(scope === "admission" || scope === "ordinary", "owner scope");
  const owner = await acquire(base);
  let ordinary: ReturnType<typeof child> | undefined;
  if (scope === "ordinary") { ordinary = child("hold"); await ordinary.ready; }
  process.send?.({ tag: "ready", ordinaryPid: ordinary?.spawned.pid ?? null });
  process.on("message", async message => {
    if (message !== "close") process.exit(2);
    if (ordinary) await finish(ordinary.spawned);
    await owner.close(); process.exit(0);
  });
}
async function rawLock(fd: number) {
  const helper = Bun.spawn(["/usr/bin/flock", "-x", "-n", "-E", "75", "0"], { stdin: fd, stdout: "ignore", stderr: "ignore", env: { LANG: "C", LC_ALL: "C" } });
  children.add(helper); assert(await helper.exited === 0 && helper.signalCode === null, "control helper"); children.delete(helper);
}
async function proof() {
  const base = await policy();
  assert(process.platform === "linux", "Linux required");
  await writeFile(join(root, ".admission.lock"), "", { flag: "wx", mode: 0o600 });
  for (const receipt of [receiptA, receiptB]) { await mkdir(join(root, receipt), { mode: 0o700 }); await writeFile(join(root, receipt, ".writer.lock"), "", { flag: "wx", mode: 0o600 }); }
  const owner = child("owner"); await owner.ready;
  await busy(base);
  const unrelated = await open(join(root, ".admission.lock"), constants.O_RDWR | constants.O_NOFOLLOW);
  await unrelated.close(); await busy(base);
  await finish(owner.spawned);
  const free = await acquire(base); await free.close(); emit({ case: "L1", result: "pass" });

  const killed = child("owner", "ordinary"), message = await killed.ready;
  assert(typeof message === "object" && message !== null && "ordinaryPid" in message && typeof message.ordinaryPid === "number", "ordinary ready");
  const identity = await processIdentity(message.ordinaryPid); assert(identity !== null, "ordinary identity");
  orphan = { pid: message.ordinaryPid, identity };
  killed.spawned.kill("SIGKILL"); await killed.spawned.exited; children.delete(killed.spawned);
  assert(killed.spawned.signalCode === "SIGKILL", "owner signal");
  assert(await processIdentity(orphan.pid) === orphan.identity, "ordinary alive after owner exit");
  const released = await acquire(base); await released.close(); await stopOrphan();
  const descriptor = await open(join(root, ".admission.lock"), constants.O_RDWR | constants.O_NOFOLLOW);
  await rawLock(descriptor.fd);
  const inherited = child("hold", "admission", descriptor.fd); await inherited.ready;
  await descriptor.close(); await busy(base); await finish(inherited.spawned);
  const afterInherited = await acquire(base); await afterInherited.close(); emit({ case: "L2", result: "pass" });

  await writeFile(join(root, "offset-control"), "AB", { flag: "wx", mode: 0o600 });
  const offset = await open(join(root, "offset-control"), constants.O_RDONLY | constants.O_NOFOLLOW);
  const reader = child("offset", "admission", offset.fd);
  assert(await reader.ready === "A", "child offset byte");
  assert(await reader.spawned.exited === 0, "offset child exit"); children.delete(reader.spawned);
  const byte = Buffer.alloc(1); await offset.read(byte, 0, 1, null); assert(byte.toString() === "B", "shared description offset");
  await offset.close(); emit({ case: "L3", result: "pass" });

  const aPolicy = parseJournalLockPolicy({ ...base, scope: { type: "receipt", receiptId: receiptA } });
  const a = await acquire(aPolicy), b = await acquire(parseJournalLockPolicy({ ...base, scope: { type: "receipt", receiptId: receiptB } }));
  try { await busy(aPolicy); await a.recheck(); await b.recheck(); } finally { await a.close(); await b.close(); }
  emit({ case: "L4-concurrent-receipts", result: "pass" });
  let helperObserved = false;
  const wrongPin = beginJournalLock({ ...base, flock: { ...base.flock, sha256: "0".repeat(64) } }, () => { helperObserved = true; });
  const cleaned = wrongPin.settled.then(() => true, () => false);
  const rejected = await wrongPin.ready.then(async value => { await value.close(); return false; }, () => true);
  assert(rejected && await cleaned && !helperObserved, "wrong pin before spawn");
  emit({ case: "L4-wrong-pin", result: "pass" });
  for (const scenario of ["kill", "timeout", "observer-error"]) await helperFailure(base, scenario);

}

async function helperFailure(base: JournalLockPolicy, scenario: string) {
  const observed = Promise.withResolvers<number>();
  const pending = beginJournalLock(base, pid => {
    process.kill(pid, "SIGSTOP"); observed.resolve(pid);
    if (scenario === "observer-error") throw new Error("synthetic observer error");
  });
  const outcome = pending.ready.then(async owner => { await owner.close(); return "unexpected-owner"; }, error => error instanceof Error ? error.message : "unknown");
  const settlement = pending.settled.then(() => true, () => false);
  const pid = await Promise.race([observed.promise, outcome.then(() => -1)]);
  let stopped = false;
  if (pid > 0) {
    const until = performance.now() + 1000;
    while (performance.now() < until) {
      const state = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
      if (/^State:\s+T/m.test(state)) { stopped = true; break; }
      if (!state) break;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
  if (stopped && scenario === "kill") process.kill(pid, "SIGKILL");
  const result = await outcome;
  assert(pid > 0, "observer reached exact helper");
  assert(await settlement, "helper cleanup settlement");
  if (pid > 0) assert(await processIdentity(pid) === null, "exact helper exited and reaped");
  if (!stopped && scenario !== "observer-error") {
    emit({ case: `L4-${scenario}`, result: "unproven", reason: "fast helper was not observed stopped" }); throw new Error("L4 gate remains unproven");
  }
  assert(result === "capability_unavailable", "failure cannot grant owner");
  const next = await acquire(base); await next.close();
  emit({ case: `L4-${scenario}`, result: "pass", observedStopped: stopped });
}

if (process.platform !== "linux") throw new Error("Linux fixture only");
const watchdog = setTimeout(() => { void cleanup().finally(() => process.exit(124)); }, 25000);
try {
  if (mode === "inventory") await inventory();
  else if (mode === "proof") await proof();
  else if (mode === "owner") { await ownerMode(); await new Promise(() => {}); }
  else if (mode === "hold") {
    process.on("message", message => { if (message === "close") process.exit(0); else process.exit(2); });
    process.send?.("ready"); await new Promise(() => {});
  } else if (mode === "offset") {
    const byte = Buffer.alloc(1); const { readSync } = await import("node:fs");
    assert(readSync(0, byte, 0, 1, null) === 1, "offset input"); process.send?.(byte.toString());
  } else throw new Error("fixed fixture mode required");
} finally {
  clearTimeout(watchdog); await cleanup();
  if (mode === "proof") emit({ case: "fixture-cleanup", directChildren: children.size, orphanRemaining: orphan !== undefined });
}
