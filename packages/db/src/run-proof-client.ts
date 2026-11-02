// Test-only adapter; its executable guards the disposable target before importing it.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { openConnectionProof } from "./connection-proof-client";
import {
  applyRunProvenance,
  inspectRunProvenanceCatalog,
  RunProvenanceSetupError,
  seedRunLegacyProvenance,
  verifyRunLegacyProvenance,
  verifyRunProvenanceSources,
} from "./run-provenance-proof";
import { forbidRunProofIO } from "./run-readback-proof-client";

const folder = fileURLToPath(new URL("../run-test-migrations/", import.meta.url));
const migrations = {
  "20261022180455_runs_initial": {
    "migration.sql": "ca730fae8f7e5d5f6917292d6f71b56aa76ef31b5e20c4e826c474e5b05f65cb",
    "snapshot.json": "3bc93e6146b58b7f01a10c5e8481354991bdd3ca8fdf3a753b093469a05415ef",
  },
  "20261022180711_runs_constraints": {
    "migration.sql": "2c9690dd5f978d73253849a2326e81cb45cac377c5f38c379a4f94b7c4f490ee",
    "snapshot.json": "2b48aaa1e7ed2585286056d2863e7a3ef46f528703bf7f45702c296ced1ce33a",
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
  stage:
    | "sources"
    | "connection-baseline"
    | "old-run-apply"
    | "provenance-apply"
    | "provenance-verification"
    | "table-inventory"
    | "complete";
  provenanceStage: RunProvenanceSetupError["stage"] | null;
  catalog: Awaited<ReturnType<typeof inspectRunProvenanceCatalog>> | null;
  inspectionFailed: boolean;
  clientsClosed: boolean;
  zeroForbiddenIO: boolean;
};
export async function diagnoseRunProofSetup(connectionString: string) {
  const trace: DiagnosticTrace = {
    stage: "sources",
    provenanceStage: null,
    catalog: null,
    inspectionFailed: false,
    clientsClosed: false,
    zeroForbiddenIO: false,
  };
  let setupPassed = false;
  try {
    await openRunProofCore(connectionString, false, trace);
    setupPassed = true;
  } catch {
    setupPassed = false;
  }
  return Object.freeze({ version: 1 as const, setupPassed, ...trace });
}
async function openRunProofCore(
  connectionString: string,
  legacyFixture: boolean,
  trace?: DiagnosticTrace,
) {
  check(
    JSON.stringify((await readdir(folder)).sort()) ===
      JSON.stringify(Object.keys(migrations).sort()),
  );
  for (const [migration, hashes] of Object.entries(migrations)) {
    check(
      JSON.stringify((await readdir(`${folder}/${migration}`)).sort()) ===
        JSON.stringify(Object.keys(hashes).sort()),
    );
    for (const [file, hash] of Object.entries(hashes)) {
      check(
        createHash("sha256")
          .update(await readFile(`${folder}/${migration}/${file}`))
          .digest("hex") === hash,
      );
    }
  }
  await verifyRunProvenanceSources();
  if (trace) trace.stage = "connection-baseline";
  const proof = await openConnectionProof(connectionString);
  let io: Awaited<ReturnType<typeof forbidRunProofIO>> | undefined;
  try {
    if (trace) {
      io = await forbidRunProofIO();
      trace.stage = "old-run-apply";
    }
    await migrate(drizzle({ client: proof.owner, logger: false }), { migrationsFolder: folder });
    if (legacyFixture) await seedRunLegacyProvenance(proof.owner);
    if (trace) trace.stage = "provenance-apply";
    await applyRunProvenance(proof.owner);
    if (trace) trace.stage = "table-inventory";
    const tables = await proof.owner.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname='zetta' order by tablename",
    );
    check(
      JSON.stringify(tables.rows.map((row) => row.tablename)) ===
        JSON.stringify([
          "account",
          "connection",
          "connection_credential",
          "connection_key_check",
          "connection_mutation_receipt",
          "connection_nonce",
          "identity_audit",
          "installation_identity",
          "invitation",
          "membership",
          "run_attempts",
          "runs",
          "session",
          "user",
          "verification",
        ]),
    );
    if (legacyFixture) await verifyRunLegacyProvenance(proof.owner);
    proof.healthy();
    if (trace) {
      trace.catalog = await inspectRunProvenanceCatalog(proof.owner);
      trace.stage = "complete";
    }
    // The owning launcher removes its entire tmpfs service; never call the old eight-table fixture cleanup.
    return proof;
  } catch (error) {
    if (trace && error instanceof RunProvenanceSetupError) {
      trace.provenanceStage = error.stage;
      trace.stage =
        error.stage === "apply" || error.stage === "sources"
          ? "provenance-apply"
          : "provenance-verification";
      trace.catalog = error.catalog;
      trace.inspectionFailed = error.stage === "catalog-query";
      if (error.stage === "apply") {
        try {
          trace.catalog = await inspectRunProvenanceCatalog(proof.owner);
        } catch {
          trace.inspectionFailed = true;
        }
      }
    }
    if (!trace) await proof.close();
    throw new Error("Run database proof unavailable.");
  } finally {
    if (trace) {
      try {
        await proof.close();
        trace.clientsClosed = true;
        if (io) {
          io.healthy();
          trace.zeroForbiddenIO = true;
        }
      } finally {
        io?.restore();
      }
    }
  }
}
