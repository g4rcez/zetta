import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";
import { getTableColumns } from "drizzle-orm";
import { runs, runAttempts } from "./schema/runs";
import { decodeRunInput, canonicalRunInput } from "../../../apps/server/src/modules/runtime/run-contract";
import { assertRunProvenanceCatalog, assertRunProvenanceManifest, inspectRunProvenanceCatalog, RunProvenanceSetupError, seedRunLegacyProvenance, verifyRunLegacyProvenance, verifyRunProvenance, verifyRunProvenanceSources } from "./run-provenance-proof";

test("fixed source verifier accepts only the pinned asymmetric feature and old run lineage", async () => {
  await expect(verifyRunProvenanceSources()).resolves.toBeUndefined();
});
test("manifest comparison rejects every changed file, extra baseline SQL and altered layout", async () => {
  const folder = new URL("../run-provenance-test-migrations/", import.meta.url);
  const actual: { name: string; files: { name: string; hash: string }[] }[] = [];
  for (const name of (await readdir(folder)).sort()) {
    const files = [];
    for (const file of (await readdir(new URL(`${name}/`, folder))).sort()) {
      files.push({ name: file, hash: createHash("sha256").update(await readFile(new URL(`${name}/${file}`, folder))).digest("hex") });
    }
    actual.push({ name, files });
  }
  expect(() => assertRunProvenanceManifest(actual)).not.toThrow();
  for (const [i, entry] of actual.entries()) {
    for (const j of entry.files.keys()) {
      const changed = actual.map((m, mi) => ({ ...m, files: m.files.map((f, fi) => mi === i && fi === j ? { ...f, hash: "0".repeat(64) } : f) }));
      expect(() => assertRunProvenanceManifest(changed)).toThrow(/^Run provenance proof unavailable\.$/);
    }
  }
  for (const raw of [actual.slice(1), [...actual].reverse(), [...actual, actual[0]], null, 1n, {},
    actual.map((m, i) => i < 2 ? { ...m, files: [...m.files, { name: "migration.sql", hash: "0".repeat(64) }] } : m),
    actual.map((m, i) => i === 2 ? { ...m, files: m.files.slice(1) } : m),
    actual.map((m, i) => i === 3 ? { ...m, name: "foreign" } : m)]) {
    expect(() => assertRunProvenanceManifest(raw)).toThrow(/^Run provenance proof unavailable\.$/);
  }
});
test("observed PostgreSQL catalog rendering accepts grouped revision bounds and rejects changed logic or malformed facts", () => {
  const expression = "(((producer_kindISNULL)AND(producer_versionISNULL)AND(actor_activation_revisionISNULL))"
    + "OR((producer_kindISNOTNULL)AND(producer_versionISNOTNULL)AND(actor_activation_revisionISNOTNULL)"
    + "AND(producer_kind='fixture'::text)AND(producer_version=1)AND((actor_activation_revision>=1)AND(actor_activation_revision<=2147483647))))";
  const valid = { columns_ok: true, check_ok: true, check_expression: expression, function_ok: true, trigger_ok: true };
  expect(() => assertRunProvenanceCatalog(valid)).not.toThrow();
  for (const key of Object.keys(valid)) {
    const missing = Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key));
    expect(() => assertRunProvenanceCatalog(missing)).toThrow(/^Run provenance proof unavailable\.$/);
    for (const value of [false, null, undefined, "true", 1]) {
      expect(() => assertRunProvenanceCatalog({ ...valid, [key]: value })).toThrow(/^Run provenance proof unavailable\.$/);
    }
  }
  for (const value of [null, [], {}, { ...valid, extra: true }]) expect(() => assertRunProvenanceCatalog(value)).toThrow(/^Run provenance proof unavailable\.$/);
  for (const changed of [expression.replaceAll("(", "").replaceAll(")", ""), expression.replace("OR", "AND"),
    expression.replace("ISNOTNULL", "ISNULL"), expression.replace("'fixture'", "'native'"), expression.replace("<=2147483647", "<=2147483648"),
    expression.replace(")OR((", "OR((("), expression.replace("(actor_activation_revision>=1)AND", "(actor_activation_revision>=1)OR"),
    expression.replace("AND((actor_activation_revision>=1)AND(actor_activation_revision<=2147483647))", "AND(actor_activation_revision>=1)AND(actor_activation_revision<=2147483647)")]) {
    expect(() => assertRunProvenanceCatalog({ ...valid, check_expression: changed })).toThrow(/^Run provenance proof unavailable\.$/);
  }
});
test("normal setup applies the fixed feature after old baseline and closes clients on failure", async () => {
  const source = await Bun.file(new URL("./run-proof-client.ts", import.meta.url)).text();
  const apply = source.indexOf("await applyRunProvenance(proof.owner)");
  expect(source.indexOf("await verifyRunProvenanceSources()")).toBeLessThan(source.indexOf("await openConnectionProof(connectionString)"));
  expect(apply).toBeGreaterThan(source.indexOf("await migrate("));
  expect(apply).toBeLessThan(source.indexOf("return proof"));
  expect(source).toContain("await proof.close()");
  expect(source).not.toMatch(/callback/i);
});
test("only the distinct one-argument legacy entry seeds inside shared fresh setup before the common layer", async () => {
  const source = await Bun.file(new URL("./run-proof-client.ts", import.meta.url)).text();
  expect(source).toContain("openRunProofCore(connectionString, false)");
  expect(source).toContain("openRunProofCore(connectionString, true)");
  expect(source).not.toContain("export async function openRunProofCore");
  expect(source).toContain("if (legacyFixture) await seedRunLegacyProvenance(proof.owner)");
  const seed = source.indexOf("await seedRunLegacyProvenance(proof.owner)");
  const verify = source.indexOf("await verifyRunLegacyProvenance(proof.owner)");
  expect(seed).toBeGreaterThan(source.indexOf("await migrate("));
  expect(seed).toBeLessThan(source.indexOf("await applyRunProvenance(proof.owner)"));
  expect(verify).toBeGreaterThan(source.indexOf("const tables ="));
  expect(verify).toBeLessThan(source.indexOf("return proof"));
  const module = await import("./run-proof-client");
  expect(Object.keys(module).sort()).toEqual(["diagnoseRunProofSetup", "openRunLegacyProvenanceProof", "openRunProof"]);
  for (const entry of Object.values(module)) expect(entry.length).toBe(1);
});
function legacyClient(facts: Readonly<{ absent?: unknown; run_ok?: unknown; attempt_ok?: unknown }> = { absent: true, run_ok: true, attempt_ok: true }) {
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const client = Object.assign(new Client({ host: "127.0.0.1", port: 1, database: "offline", user: "synthetic", password: "synthetic" }), {
    release() {},
    async query(text: string, params: readonly unknown[] = []) {
      calls.push({ text, params });
      return { rows: text.includes(" as absent") ? [{ absent: facts.absent }]
        : text.includes(" as run_ok") ? [{ run_ok: facts.run_ok, attempt_ok: facts.attempt_ok }] : [] };
    },
  });
  return { client, calls };
}
test("fixed seed binds accepted canonical input in one transaction and verifies all old values plus SQL NULL metadata", async () => {
  const f = legacyClient();
  await seedRunLegacyProvenance(f.client);
  expect(f.calls[0]?.text).toBe("begin"); expect(f.calls.at(-1)?.text).toBe("commit");
  const absence = f.calls.find(call => call.text.includes(" as absent"));
  for (const catalog of ["pg_attribute", "pg_trigger", "pg_constraint", "pg_proc"]) expect(absence?.text).toContain(catalog);
  const insert = f.calls.find(call => call.text.startsWith("insert into public.runs"));
  if (!insert) throw new Error("Missing seed INSERT");
  expect(insert.text).not.toMatch(/producer_kind|producer_version|actor_activation_revision/);
  expect(insert.params).toHaveLength(1);
  const canonical = insert.params[0];
  if (typeof canonical !== "string") throw new Error("Expected canonical input parameter");
  const input = decodeRunInput(canonical);
  expect(canonicalRunInput(input)).toBe(canonical);
  expect(input).toEqual({ requestKey: "009d5000-0000-4000-8000-000000000002", origin: "interactive", botId: "legacy-bot",
    conversationId: "legacy-conversation", configurationId: "legacy-configuration", configurationVersion: 1,
    input: { prompt: "synthetic legacy run", harness: "fixture", model: null, connections: [], resumeReference: null,
      budgets: { deadlineMs: 1000, maxEvents: 3, maxOutputBytes: 1000, maxToolBytes: 100, maxToolCalls: 0 } } });
  const before = f.calls.find(call => call.text.includes(" as run_ok"));
  expect(before?.text).not.toMatch(/producer_kind|producer_version|actor_activation_revision/);
  await verifyRunLegacyProvenance(f.client);
  const after = f.calls.at(-1);
  expect(after?.params).toEqual(insert.params);
  for (const column of [...Object.values(getTableColumns(runs)), ...Object.values(getTableColumns(runAttempts))]) {
    expect(after?.text).toMatch(new RegExp(`\\b${column.name}\\b`));
  }
  for (const field of ["producer_kind", "producer_version", "actor_activation_revision"]) expect(after?.text).toContain(`${field} is null`);
  expect(f.calls.filter(call => call.text.includes("insert into public.runs"))).toHaveLength(1);
  expect(f.calls.filter(call => call.text.includes("insert into public.run_attempts"))).toHaveLength(1);
});
test("failed pre-layer absence and malformed old-row facts roll back the fixed seed with opaque errors", async () => {
  for (const bad of [false, null, undefined, "true"]) {
    const absent = legacyClient({ absent: bad, run_ok: true, attempt_ok: true });
    await expect(seedRunLegacyProvenance(absent.client)).rejects.toThrow(/^Run provenance proof unavailable\.$/);
    expect(absent.calls.some(call => call.text.includes("insert into"))).toBe(false);
    expect(absent.calls.at(-1)?.text).toBe("rollback");
    for (const key of ["run_ok", "attempt_ok"] as const) {
      const f = legacyClient({ absent: true, run_ok: true, attempt_ok: true, [key]: bad });
      await expect(seedRunLegacyProvenance(f.client)).rejects.toThrow(/^Run provenance proof unavailable\.$/);
      expect(f.calls.at(-1)?.text).toBe("rollback");
      await expect(verifyRunLegacyProvenance(f.client)).rejects.toThrow(/^Run provenance proof unavailable\.$/);
    }
  }
});
test("all run proof imports remain inert with new connections and timers trapped", async () => {
  const script = `
    import net from 'node:net'; import tls from 'node:tls';
    const deny=()=>{throw Error('Unexpected startup')};
    net.Socket.prototype.connect=deny;tls.connect=deny;globalThis.fetch=deny;Bun.connect=deny;Bun.serve=deny;
    globalThis.setTimeout=deny;globalThis.setInterval=deny;
    await import(${JSON.stringify(new URL("./run-proof-client.ts", import.meta.url).href)});
    await import(${JSON.stringify(new URL("./run-readback-proof-client.ts", import.meta.url).href)});
    const m=await import(${JSON.stringify(new URL("./run-provenance-proof.ts", import.meta.url).href)});
    if(Object.keys(m).sort().join(',')!=='RunProvenanceSetupError,applyRunProvenance,assertRunProvenanceCatalog,assertRunProvenanceManifest,inspectRunProvenanceCatalog,projectRunProvenanceCatalog,seedRunLegacyProvenance,verifyRunLegacyProvenance,verifyRunProvenance,verifyRunProvenanceSources')throw Error('Unexpected exports');
    console.log('PASS inert imports');
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], { env: {}, stdout: "pipe", stderr: "pipe", timeout: 5000 });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, out, err }).toEqual({ code: 0, out: "PASS inert imports\n", err: "" });
});
test("fixed inspector uses only catalog SQL and verification failures carry sanitized facts", async () => {
  const calls: string[] = [];
  const client = Object.assign(new Client({ host: "127.0.0.1", port: 1 }), { release() {}, async query(text: string) {
    calls.push(text);
    return { rows: [{ columns_ok: true, check_ok: true, check_expression: "(producer_kindISNULL)", function_ok: false, trigger_ok: true, secret: "synthetic-private" }] };
  } });
  const projected = await inspectRunProvenanceCatalog(client);
  expect(projected).toEqual({ columns_ok: true, check_ok: true, check_expression: "(producer_kindISNULL)", function_ok: false, trigger_ok: true });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.trimStart().startsWith("select")).toBe(true);
  expect(calls[0]).not.toMatch(/\b(insert|update|delete|alter|create)\b/);
  try { await verifyRunProvenance(client); throw new Error("Expected catalog rejection"); }
  catch (error) {
    expect(error).toBeInstanceOf(RunProvenanceSetupError);
    if (!(error instanceof RunProvenanceSetupError)) throw error;
    expect(error.stage).toBe("catalog-verification"); expect(error.catalog).toEqual(projected);
    expect(error.message).toBe("Run provenance proof unavailable.");
    expect(JSON.stringify(error)).not.toContain("synthetic-private");
  }
  expect(calls).toHaveLength(2);
});
test("catalog query failures expose a closed phase and no raw driver details", async () => {
  const client = Object.assign(new Client({ host: "127.0.0.1", port: 1 }), { release() {}, async query() { throw new Error("synthetic-private"); } });
  try { await verifyRunProvenance(client); throw new Error("Expected query rejection"); }
  catch (error) {
    if (!(error instanceof RunProvenanceSetupError)) throw error;
    expect(error.stage).toBe("catalog-query"); expect(error.catalog).toBeNull();
    expect(error.message).toBe("Run provenance proof unavailable."); expect(error.cause).toBeUndefined();
  }
});
