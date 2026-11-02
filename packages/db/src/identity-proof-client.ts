// Test-only driver adapter: never imported by production or before the target guard.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { relations } from "./relations";
import { createAdminOperatorClientOwner } from "./admin-operator-client-owner";
import {
  applyIdentityActivation,
  seedIdentityActivationBackfill,
  verifyIdentityActivationBackfill,
  verifyActivationSources,
  seedIdentityActivationExhaustion,
  verifyIdentityActivationExhaustion,
} from "./identity-activation-proof";

const migrationName = "20261022123627_identity_initial";
const migrationHash = "cad1917baf63fcc40f06c556b279b2a8061cc5827d75fb44d7efa18baee41e8c";
const migrationsFolder = fileURLToPath(new URL("../identity-test-migrations/", import.meta.url));
const tableNames = [
  "account",
  "identity_audit",
  "installation_identity",
  "invitation",
  "membership",
  "session",
  "user",
  "verification",
];
function check(value: unknown): asserts value {
  if (!value) throw new Error("Identity database proof unavailable.");
}

async function verifyService(client: PoolClient) {
  const result =
    await client.query(`select current_database() as database, current_user as username,
    session_user as session_username, pg_get_userbyid(datdba) as owner,
    current_setting('zetta.identity_test_marker', true) as marker,
    current_setting('data_directory') as data_directory,
    current_setting('server_version_num')::int as version
    from pg_database where datname = current_database()`);
  const row = result.rows[0];
  check(
    row &&
      row.database === "zetta_identity_test" &&
      row.username === "zetta_identity_runner" &&
      row.session_username === row.username &&
      row.owner === row.username &&
      row.marker === "zetta-identity-tests-v1" &&
      row.data_directory === "/var/lib/postgresql/18/docker" &&
      row.version >= 180000 &&
      row.version < 190000,
  );
}

/** One setup owner, fixed reviewed migration, no URL/SQL/migration CLI or fallback. */
async function openIdentityProofCore(
  connectionString: string,
  backfill: boolean,
  exhaustion = false,
) {
  const url = new URL(connectionString);
  let failed = false;
  const pools = [0, 1, 2].map((index) => {
    const pool = new Pool({
      host: url.hostname,
      port: Number(url.port),
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl: false,
      sslnegotiation: "postgres",
      client_encoding: "UTF8",
      options: "-c search_path=zetta",
      application_name: `zetta-identity-proof-${index}`,
      connectionTimeoutMillis: 3000,
      query_timeout: 5000,
      statement_timeout: 4000,
      lock_timeout: 2000,
      idle_in_transaction_session_timeout: 5000,
      max: 1,
      idleTimeoutMillis: 1000,
      allowExitOnIdle: true,
      keepAlive: true,
      keepAliveInitialDelayMillis: 1000,
    });
    pool.on("connect", (client) =>
      client.on("error", () => {
        failed = true;
      }),
    );
    pool.on("error", () => {
      failed = true;
    }); // Never log driver errors/causes.
    return pool;
  });
  const clients: PoolClient[] = [];
  const owners = pools.map((pool) => createAdminOperatorClientOwner(pool));
  let stage = "connection";
  const close = async () => {
    const results = await Promise.allSettled(owners.map((owner) => owner.close()));
    check(results.every((result) => result.status === "fulfilled"));
    owners.forEach((owner) => owner.healthy());
  };
  try {
    // Reserve all backends: no pool reconnect can silently replace a verified service.
    for (const [index, pool] of pools.entries()) {
      const client = await pool.connect();
      const clientOwner = owners[index];
      check(clientOwner);
      clientOwner.reserve(client);
      clients.push(client);
      stage = "service identity";
      await verifyService(client);
      stage = "connection";
    }
    stage = "empty target";
    const owner = clients[0]!;
    check(
      (await owner.query("select pg_try_advisory_lock(40042, 2) as locked")).rows[0]?.locked ===
        true,
    );
    const objects =
      await owner.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
      union all select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
      union all select 1 from pg_namespace where nspname !~ '^pg_' and nspname not in ('public','information_schema')
      union all select 1 from pg_extension where extname <> 'plpgsql'`);
    check(objects.rowCount === 0); // A rerun must recreate this tmpfs service, never reset an existing schema.
    stage = "migration source";
    check(
      JSON.stringify((await readdir(migrationsFolder)).sort()) === JSON.stringify([migrationName]),
    );
    const source = await readFile(`${migrationsFolder}/${migrationName}/migration.sql`);
    check(createHash("sha256").update(source).digest("hex") === migrationHash);
    await verifyActivationSources();
    stage = "driver setup";
    const databases = clients.map((client) => drizzle({ client, relations, logger: false }));
    stage = "migration apply";
    await migrate(databases[0]!, { migrationsFolder });
    stage = "activation layer";
    if (backfill) await seedIdentityActivationBackfill(owner);
    if (exhaustion) await seedIdentityActivationExhaustion(owner);
    await applyIdentityActivation(owner);
    if (backfill) await verifyIdentityActivationBackfill(owner);
    if (exhaustion) await verifyIdentityActivationExhaustion(owner);
    async function cleanupFixtures() {
      await verifyService(owner);
      check(!failed);
      const tables = await owner.query(
        "select tablename from pg_tables where schemaname = 'zetta' order by tablename",
      );
      check(JSON.stringify(tables.rows.map((row) => row.tablename)) === JSON.stringify(tableNames));
      // All eight known tables together, no CASCADE, no schema drop and no user-selected names.
      await owner.query(
        'TRUNCATE TABLE zetta.account, zetta.identity_audit, zetta.installation_identity, zetta.invitation, zetta.membership, zetta.session, zetta."user", zetta.verification',
      );
    }
    return {
      owner,
      first: clients[1]!,
      second: clients[2]!,
      firstDb: databases[1]!,
      secondDb: databases[2]!,
      cleanupFixtures,
      close,
      healthy: () => check(!failed),
    };
  } catch {
    await close();
    throw new Error(`Identity database proof unavailable (${stage}).`);
  }
}

// Test-only alias: reconnect proofs reuse the exact existing service identity checks.
export { verifyService as verifyIdentityProofService };

export async function openIdentityProof(connectionString: string) {
  return openIdentityProofCore(connectionString, false);
}
export async function openIdentityActivationBackfillProof(connectionString: string) {
  return openIdentityProofCore(connectionString, true);
}

export async function openIdentityActivationExhaustionProof(connectionString: string) {
  return openIdentityProofCore(connectionString, false, true);
}
