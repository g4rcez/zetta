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
    "migration.sql": "bc46841c779ef1fe42ea3df8adbb2b21a12048c3112d853c7e50f954b5e085ae",
    "snapshot.json": "9f7f7e92f05280f247d0f75fc187b24e2940d382cc3b2abc7ff3cbabd9029ac6",
  },
  "20261022191701_dispatch_guards": {
    "migration.sql": "230248ab21f5e0c13b6ddb642e9ec01e95ef84499554792e8599d6b030c8343c",
    "snapshot.json": "63b4838a126c51eef9407204c753b9bde632be89ec507b791f8403ba97219650",
  },
} as const;
function check(value: unknown): asserts value {
  if (!value) throw new Error("Dispatch database proof unavailable.");
}
export async function openDispatchProof(connectionString: string) {
  check(
    JSON.stringify((await readdir(folder)).sort()) ===
      JSON.stringify(Object.keys(migrations).sort()),
  );
  for (const [name, hashes] of Object.entries(migrations)) {
    check(
      JSON.stringify((await readdir(`${folder}/${name}`)).sort()) ===
        JSON.stringify(Object.keys(hashes).sort()),
    );
    for (const [file, hash] of Object.entries(hashes))
      check(
        createHash("sha256")
          .update(await readFile(`${folder}/${name}/${file}`))
          .digest("hex") === hash,
      );
  }
  const proof = await openRunProof(connectionString);
  try {
    await migrate(drizzle({ client: proof.owner, logger: false }), { migrationsFolder: folder });
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
          "dispatch_capacity",
          "dispatch_claims",
          "dispatch_grants",
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
    proof.healthy();
    // Retained tombstones require whole owned tmpfs service disposal by the launcher.
    return proof;
  } catch {
    // no-excuse-ok: catch -- never expose SQL, parameters or driver error detail.
    await proof.close();
    throw new Error("Dispatch database proof unavailable.");
  }
}
