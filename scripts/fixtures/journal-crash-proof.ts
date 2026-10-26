import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { assert, boundary, bytes, cases, guard, names, parseRow, suite } from "./journal-crash-contract";
import type { Case } from "./journal-crash-contract";

const pins = { writer: "36ec2d8ef052fe142f7d1c033e96822347a8a21898cd6aa732b6437d350a0e29", recovery: "13c17ca61637edec15d71fd5fc3a2a4541374b2e2684eb1e1e629d1824b37f46" };
type Identity = { pid: number; ppid: number; pgid: number; session: number; start: string };
async function identity(pid: number): Promise<Identity> {
  const handle = await open(`/proc/${pid}/stat`, "r");
  let raw: string;
  try {
    const buffer = Buffer.alloc(8193); let length = 0;
    while (length < buffer.length) { const result = await handle.read(buffer, length, buffer.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
    assert(length > 0 && length <= 8192); raw = buffer.subarray(0, length).toString("utf8");
  } finally { await handle.close(); }
  const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
  const ppid = Number(fields[1]), pgid = Number(fields[2]), session = Number(fields[3]), start = fields[19];
  assert(start && /^[0-9]+$/.test(start) && ppid > 0 && pgid > 0 && session > 0);
  return { pid, ppid, pgid, session, start };
}
function same(a: Identity, b: Identity) { return JSON.stringify(a) === JSON.stringify(b); }
let totalBytes = 0;
function output(value: unknown) {
  const line = JSON.stringify(value) + "\n"; totalBytes += Buffer.byteLength(line);
  assert(totalBytes <= 49152); process.stdout.write(line);
}
async function child(role: "writer" | "recovery", id: Case) {
  const processChild = spawn("/usr/local/bin/bun", ["--no-env-file", `${suite}/${role}.mjs`, id], {
    cwd: suite, env: { LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"], detached: false,
  });
  let reaped = false, count = 0, stderr = "", pending = "", live: Identity | undefined, killedAtMs: number | null = null;
  const rows: ReturnType<typeof parseRow>[] = [];
  const cut = Promise.withResolvers<void>(), bad = Promise.withResolvers<never>();
  void cut.promise.catch(() => {}); void bad.promise.catch(() => {});
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    processChild.once("error", reject);
    processChild.once("exit", (code, signal) => { reaped = true; resolve({ code, signal }); });
  });
  void exit.catch(() => {});
  const stdout = (async () => {
    for await (const chunk of processChild.stdout) {
      count += chunk.length; assert(count <= 8192); pending += chunk.toString();
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        const row = parseRow(pending.slice(0, end)); pending = pending.slice(end + 1);
        assert(row.case === id && row.pid === processChild.pid && rows.length < 3);
        rows.push(row);
        if (role === "writer") {
          assert(rows[0]?.type === "ready");
          if (row.type === "effect") assert(id === "C8-effect" && rows.length === 2);
          if (row.type === "cut") { assert(row.boundary === boundary(id) && rows.length === (id === "C8-effect" ? 3 : 2)); cut.resolve(); }
          else assert(row.type === "ready" && rows.length === 1 || row.type === "effect");
        } else assert(row.type === "recovered" && rows.length === 1);
      }
    }
    assert(pending === "");
  })();
  const errors = (async () => {
    for await (const chunk of processChild.stderr) { count += chunk.length; assert(count <= 8192); stderr += chunk.toString(); }
  })();
  void stdout.catch(bad.reject); void errors.catch(bad.reject);
  const settled = Promise.all([exit, stdout, errors]); void settled.catch(() => {});
  const deadline = setTimeout(() => bad.reject(new Error("child_deadline")), role === "writer" ? 8000 : 15000);
  try {
    assert(processChild.pid); live = await identity(processChild.pid);
    assert(live.ppid === process.pid && !reaped);
    output({ type: "owned-child", role, case: id, identity: live });
    if (role === "writer") {
      await Promise.race([cut.promise, bad.promise, exit.then(() => { throw new Error("early_exit"); })]);
      const last = rows.at(-1); assert(last?.type === "cut" && Date.now() - last.atMs >= 0 && Date.now() - last.atMs < 1000);
      assert(!reaped && same(live, await identity(live.pid)) && !reaped);
      assert(processChild.kill("SIGKILL")); killedAtMs = Date.now();
    }
    const result = await Promise.race([settled, bad.promise]);
    assert(reaped && stderr === "");
    if (role === "writer") assert(result[0].signal === "SIGKILL" && result[0].code === null);
    else assert(result[0].code === 0 && result[0].signal === null && rows.length === 1);
    return { identity: live, rows, exit: result[0], streamsSettled: true, killedAtMs };
  } catch {
    if (live && !reaped) {
      try { if (same(live, await identity(live.pid)) && !reaped) processChild.kill("SIGKILL"); } catch {}
    }
    await Promise.race([Promise.allSettled([exit, stdout, errors]), new Promise(resolve => setTimeout(resolve, 3000))]);
    throw new Error("child_unproved");
  } finally { clearTimeout(deadline); }
}
async function proof() {
  for (const role of ["writer", "recovery"] as const) {
    const data = await bytes(`${suite}/${role}.mjs`, 2000000, 0, 0o444);
    assert(new Bun.CryptoHasher("sha256").update(data).digest("hex") === pins[role]);
  }
  let effects = 0;
  for (const id of cases) {
    const writer = await child("writer", id);
    effects += writer.rows.filter(row => row.type === "effect").length;
    assert(effects === (id === "C8-effect" ? 1 : 0));
    const recovery = await child("recovery", id);
    assert(writer.identity.pid !== recovery.identity.pid);
    const row = recovery.rows[0]; assert(row?.type === "recovered");
    const expected = id === "C0-insert" ? "empty" : ["C1-insert", "C2-insert", "C3-insert", "C4-sync-insert", "C4-insert", "C3-replace", "C4-sync-replace", "C4-replace"].includes(id)
      ? "blocked" : id.endsWith("insert") || id === "C0-replace" ? "inert" : "unknown";
    assert(row.disposition === expected);
    output({ type: "case", case: id, result: "pass", boundary: boundary(id), captured: true, effects, writerExit: writer.exit, recoveryExit: recovery.exit, streamsSettled: true,
      cut: writer.rows.at(-1), killedAtMs: writer.killedAtMs, recovery: row });
  }
  const own = await identity(process.pid), others: number[] = [];
  for (const name of await names("/proc", 8192)) {
    if (!/^[0-9]+$/.test(name) || Number(name) === process.pid) continue;
    try { const candidate = await identity(Number(name)); if ((candidate.pgid === own.pgid || candidate.session === own.session) && candidate.pid !== own.ppid) others.push(candidate.pid); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  }
  assert(others.length === 0);
  output({ type: "complete", result: "pass", cases: cases.length, effects, children: others, identity: own });
}
if (import.meta.main) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    guard("proof"); timer = setTimeout(() => { output({ type: "unproved", retained: true }); process.exit(124); }, 180000);
    await proof();
  } catch { output({ type: "unproved", retained: true }); process.exitCode = 1; }
  finally { if (timer) clearTimeout(timer); }
}
