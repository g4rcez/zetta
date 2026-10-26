// Fixed parent/writer/reader proof. No production imports or IO run merely by importing this file.
import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { parseRunDto, parseRunResultDto, runUuidSchema } from "./run-contract";
import { requireIdentityAuthProofTarget } from "../identity/signup.integration";

const messageSchema = z.strictObject({ kind: z.enum(["committed", "verified"]), pid: z.number().int().positive(), backendPid: z.number().int().positive(),
  dto: z.unknown().transform(parseRunDto), result: z.unknown().transform(value => parseRunResultDto(value, 10)),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), otherRunId: runUuidSchema, otherAttemptId: runUuidSchema, denials: z.number().int(),
}).refine(v => v.dto.id === v.result.runId && v.dto.attemptId === v.result.attemptId
  && v.dto.generation === v.result.generation && v.dto.status === v.result.status && v.dto.effectState === v.result.effectState
  && v.dto.finishedAtMs === v.result.finishedAtMs && v.denials === (v.kind === "committed" ? 0 : 6));
type Message = z.infer<typeof messageSchema>;
type Child = Bun.Subprocess<"ignore", "pipe", "pipe">;
export function parseRestartMessage(text: string): Message {
  try { assert.ok(Buffer.byteLength(text) <= 16384); return messageSchema.parse(JSON.parse(text)); }
  catch { throw new Error("Restart message unavailable."); }
}
function observe(child: Child) {
  const first = Promise.withResolvers<Message>();
  const stdout = (async () => {
    let text = "", sent = false; const decoder = new TextDecoder();
    for await (const bytes of child.stdout) {
      text += decoder.decode(bytes, { stream: true }); assert.ok(Buffer.byteLength(text) <= 16384);
      if (text.includes("\n") && !sent) { assert.equal(text.indexOf("\n"), text.length - 1); first.resolve(parseRestartMessage(text.trimEnd())); sent = true; }
    }
    text += decoder.decode(); assert.ok(sent); assert.equal(text.split("\n").length, 2); assert.equal(text.endsWith("\n"), true);
  })();
  const stderr = (async () => { let size = 0; for await (const bytes of child.stderr) { size += bytes.byteLength; assert.ok(size <= 1024); } assert.equal(size, 0); })();
  const done = Promise.all([stdout, stderr]).then(() => true, () => { first.reject(new Error("Child output unavailable.")); child.kill("SIGKILL"); return false; });
  return { message: first.promise, done };
}
async function childPhase(phase: "write" | "read", connectionString: string) {
  const parentPid = Number(process.env["ZETTA_RUN_RESTART_PARENT_PID"]); assert.ok(Number.isSafeInteger(parentPid) && parentPid > 0);
  const { openRunReadbackProof, forbidRunProofIO } = await import("../../../../../packages/db/src/run-readback-proof-client");
  const proof = await openRunReadbackProof(connectionString, parentPid, phase);
  let guard: Awaited<ReturnType<typeof forbidRunProofIO>> | undefined;
  try {
    guard = await forbidRunProofIO();
    const { createRunStore, applyRunTransition } = await import("./runs");
    const { createIdentityAccess, createMembershipLookup } = await import("../identity/access");
    const { readRunRows } = await import("./run-rows");
    const { and, eq, sql } = await import("@zetta/db/query");
    const { membership } = await import("@zetta/db/schema/identity");
    const { runs, runAttempts } = await import("@zetta/db/schema/runs");
    const access = createIdentityAccess({ api: { getSession: async ({ headers }) => {
      const id = headers.get("x-synthetic-actor"); return id && ["owner-a", "owner-b", "owner-admin"].includes(id) ? { user: { id } } : null;
    } } }, createMembershipLookup(proof.db));
    const a = await access.requireActive(new Headers({ "x-synthetic-actor": "owner-a" }));
    const store = createRunStore(proof.db);
    let expected: Message;
    if (phase === "write") {
      const request = () => ({ requestKey: randomUUID(), origin: "interactive", botId: "bot", conversationId: "conversation", configurationId: "configuration", configurationVersion: 1,
        input: { prompt: "Synthetic restart private prompt", harness: "fixture", connections: [], model: null, resumeReference: null,
          budgets: { deadlineMs: 1000, maxEvents: 10, maxOutputBytes: 1000, maxToolBytes: 100, maxToolCalls: 1 } } });
      const run = await store.submitOwned(a, request()), other = await store.submitOwned(a, request());
      await proof.db.transaction(async tx => {
        const [member] = await tx.select().from(membership).where(eq(membership.userId, a.userId)).for("update"); assert.equal(member?.status, "active");
        for (const type of ["claimed", "admitted", "completed"] as const) {
          const [row] = await tx.select().from(runs).where(and(eq(runs.id, run.id), eq(runs.ownerUserId, a.userId))).for("update"); assert.ok(row);
          const [attempt] = await tx.select().from(runAttempts).where(and(eq(runAttempts.runId, row.id), eq(runAttempts.ownerUserId, a.userId), eq(runAttempts.generation, row.currentGeneration))).for("update");
          const state = readRunRows(row, attempt).state;
          const [clock] = await tx.select({ now: sql<string>`floor(extract(epoch from clock_timestamp())*1000)::text` }).from(membership).where(eq(membership.userId, a.userId));
          const atMs = Number(clock?.now); assert.ok(Number.isSafeInteger(atMs));
          const fact = type === "claimed" ? { type, atMs, leaseId: randomUUID(), leaseExpiresAtMs: atMs + 60000 }
            : type === "admitted" ? { type, atMs } : { type, atMs, outcome: "succeeded" as const, result: { version: 1 as const, text: "Synthetic restart result", errorCode: null, lastSequence: 3 } };
          await applyRunTransition(tx, a.userId, { runId: state.runId, attemptId: state.attemptId, generation: state.generation, leaseId: state.leaseId, expectedRevision: state.revision }, fact);
        }
      }, { isolationLevel: "read committed" });
      const dto = await store.getOwned(a, { runId: run.id }), result = await store.getResultOwned(a, { runId: run.id, attemptId: run.attemptId });
      expected = { kind: "committed", pid: process.pid, backendPid: proof.pid, dto, result, fingerprint: "0".repeat(64), otherRunId: other.id, otherAttemptId: other.attemptId, denials: 0 };
    } else {
      expected = parseRestartMessage(process.env["ZETTA_RUN_RESTART_EXPECTED"] ?? ""); assert.equal(expected.kind, "committed");
      const dto = await store.getOwned(a, { runId: expected.dto.id });
      const result = await store.getResultOwned(a, { runId: expected.dto.id, attemptId: expected.dto.attemptId });
      assert.deepEqual(dto, expected.dto); assert.deepEqual(result, expected.result);
      let denials = 0;
      const deny = async (work: () => Promise<unknown>) => {
        let denied = false; try { await work(); } catch (error) { denied = error instanceof Error && "code" in error && error.code === "not_found"; }
        assert.equal(denied, true); denials++;
      };
      for (const id of ["owner-b", "owner-admin"]) {
        const actor = await access.requireActive(new Headers({ "x-synthetic-actor": id }));
        if (id === "owner-admin") assert.equal(actor.isAdmin, true);
        await deny(() => store.getOwned(actor, { runId: dto.id }));
        await deny(() => store.getResultOwned(actor, { runId: dto.id, attemptId: dto.attemptId }));
      }
      await deny(() => store.getResultOwned(a, { runId: dto.id, attemptId: expected.otherAttemptId }));
      await deny(() => store.getResultOwned(a, { runId: expected.otherRunId, attemptId: dto.attemptId }));
      expected = { ...expected, kind: "verified", pid: process.pid, backendPid: proof.pid, dto, result, denials };
    }
    const stored = (await proof.client.query<{ input_snapshot: string; configuration_id: string; configuration_version: number }>(
      "select input_snapshot,configuration_id,configuration_version from runs where owner_user_id='owner-a' and id=$1", [expected.dto.id])).rows[0]; assert.ok(stored);
    const fingerprint = createHash("sha256").update(JSON.stringify(stored)).digest("hex");
    if (phase === "read") assert.equal(fingerprint, expected.fingerprint);
    const message = parseRestartMessage(JSON.stringify({ ...expected, fingerprint })); proof.healthy(); guard.healthy();
    if (phase === "read") await proof.close();
    process.stdout.write(JSON.stringify(message) + "\n");
    if (phase === "write") await new Promise<never>(() => {});
  } finally { try { await proof.close(); guard?.healthy(); } finally { guard?.restore(); } }
}
export async function runRestartProof() {
  let phase = "target validation";
  const children = new Set<Child>();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const role = process.env["ZETTA_RUN_RESTART_PHASE"];
    assert.ok(role === undefined || role === "write" || role === "read");
    deadline = setTimeout(async () => {
      for (const child of children) child.kill("SIGKILL");
      await Promise.allSettled([...children].map(child => child.exited));
      process.stderr.write("Run restart proof deadline exceeded; details suppressed.\n"); process.exit(1);
    }, role ? 30000 : 120000);
    if (role) { phase = "child execution"; await childPhase(role, target.connectionString); return; }
    phase = "fresh parent baseline";
    const { openRunProof } = await import("../../../../../packages/db/src/run-proof-client");
    const { forbidRunProofIO } = await import("../../../../../packages/db/src/run-readback-proof-client");
    const proof = await openRunProof(target.connectionString);
    let guard: Awaited<ReturnType<typeof forbidRunProofIO>> | undefined;
    try {
      guard = await forbidRunProofIO();
      const parentPid = (await proof.owner.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid; assert.ok(parentPid);
      await proof.owner.query(`insert into "user"(id,name,email,email_verified,created_at,updated_at)
        select id,id,id||'@restart.invalid',true,now(),now() from unnest(array['owner-a','owner-b','owner-admin']) id;
        insert into membership(user_id,status,joined_at,updated_at) select id,'active',now(),now() from "user";
        insert into installation_identity(id,admin_user_id,admin_membership_status,bootstrapped_at) values(1,'owner-admin','active',now())`);
      function spawn(role: "write" | "read", expected?: Message) {
        const env = { NODE_ENV: "development", ZETTA_TEST_DATABASE_URL: target.connectionString, ZETTA_TEST_DATABASE_ALLOW_MUTATION: "identity-tests",
          ZETTA_RUN_RESTART_PHASE: role, ZETTA_RUN_RESTART_PARENT_PID: String(parentPid), ...(expected ? { ZETTA_RUN_RESTART_EXPECTED: JSON.stringify(expected) } : {}) };
        const child = Bun.spawn([process.execPath, "--no-env-file", import.meta.path], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        children.add(child); return { child, observed: observe(child) };
      }
      phase = "writer committed signal";
      const writer = spawn("write"), committed = await writer.observed.message;
      assert.equal(committed.kind, "committed"); assert.equal(committed.pid, writer.child.pid); assert.notEqual(committed.backendPid, parentPid);
      const present = (await proof.owner.query<{ present: boolean }>("select exists(select 1 from pg_stat_activity where pid=$1 and application_name='zetta-run-restart-write') as present", [committed.backendPid])).rows[0]?.present;
      assert.equal(present, true); assert.equal(writer.child.exitCode, null);
      writer.child.kill("SIGKILL"); await writer.child.exited; assert.equal(writer.child.signalCode, "SIGKILL"); assert.equal(await writer.observed.done, true); children.delete(writer.child);
      phase = "killed writer backend disappearance";
      const until = performance.now() + 4000;
      while ((await proof.owner.query<{ present: boolean }>("select exists(select 1 from pg_stat_activity where pid=$1) as present", [committed.backendPid])).rows[0]?.present) assert.ok(performance.now() < until);
      process.stdout.write("PASS writer committed then exact process killed and reaped; backend disappeared\n");
      phase = "new reader process durable service readback";
      const reader = spawn("read", committed), verified = await reader.observed.message;
      assert.equal(await reader.child.exited, 0); assert.equal(await reader.observed.done, true); children.delete(reader.child);
      assert.equal(verified.kind, "verified"); assert.equal(verified.pid, reader.child.pid); assert.notEqual(verified.pid, committed.pid); assert.notEqual(verified.backendPid, committed.backendPid);
      assert.deepEqual(verified.dto, committed.dto); assert.deepEqual(verified.result, committed.result); assert.equal(verified.fingerprint, committed.fingerprint); assert.equal(verified.denials, 6);
      assert.equal((await proof.owner.query<{ present: boolean }>("select exists(select 1 from pg_stat_activity where pid=$1) as present", [verified.backendPid])).rows[0]?.present, false);
      process.stdout.write("PASS new process and client recovered identical DTO result canonical fingerprint and six ownership denials\n");
      phase = "fixture cleanup";
      await proof.owner.query('begin; delete from run_attempts; delete from runs; delete from installation_identity; delete from membership; delete from "user"; commit');
      proof.healthy(); guard.healthy();
    } finally {
      for (const child of children) { child.kill("SIGKILL"); await child.exited; } children.clear();
      try { await proof.close(); guard?.healthy(); } finally { guard?.restore(); }
    }
    process.stdout.write("PASS restart parent clients closed and exact children reaped; no new network attempts\n");
  } catch { process.stderr.write(`Run restart proof failed at ${phase}; details suppressed.\n`); process.exitCode = 1; }
  finally { for (const child of children) { child.kill("SIGKILL"); await child.exited; } if (deadline) clearTimeout(deadline); }
}
if (import.meta.main) await runRestartProof();
