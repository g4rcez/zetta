import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { z } from "zod";
import { createFixtureLaunchPolicy } from "../../apps/server/src/modules/runtime/launch-recipe";

export const suite = "/var/lib/zetta-crash-proof-f362b8a1-12a5-4c43-8c97-7d4bda56a183";
export const cases = ["C0-insert", "C1-insert", "C2-insert", "C3-insert", "C4-sync-insert", "C4-insert", "C5-insert", "C6-insert", "C7-insert",
  "C0-replace", "C3-replace", "C4-sync-replace", "C4-replace", "C5-replace", "C6-replace", "C7-replace", "C8-effect"] as const;
export const caseSchema = z.enum(cases);
export type Case = z.infer<typeof caseSchema>;
export const operationId = "33333333-3333-4333-8333-333333333333";
export const policy = createFixtureLaunchPolicy({ installationId: "crash-f362b8a1", policyVersion: "crash-v1", image: `sha256:${"1".repeat(64)}` });
export function assert(value: unknown): asserts value { if (!value) throw new Error("fixture_assertion"); }
export function options(id: Case) {
  return { lock: { root: `${suite}/${id}/journal`, uid: 1000, bunVersion: "1.3.14", bunRevision: "0d9b296af33f2b851fcbf4df3e9ec89751734ba4",
    flock: { sourceVersion: "2.39.3", sha256: "b991f23fbc6a3928a86977d87a6c4fd14acc44cfe90ce7cb8f5dcab4d8a49fbf", byteLength: 67816 } }, policy };
}
export function guard(role: "writer" | "recovery" | "proof"): Case | undefined {
  assert(process.platform === "linux" && process.arch === "arm64" && process.getuid?.() === 1000 && Bun.version === "1.3.14"
    && Bun.revision === "0d9b296af33f2b851fcbf4df3e9ec89751734ba4");
  assert(process.argv[1] === `${suite}/${role}.mjs` && process.argv.length === (role === "proof" ? 2 : 3));
  return role === "proof" ? undefined : caseSchema.parse(process.argv[2]);
}
export async function names(path: string, limit: number) {
  const result: string[] = [];
  for await (const entry of await opendir(path)) { assert(result.length < limit); result.push(entry.name); }
  return result.sort();
}
export async function bytes(path: string, limit = 16384, uid = 1000, mode = 0o600) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    assert(before.isFile() && before.uid === uid && before.nlink === 1 && (before.mode & 0o7777) === mode && before.size <= limit);
    const data = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < data.length) { const read = await file.read(data, offset, data.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
    const after = await file.stat(), named = await lstat(path);
    assert(offset === before.size && after.ino === before.ino && after.dev === before.dev && after.size === before.size
      && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs && named.ino === before.ino && named.dev === before.dev);
    return data.subarray(0, offset);
  } finally { await file.close(); }
}
export function request(id: Case, now: number) {
  return { version: 1, context: { actorId: "synthetic-actor", runId: id, attemptId: id, botId: "fixture-bot", conversationId: "fixture-chat", configurationId: "fixture-config" },
    leaseId: `${id}-lease`, fence: 1, recipe: "fixture-v1", fixtureCase: "echo", policyVersion: policy.policyVersion, deadlineEpochMs: now + 60000,
    budgets: { deadlineMs: 60000, maxInputBytes: 65536, maxOutputBytes: 65536, maxFrameBytes: 8192 } };
}
const entriesSchema = z.array(z.strictObject({ name: z.enum([".writer.lock", "record.json", "record.next"]), size: z.number().int().nonnegative().max(16384), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(3).refine(entries => entries.every((entry, index) => index === 0 || entry.name > (entries[index - 1]?.name ?? "")));
const base = { case: caseSchema, pid: z.number().int().positive() };
export const rowSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("ready") }),
  z.strictObject({ ...base, type: z.literal("cut"), boundary: z.enum(["before_mkdir", "after_mkdir", "after_root_sync", "before_stage", "partial_write", "after_file_sync", "after_close", "after_rename", "after_directory_sync", "after_readback", "synthetic_effect"]), captured: z.literal(true), atMs: z.number().int().positive() }),
  z.strictObject({ ...base, type: z.literal("effect"), synthetic: z.literal(true), count: z.literal(1) }),
  z.strictObject({ ...base, type: z.literal("recovered"), disposition: z.enum(["empty", "blocked", "inert", "unknown"]), receiptId: z.string().uuid().nullable(), submissionPaths: z.literal(false), initialEntries: entriesSchema, finalEntries: entriesSchema }),
]);
export function parseRow(line: string) { assert(Buffer.byteLength(line) <= 4096); const raw: unknown = JSON.parse(line); assert(JSON.stringify(raw) === line); return rowSchema.parse(raw); }
export function emit(row: z.infer<typeof rowSchema>) { process.stdout.write(JSON.stringify(rowSchema.parse(row)) + "\n"); }
export function boundary(id: Case) {
  if (id === "C8-effect") return "synthetic_effect";
  if (id.startsWith("C0")) return id.endsWith("insert") ? "before_mkdir" : "before_stage";
  switch (id.slice(0, 2)) {
    case "C1": return "after_mkdir";
    case "C2": return "after_root_sync";
    case "C3": return "partial_write";
    case "C4": return id.includes("-sync-") ? "after_file_sync" : "after_close";
    case "C5": return "after_rename";
    case "C6": return "after_directory_sync";
    case "C7": return "after_readback";
    default: throw new Error("selector");
  }
}
