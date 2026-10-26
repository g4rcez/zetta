// Test-only feature adapter. Executable validates the dedicated target before import.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { openRunProof } from "./run-proof-client";

const folder = fileURLToPath(new URL("../dispatch-test-migrations/", import.meta.url));
const migrations = {
  "20261022191656_dispatch_initial": {
    "migration.sql": "55fffcf588fe4173a94956914799b8c89e4b51c2603962f4c592d5670745e855",
    "snapshot.json": "1a729b97c68af980ed424b9a2692123da822f3fb7ca61926eaa5cbb5db8ad2ce",
  },
  "20261022191701_dispatch_guards": {
    "migration.sql": "9172c8efe5983f01bf75bd210c38e1bf507fc770200dad5dd8d28554329814c7",
    "snapshot.json": "06dd6b4a48b65b82c40b661621b251184a1c49df546022f7302e698c8658609d",
  },
} as const;
function check(value: unknown): asserts value { if (!value) throw new Error("Dispatch database proof unavailable."); }
export async function openDispatchProof(connectionString: string) {
  check(JSON.stringify((await readdir(folder)).sort()) === JSON.stringify(Object.keys(migrations).sort()));
  for (const [name, hashes] of Object.entries(migrations)) {
    check(JSON.stringify((await readdir(`${folder}/${name}`)).sort()) === JSON.stringify(Object.keys(hashes).sort()));
    for (const [file, hash] of Object.entries(hashes)) check(createHash("sha256").update(await readFile(`${folder}/${name}/${file}`)).digest("hex") === hash);
  }
  const proof = await openRunProof(connectionString);
  try {
    await migrate(drizzle({ client: proof.owner, logger: false }), { migrationsFolder: folder });
    const tables = await proof.owner.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename");
    check(JSON.stringify(tables.rows.map(row => row.tablename)) === JSON.stringify([
      "account", "connection", "connection_credential", "connection_key_check", "connection_mutation_receipt", "connection_nonce",
      "dispatch_capacity", "dispatch_claims", "dispatch_grants", "identity_audit", "installation_identity", "invitation", "membership",
      "run_attempts", "runs", "session", "user", "verification",
    ]));
    proof.healthy();
    // Retained tombstones require whole owned tmpfs service disposal by the launcher.
    return proof;
  } catch { // no-excuse-ok: catch -- never expose SQL, parameters or driver error detail.
    await proof.close(); throw new Error("Dispatch database proof unavailable.");
  }
}
