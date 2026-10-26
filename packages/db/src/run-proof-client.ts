// Test-only adapter; its executable guards the disposable target before importing it.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { openConnectionProof } from "./connection-proof-client";
import { applyRunProvenance, inspectRunProvenanceCatalog, RunProvenanceSetupError, seedRunLegacyProvenance, verifyRunLegacyProvenance, verifyRunProvenanceSources } from "./run-provenance-proof";
import { forbidRunProofIO } from "./run-readback-proof-client";

const folder = fileURLToPath(new URL("../run-test-migrations/", import.meta.url));
const migrations = {
  "20261022180455_runs_initial": {
    "migration.sql": "fe2e46816c2e2fc046cec7eb7e017f30911f1de2fbc3a745eb2417c0e83a372a",
    "snapshot.json": "888c5ec8ffe5b4389b14a4281cdefcbbd6220493e66647e7f557c471865e7bc5",
  },
  "20261022180711_runs_constraints": {
    "migration.sql": "35f95e21e74a777dbe3527ae4d0ae9aa545e2c639ee8a3292ea08d84f8b0d785",
    "snapshot.json": "6c0a17f4c839a2b973f1455917f8a3bea821744356544b18b7fe5970a7e217e1",
  },
} as const;
function check(value: unknown): asserts value {
  if (!value) throw new Error("Run database proof unavailable.");
}
export async function openRunProof(connectionString: string) {
  return openRunProofCore(connectionString, false);
}
export async function openRunLegacyProvenanceProof(connectionString: string) {
  return openRunProofCore(connectionString, true);
}
type DiagnosticTrace = {
  stage: "sources" | "connection-baseline" | "old-run-apply" | "provenance-apply" | "provenance-verification" | "table-inventory" | "complete";
  provenanceStage: RunProvenanceSetupError["stage"] | null;
  catalog: Awaited<ReturnType<typeof inspectRunProvenanceCatalog>> | null;
  inspectionFailed: boolean; clientsClosed: boolean; zeroForbiddenIO: boolean;
};
export async function diagnoseRunProofSetup(connectionString: string) {
  const trace: DiagnosticTrace = { stage: "sources", provenanceStage: null, catalog: null,
    inspectionFailed: false, clientsClosed: false, zeroForbiddenIO: false };
  let setupPassed = false;
  try { await openRunProofCore(connectionString, false, trace); setupPassed = true; }
  catch { setupPassed = false; }
  return Object.freeze({ version: 1 as const, setupPassed, ...trace });
}
async function openRunProofCore(connectionString: string, legacyFixture: boolean, trace?: DiagnosticTrace) {
  check(JSON.stringify((await readdir(folder)).sort()) === JSON.stringify(Object.keys(migrations).sort()));
  for (const [migration, hashes] of Object.entries(migrations)) {
    check(JSON.stringify((await readdir(`${folder}/${migration}`)).sort()) === JSON.stringify(Object.keys(hashes).sort()));
    for (const [file, hash] of Object.entries(hashes)) {
      check(createHash("sha256").update(await readFile(`${folder}/${migration}/${file}`)).digest("hex") === hash);
    }
  }
  await verifyRunProvenanceSources();
  if (trace) trace.stage = "connection-baseline";
  const proof = await openConnectionProof(connectionString);
  let io: Awaited<ReturnType<typeof forbidRunProofIO>> | undefined;
  try {
    if (trace) { io = await forbidRunProofIO(); trace.stage = "old-run-apply"; }
    await migrate(drizzle({ client: proof.owner, logger: false }), { migrationsFolder: folder });
    if (legacyFixture) await seedRunLegacyProvenance(proof.owner);
    if (trace) trace.stage = "provenance-apply";
    await applyRunProvenance(proof.owner);
    if (trace) trace.stage = "table-inventory";
    const tables = await proof.owner.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename");
    check(JSON.stringify(tables.rows.map(row => row.tablename)) === JSON.stringify([
      "account", "connection", "connection_credential", "connection_key_check", "connection_mutation_receipt", "connection_nonce",
      "identity_audit", "installation_identity", "invitation", "membership", "run_attempts", "runs", "session", "user", "verification",
    ]));
    if (legacyFixture) await verifyRunLegacyProvenance(proof.owner);
    proof.healthy();
    if (trace) { trace.catalog = await inspectRunProvenanceCatalog(proof.owner); trace.stage = "complete"; }
    // The owning launcher removes its entire tmpfs service; never call the old eight-table fixture cleanup.
    return proof;
  } catch (error) {
    if (trace && error instanceof RunProvenanceSetupError) {
      trace.provenanceStage = error.stage;
      trace.stage = error.stage === "apply" || error.stage === "sources" ? "provenance-apply" : "provenance-verification";
      trace.catalog = error.catalog;
      trace.inspectionFailed = error.stage === "catalog-query";
      if (error.stage === "apply") {
        try { trace.catalog = await inspectRunProvenanceCatalog(proof.owner); }
        catch { trace.inspectionFailed = true; }
      }
    }
    if (!trace) await proof.close();
    throw new Error("Run database proof unavailable.");
  } finally {
    if (trace) {
      try {
        await proof.close(); trace.clientsClosed = true;
        if (io) { io.healthy(); trace.zeroForbiddenIO = true; }
      } finally { io?.restore(); }
    }
  }
}
