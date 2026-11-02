// Test-only adapter; the executable validates the disposable target before import.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { openIdentityProof } from "./identity-proof-client";

const folder = fileURLToPath(new URL("../connection-test-migrations/", import.meta.url));
const migrationName = "20261022171713_connection_initial";
const hashes = {
  "migration.sql": "133fa78bf246ab9af83a6cc5809bffba64e7cd72f16cc6b2bd43de264afc4e30",
  "snapshot.json": "9d74877e12ad2906ec50f571bdfcd7593a365bb8ac7b78c5d822e0cc15e54db6",
} as const;

function check(value: unknown): asserts value {
  if (!value) throw new Error("Connection database proof unavailable.");
}

/** Fixed reviewed feature migration over the verified fresh identity baseline. */
export async function openConnectionProof(connectionString: string) {
  check(JSON.stringify((await readdir(folder)).sort()) === JSON.stringify([migrationName]));
  check(
    JSON.stringify((await readdir(`${folder}/${migrationName}`)).sort()) ===
      JSON.stringify(Object.keys(hashes).sort()),
  );
  for (const [name, hash] of Object.entries(hashes)) {
    check(
      createHash("sha256")
        .update(await readFile(`${folder}/${migrationName}/${name}`))
        .digest("hex") === hash,
    );
  }
  const proof = await openIdentityProof(connectionString);
  try {
    await migrate(drizzle({ client: proof.owner, logger: false }), { migrationsFolder: folder });
    const tables = await proof.owner.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'zetta' order by tablename",
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
          "session",
          "user",
          "verification",
        ]),
    );
    proof.healthy();
    // No eight-table cleanup method: only the launcher removes the owned tmpfs service.
    return {
      owner: proof.owner,
      first: proof.first,
      second: proof.second,
      firstDb: proof.firstDb,
      secondDb: proof.secondDb,
      close: proof.close,
      healthy: proof.healthy,
    };
  } catch {
    // no-excuse-ok: catch -- never expose migration SQL/parameters or driver errors.
    await proof.close();
    throw new Error("Connection database proof unavailable.");
  }
}
