// Test-only reconnect to the already-owned disposable service; no migrations or resets.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { relations } from "./relations";
import { createAdminOperatorClientOwner } from "./admin-operator-client-owner";
import { verifyIdentityProofService } from "./identity-proof-client";
import { verifyIdentityActivation } from "./identity-activation-proof";
import { verifyRunProvenance } from "./run-provenance-proof";

function check(value: unknown): asserts value { if (!value) throw new Error("Run readback proof unavailable."); }
export async function openRunReadbackProof(connectionString: string, parentPid: number, phase: "write" | "read") {
  const url = new URL(connectionString);
  check(url.protocol === "postgresql:" && url.hostname === "127.0.0.1" && url.port === "55432"
    && url.pathname === "/zetta_identity_test" && decodeURIComponent(url.username) === "zetta_identity_runner"
    && /^[a-f0-9]{64}$/.test(url.password) && !url.search && !url.hash
    && Number.isSafeInteger(parentPid) && parentPid > 0 && (phase === "write" || phase === "read"));
  const pool = new Pool({ host: url.hostname, port: Number(url.port), database: url.pathname.slice(1),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl: false, sslnegotiation: "postgres", client_encoding: "UTF8",
    options: "-c search_path=public", application_name: `zetta-run-restart-${phase}`,
    connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000, lock_timeout: 2000,
    idle_in_transaction_session_timeout: 5000, max: 1, idleTimeoutMillis: 1000, allowExitOnIdle: true,
    keepAlive: true, keepAliveInitialDelayMillis: 1000 });
  const owner = createAdminOperatorClientOwner(pool);
  try {
    const client = await pool.connect(); owner.reserve(client);
    await verifyIdentityProofService(client);
    const parent = await client.query<{ owned: boolean }>(`select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid
      where a.pid=$1 and a.datname=current_database() and a.usename=current_user and a.application_name='zetta-identity-proof-0'
      and l.locktype='advisory' and l.classid=40042 and l.objid=2 and l.objsubid=2 and l.granted) as owned`, [parentPid]);
    check(parent.rows[0]?.owned);
    const tables = await client.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename");
    check(JSON.stringify(tables.rows.map(row => row.tablename)) === JSON.stringify([
      "account", "connection", "connection_credential", "connection_key_check", "connection_mutation_receipt", "connection_nonce",
      "identity_audit", "installation_identity", "invitation", "membership", "run_attempts", "runs", "session", "user", "verification",
    ]));
    await verifyIdentityActivation(client);
    await verifyRunProvenance(client);
    const pid = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
    check(pid && pid !== parentPid); owner.healthy();
    return { client, db: drizzle({ client, relations, logger: false }), pid, healthy: owner.healthy, close: owner.close };
  } catch { // no-excuse-ok: catch -- suppress private URL, SQL and driver errors.
    await owner.close(); throw new Error("Run readback proof unavailable.");
  }
}

/** Scoped new-network guard, installed only after all connections for this process are reserved. */
export async function forbidRunProofIO() {
  const net = (await import("node:net")).default, tls = (await import("node:tls")).default;
  const dns = (await import("node:dns")).default, http = (await import("node:http")).default, https = (await import("node:https")).default;
  let attempts = 0; const undo: (() => void)[] = [];
  const deny = () => { attempts++; throw new Error("Unintended proof IO."); };
  for (const [object, key] of [[net.Socket.prototype, "connect"], [net.Server.prototype, "listen"], [tls, "connect"],
    [dns, "lookup"], [dns, "resolve"], [dns.promises, "lookup"], [dns.promises, "resolve"], [http, "request"], [http, "get"],
    [https, "request"], [https, "get"], [Bun, "connect"], [Bun, "listen"], [Bun, "serve"], [globalThis, "fetch"]] as const) {
    const prior = Reflect.get(object, key); check(Reflect.set(object, key, deny)); undo.push(() => { Reflect.set(object, key, prior); });
  }
  return { healthy: () => check(attempts === 0), restore: () => { for (const restore of undo.reverse()) restore(); } };
}
