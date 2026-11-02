// Fixed disposable-test role fixture; never a production privilege migration.
import { randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { relations } from "./relations";
import { createAdminOperatorClientOwner } from "./admin-operator-client-owner";
import { openRunProof } from "./run-proof-client";
const role = "zetta_membership_runtime_proof";
function check(value: unknown): asserts value {
  if (!value) throw new Error("Membership role fixture unavailable.");
}
export function assertRoleFacts(value: unknown) {
  const keys = [
    "identity",
    "attributes",
    "memberships",
    "ownership",
    "database",
    "schemas",
    "tables",
    "functions",
    "parameters",
  ];
  check(typeof value === "object" && value !== null && !Array.isArray(value));
  check(
    Object.keys(value).length === keys.length &&
      keys.every((key) => Reflect.get(value, key) === true),
  );
}
export function assertColumnPrivileges(
  rows: readonly {
    table_name: string;
    column_name: string;
    readable: boolean;
    insertable: boolean;
    writable: boolean;
    referenceable: boolean;
    grantable: boolean;
  }[],
) {
  check(rows.length > 0 && new Set(rows.map((row) => row.table_name)).size === 16);
  const readTables = ["membership", "installation_identity", "invitation", "runs", "run_attempts"];
  const insertTables = ["membership", "identity_audit", "runs", "run_attempts"];
  const writes: Record<string, readonly string[]> = {
    user: ["updated_at"],
    membership: ["activation_revision", "status", "removed_at", "updated_at"],
    installation_identity: ["id"],
    invitation: ["consumed_at", "consumed_by_user_id"],
    runs: ["revision"],
    run_attempts: ["status"],
  };
  const seen = new Set<string>();
  for (const row of rows) {
    check(!seen.has(`${row.table_name}.${row.column_name}`));
    seen.add(`${row.table_name}.${row.column_name}`);
    check(
      row.readable ===
        (readTables.includes(row.table_name) ||
          (row.table_name === "user" && ["id", "email"].includes(row.column_name))),
    );
    check(row.insertable === insertTables.includes(row.table_name));
    check(row.writable === (writes[row.table_name]?.includes(row.column_name) ?? false));
    check(row.referenceable === false && row.grantable === false);
  }
  for (const table of [
    ...readTables,
    ...insertTables,
    "user",
    "session",
    "account",
    "verification",
    "connection",
    "connection_credential",
    "connection_user_key",
    "connection_key_check",
    "connection_mutation_receipt",
    "connection_nonce",
  ])
    check(rows.some((row) => row.table_name === table));
}
export async function verifyMembershipRole(client: PoolClient) {
  const facts = await client.query(`select
    session_user='${role}' and current_user=session_user as identity,
    (select rolcanlogin and not rolsuper and not rolinherit and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls from pg_roles where rolname=current_user) as attributes,
    not exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname=current_user) or roleid=(select oid from pg_roles where rolname=current_user)) as memberships,
    not exists(select 1 from pg_class where relowner=(select oid from pg_roles where rolname=current_user))
      and not exists(select 1 from pg_proc where proowner=(select oid from pg_roles where rolname=current_user))
      and not exists(select 1 from pg_namespace where nspowner=(select oid from pg_roles where rolname=current_user))
      and not exists(select 1 from pg_database where datdba=(select oid from pg_roles where rolname=current_user)) as ownership,
    has_database_privilege(current_database(),'CONNECT') and not has_database_privilege(current_database(),'CREATE')
      and not has_database_privilege(current_database(),'TEMP') as database,
    has_schema_privilege('zetta','USAGE') and not exists(select 1 from pg_namespace where has_schema_privilege(oid,'CREATE')) as schemas,
    not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='zetta' and c.relkind='r'
      and (has_table_privilege(c.oid,'DELETE') or has_table_privilege(c.oid,'TRUNCATE') or has_table_privilege(c.oid,'TRIGGER') or has_table_privilege(c.oid,'MAINTAIN') or has_table_privilege(c.oid,'REFERENCES'))) as tables,
    not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='zetta' and has_function_privilege(p.oid,'EXECUTE')) as functions,
    not has_parameter_privilege('session_replication_role','SET') and not has_parameter_privilege('session_replication_role','ALTER SYSTEM')
      and current_setting('session_replication_role')='origin' as parameters`);
  check(facts.rows.length === 1);
  assertRoleFacts(facts.rows[0]);
  const columns = await client.query<{
    table_name: string;
    column_name: string;
    readable: boolean;
    insertable: boolean;
    writable: boolean;
    referenceable: boolean;
    grantable: boolean;
  }>(`select c.relname as table_name,a.attname as column_name,
    has_column_privilege(c.oid,a.attnum,'SELECT') as readable,has_column_privilege(c.oid,a.attnum,'INSERT') as insertable,
    has_column_privilege(c.oid,a.attnum,'UPDATE') as writable,has_column_privilege(c.oid,a.attnum,'REFERENCES') as referenceable,
    has_column_privilege(c.oid,a.attnum,'SELECT WITH GRANT OPTION') or has_column_privilege(c.oid,a.attnum,'INSERT WITH GRANT OPTION')
      or has_column_privilege(c.oid,a.attnum,'UPDATE WITH GRANT OPTION') or has_column_privilege(c.oid,a.attnum,'REFERENCES WITH GRANT OPTION') as grantable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname='zetta' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`);
  assertColumnPrivileges(columns.rows);
}
export async function openMembershipRoleProof(connectionString: string) {
  const url = new URL(connectionString);
  check(
    url.protocol === "postgresql:" &&
      url.hostname === "127.0.0.1" &&
      url.port === "55432" &&
      url.pathname === "/zetta_identity_test" &&
      url.username === "zetta_identity_runner" &&
      /^[a-f0-9]{64}$/.test(url.password) &&
      !url.search &&
      !url.hash,
  );
  const proof = await openRunProof(connectionString);
  let runtimeOwner: ReturnType<typeof createAdminOperatorClientOwner> | undefined;
  const secret = randomBytes(32);
  try {
    const parentPid = (await proof.owner.query<{ pid: number }>("select pg_backend_pid() as pid"))
      .rows[0]?.pid;
    check(parentPid);
    // Password is generated internally as hex; no caller-controlled SQL or role identifier.
    await proof.owner.query(
      `create role ${role} login nosuperuser noinherit nocreatedb nocreaterole noreplication nobypassrls password '${secret.toString("hex")}'`,
    );
    await proof.owner.query(`revoke all on database zetta_identity_test from public;
      revoke all on schema public from public;
      revoke all on schema zetta from public;
      revoke all on all tables in schema zetta from public;
      revoke all on all functions in schema zetta from public;
      grant connect on database zetta_identity_test to ${role}; grant usage on schema zetta to ${role};
      grant select(id,email),update(updated_at) on zetta."user" to ${role};
      grant select on membership,installation_identity,invitation,runs,run_attempts to ${role};
      grant insert on membership,identity_audit,runs,run_attempts to ${role};
      grant update(activation_revision,status,removed_at,updated_at) on membership to ${role};
      grant update(id) on installation_identity to ${role};
      grant update(consumed_at,consumed_by_user_id) on invitation to ${role};
      grant update(revision) on runs to ${role}; grant update(status) on run_attempts to ${role}`);
    const pool = new Pool({
      host: "127.0.0.1",
      port: 55432,
      database: "zetta_identity_test",
      user: role,
      password: secret.toString("hex"),
      ssl: false,
      sslnegotiation: "postgres",
      client_encoding: "UTF8",
      options: "-c search_path=zetta",
      application_name: "zetta-membership-role-proof",
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
    runtimeOwner = createAdminOperatorClientOwner(pool);
    const client = await pool.connect();
    runtimeOwner.reserve(client);
    secret.fill(0);
    const service = (
      await client.query<{ valid: boolean; pid: number }>(`select pg_backend_pid() as pid,
      current_database()='zetta_identity_test' and session_user='${role}' and current_user=session_user
      and current_setting('zetta.identity_test_marker',true)='zetta-identity-tests-v1'
      and current_setting('server_version_num')::int between 180000 and 189999
      and (select pg_get_userbyid(datdba)='zetta_identity_runner' from pg_database where datname=current_database()) as valid`)
    ).rows[0];
    check(service?.valid && service.pid !== parentPid);
    const owned = (
      await proof.owner.query<{ valid: boolean }>(
        `select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid
      where a.pid=$1 and a.datname=current_database() and a.usename='zetta_identity_runner' and a.application_name='zetta-identity-proof-0'
      and l.locktype='advisory' and l.classid=40042 and l.objid=2 and l.objsubid=2 and l.granted)
      and exists(select 1 from pg_stat_activity where pid=$2 and datname=current_database() and usename='${role}'
      and application_name='zetta-membership-role-proof' and backend_type='client backend') as valid`,
        [parentPid, service.pid],
      )
    ).rows[0];
    check(owned?.valid);
    await verifyMembershipRole(client);
    proof.healthy();
    runtimeOwner.healthy();
    const reserved = runtimeOwner;
    return {
      proof,
      client,
      db: drizzle({ client, relations, logger: false }),
      pid: service.pid,
      healthy() {
        proof.healthy();
        reserved.healthy();
      },
      async close() {
        const results = await Promise.allSettled([reserved.close(), proof.close()]);
        check(results.every((result) => result.status === "fulfilled"));
      },
    };
  } catch {
    // no-excuse-ok: catch -- neither credentials nor driver causes may leave this fixed adapter.
    const results = await Promise.allSettled([runtimeOwner?.close(), proof.close()]);
    check(results.every((result) => result.status === "fulfilled"));
    throw new Error("Membership role fixture unavailable.");
  } finally {
    secret.fill(0);
  }
}
