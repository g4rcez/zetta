// Synthetic launcher failure scenarios; never imported by application startup.
import { uuidv7 } from "../packages/core/src/uuid";
import { closeSync, copyFileSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { capture, createArgs, ENDPOINT, IMAGE, INSPECT, LABEL, localImage, validatePolicy } from "./execution-isolation-probe";

const PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin";
const repository = realpathSync(join(import.meta.dir, ".."));
const name = z.string().regex(/^zetta-rfc002-[a-f0-9-]{36}$/);
const journalSchema = z.strictObject({ token: z.uuid(), A: name, B: name, markerA: z.uuid(), markerB: z.uuid() });
type Journal = z.infer<typeof journalSchema>;
const stateSchema = z.object({ Id: z.string().regex(/^[a-f0-9]{64}$/), Name: z.string(), label: z.string(), state: z.object({ Running: z.boolean(), Pid: z.number().int() }) });
class RecoveryBlocked extends Error { constructor() { super("recovery blocked"); } }
export class PendingCreate extends Error { constructor() { super("create outcome unresolved"); } }
const requireTrue = (value: boolean) => { if (!value) throw new RecoveryBlocked(); };

function load(root: string): Journal {
  requireTrue(dirname(root) === repository && /^\.zetta-isolation-test-recovery-[A-Za-z0-9]+$/.test(basename(root)));
  requireTrue(realpathSync(root) === root && lstatSync(root).isDirectory());
  const file = join(root, "recovery.json");
  requireTrue(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
  return journalSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
function save(root: string, journal: Journal) {
  const temporary = join(root, "recovery.next");
  const fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(journal)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, join(root, "recovery.json"));
  const directory = openSync(root, "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
function runtime(root: string) {
  const env = { PATH, HOME: join(root, "docker"), DOCKER_CONFIG: join(root, "docker"), LANG: "C" };
  const cli = async (args: string[]) => {
    const result = await capture(["docker", "--host", ENDPOINT, ...args], env, 3000);
    requireTrue(result.exit === 0 && result.reason === "exit");
    return result.output.trim();
  };
  const inspect = async (container: string) => JSON.parse(await cli(["container", "inspect", "--format", INSPECT, container]));
  return { env, cli, inspect };
}

/** Pending CREATE is quarantined before even inspecting or removing a resource. */
export async function reconcileOwned(root: string, settled: boolean) {
  if (!settled) throw new PendingCreate();
  const journal = load(root), { cli, inspect } = runtime(root);
  const state = stateSchema.parse(await inspect(journal.A));
  requireTrue(state.Name === `/${journal.A}` && state.label === journal.token);
  await cli(["container", "rm", "--force", state.Id]);
}

async function create(root: string, actor: "A" | "B") {
  const journal = load(root), { env, cli, inspect } = runtime(root);
  const image = localImage(await capture(["docker", "--host", ENDPOINT, "image", "inspect", "--format", '{"id":{{json .Id}},"env":{{json .Config.Env}}}', IMAGE], env, 3000));
  const input = join(root, actor), mode = "deadline", marker = actor === "A" ? journal.markerA : journal.markerB;
  await cli(createArgs(journal[actor], journal.token, input, actor, mode, marker));
  const overrides = [`PATH=${PATH}`, "HOME=/scratch", `FIXTURE_TOKEN=${marker}`];
  validatePolicy(await inspect(journal[actor]), { name: journal[actor], token: journal.token, input, actor, mode, env: [...image.env.filter(entry => !overrides.some(value => value.split("=")[0] === entry.split("=")[0])), ...overrides] });
  await cli(["container", "start", journal[actor]]);
}

async function owner(root: string, delayed: boolean) {
  load(root);
  if (delayed) {
    await new Promise<void>(resolve => {
      const receive = (value: unknown) => { if (value === "create") { process.off("message", receive); resolve(); } };
      process.on("message", receive);
      process.send?.("waiting");
    });
  }
  await create(root, "A");
  process.send?.("ready");
  setInterval(() => {}, 1000);
}

async function interruptOwner(root: string, signal: "SIGKILL" | "SIGINT" | "SIGTERM", delayed = false) {
  const { env } = runtime(root);
  let ready = false, waiting = false;
  let resolveReady: (() => void) | undefined, resolveWaiting: (() => void) | undefined;
  const readySignal = new Promise<void>(resolve => { resolveReady = resolve; });
  const waitingSignal = new Promise<void>(resolve => { resolveWaiting = resolve; });
  const child = Bun.spawn([process.execPath, "--no-env-file", import.meta.path, "--owned-launcher", root, delayed ? "delayed" : "immediate"], {
    env, stdin: "ignore", stdout: "ignore", stderr: "ignore",
    ipc(message) {
      if (message === "waiting" && !waiting) { waiting = true; resolveWaiting?.(); }
      if (message === "ready" && !ready) { ready = true; resolveReady?.(); }
    },
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 12_000);
  try {
    const exited = child.exited.then(() => { throw new RecoveryBlocked(); });
    if (delayed) {
      await Promise.race([waitingSignal, exited]);
      let quarantined = false;
      try { await reconcileOwned(root, false); }
      catch (error) { if (!(error instanceof PendingCreate)) throw error; quarantined = true; }
      requireTrue(quarantined);
      child.send("create");
    }
    await Promise.race([readySignal, exited]);
    child.kill(signal);
    requireTrue(await child.exited !== 0 && ready);
  } finally { clearTimeout(deadline); if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; } }
}

export async function runRecoveryProbe() {
  const root = mkdtempSync(join(repository, ".zetta-isolation-test-recovery-"));
  const cases: { case: string; passed: boolean }[] = [];
  let passed = false, cleanup = false, creationSettled = false;
  const journal: Journal = { token: uuidv7(), A: `zetta-rfc002-${uuidv7()}`, B: `zetta-rfc002-${uuidv7()}`, markerA: uuidv7(), markerB: uuidv7() };
  const owned = new Set([journal.B]);
  try {
    mkdirSync(join(root, "docker"), { mode: 0o700 });
    for (const actor of ["A", "B"] as const) {
      mkdirSync(join(root, actor), { mode: 0o755 });
      copyFileSync(new URL("./fixtures/execution-isolation-payload.ts", import.meta.url), join(root, actor, "probe.ts"));
      writeFileSync(join(root, actor, "canary"), actor === "A" ? journal.markerA : journal.markerB, { mode: 0o444 });
    }
    save(root, journal);
    await create(root, "B");
    creationSettled = true;
    const { cli, inspect } = runtime(root);
    for (const signal of ["SIGKILL", "SIGINT", "SIGTERM", "delayed"] as const) {
      journal.A = `zetta-rfc002-${uuidv7()}`;
      owned.add(journal.A);
      save(root, journal);
      creationSettled = false;
      await interruptOwner(root, signal === "delayed" ? "SIGKILL" : signal, signal === "delayed");
      creationSettled = true;
      requireTrue(stateSchema.parse(await inspect(journal.A)).state.Running);
      await reconcileOwned(root, true);
      owned.delete(journal.A);
      await cli(["container", "exec", "--user=65534:65534", journal.B, "/usr/local/bin/bun", "--no-env-file", "/input/probe.ts", "health"]);
      requireTrue(stateSchema.parse(await inspect(journal.B)).state.Running);
      cases.push({ case: `reconcile-${signal.toLowerCase()}`, passed: true });
    }
    passed = true;
  } catch { // no-excuse-ok: catch -- boundary emits fixed categories, never private daemon output.
    cases.push({ case: "reconciliation-blocked", passed: false });
  } finally {
    try {
      const { cli, inspect } = runtime(root);
      const ids = (await cli(["container", "ls", "--all", "--no-trunc", "--filter", `label=${LABEL}=${journal.token}`, "--format", "{{.ID}}"])).split("\n").filter(Boolean);
      for (const id of ids) {
        const state = stateSchema.parse(await inspect(id));
        requireTrue(state.label === journal.token && owned.has(state.Name.slice(1)));
        await cli(["container", "rm", "--force", state.Id]);
      }
      cleanup = creationSettled;
      if (cleanup) rmSync(root, { recursive: true });
    } catch { // no-excuse-ok: catch -- preserve failed cleanup explicitly for operator reconciliation.
      cleanup = false;
    }
  }
  return { cases, passed, cleanup };
}

if (import.meta.main) {
  const root = process.argv[3];
  if (process.argv[2] !== "--owned-launcher" || !root || !["immediate", "delayed"].includes(process.argv[4] ?? "") || process.argv.length !== 5) process.exit(1);
  setTimeout(() => process.exit(1), 15_000);
  try { await owner(root, process.argv[4] === "delayed"); }
  catch { process.exit(1); } // no-excuse-ok: catch -- subprocess outputs no raw private failures.
}
