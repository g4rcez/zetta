import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";

import { connection, connectionCredential, connectionKeyCheck, connectionMutationReceipt, connectionNonce } from "./connections";

const tables = [connection, connectionCredential, connectionKeyCheck, connectionMutationReceipt, connectionNonce];
const dialect = new PgDialect();
const db = drizzle.mock();

function references(table: PgTable) {
  return getTableConfig(table).foreignKeys.map((key) => {
    const reference = key.reference();
    return {
      columns: reference.columns.map((column) => column.name),
      target: getTableName(reference.foreignTable),
      targetColumns: reference.foreignColumns.map((column) => column.name),
      onDelete: key.onDelete,
      onUpdate: key.onUpdate,
    };
  });
}

function constraints(table: PgTable) {
  return Object.fromEntries(getTableConfig(table).checks.map(({ name, value }) => {
    const query = dialect.sqlToQuery(value);
    expect(query.params).toEqual([]);
    return [name, query.sql.replace(/\s+/g, " ").trim()];
  }));
}

describe("connection schema offline contract (not PostgreSQL execution)", () => {
  test("imports connection tables with startup and network APIs disabled", async () => {
    // Given an empty environment and forbidden startup/network entry points.
    const script = `
      import net from 'node:net';
      import tls from 'node:tls';
      const denied = () => { throw new Error('unexpected startup'); };
      Bun.serve = denied; Bun.connect = denied; net.Socket.prototype.connect = denied;
      tls.connect = denied; globalThis.fetch = denied; globalThis.setTimeout = denied; globalThis.setInterval = denied;
      const schema = await import(${JSON.stringify(import.meta.resolve("./connections"))});
      if (Object.keys(schema).length !== 5) throw new Error('unexpected exports');
      console.log('offline import PASS');
    `;
    // When the real module is imported in an isolated child.
    const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], { env: {}, stdout: "pipe", stderr: "pipe" });
    const result = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    // Then importing it requires no environment, connection or server.
    expect(result).toEqual([0, "offline import PASS\n", ""]);
  });

  test("builds credential inserts with exact binary parameters instead of SQL literals", () => {
    // Given a synthetic envelope with binary values that cannot be text-normalized.
    const nonce = Buffer.alloc(12, 255), tag = Buffer.alloc(16, 128), ciphertext = Buffer.from([0, 255, 39, 92]);
    // When Drizzle builds the actual parameterized insertion.
    const query = db.insert(connectionCredential).values({ connectionId: "00000000-0000-4000-8000-000000000001", credentialVersion: 1,
      ownerUserId: "owner", kind: "api-key", envelopeVersion: 1, algorithm: "aes-256-gcm", keyId: "test", nonce, tag, ciphertext, createdAt: new Date(0) }).toSQL();
    // Then binary values are preserved in separate parameters.
    expect(query.params.filter(Buffer.isBuffer)).toEqual([nonce, tag, ciphertext]);
    expect(query.sql).not.toContain(ciphertext.toString("hex"));
    expect([connectionCredential.nonce, connectionCredential.tag, connectionCredential.ciphertext].map((column) => column.getSQLType())).toEqual(["bytea", "bytea", "bytea"]);
  });

  test("binds credential and receipt ownership to the connection identity", () => {
    // Given both owner-scoped child tables.
    // When their FK graph is compiled.
    const ownership = [connectionCredential, connectionMutationReceipt].map((table) => references(table).filter((fk) => fk.target === "connection"));
    // Then every owner/kind mismatch must cross a restrictive composite FK.
    expect(ownership).toEqual([0, 1].map(() => [{ columns: ["connection_id", "owner_user_id", "kind"], target: "connection", targetColumns: ["id", "owner_user_id", "kind"], onDelete: "restrict", onUpdate: "restrict" }]));
    expect(references(connection)).toEqual([{ columns: ["owner_user_id"], target: "user", targetColumns: ["id"], onDelete: "restrict", onUpdate: "restrict" }]);
  });

  test("keeps lifetime nonce identities independent of ciphertext deletion", () => {
    // Given the nonce ledger and both envelope consumers.
    // When inspecting the FK and primary-key graph.
    const ledger = getTableConfig(connectionNonce);
    const consumers = [connectionCredential, connectionKeyCheck].flatMap(references).filter((fk) => fk.target === "connection_nonce");
    // Then ledger rows have no parent cascade, and envelope deletion cannot remove them.
    expect(ledger.foreignKeys).toEqual([]);
    expect(ledger.primaryKeys.map((key) => key.columns.map((column) => column.name))).toEqual([["key_id", "nonce"]]);
    expect(consumers).toEqual([
      { columns: ["key_id", "nonce", "connection_id", "credential_version"], target: "connection_nonce", targetColumns: ["key_id", "nonce", "connection_id", "credential_version"], onDelete: "restrict", onUpdate: "restrict" },
      { columns: ["key_id", "nonce", "nonce_purpose"], target: "connection_nonce", targetColumns: ["key_id", "nonce", "purpose"], onDelete: "restrict", onUpdate: "restrict" },
    ]);
  });

  test("compiles bounded envelope and singleton accounting checks without parameters", () => {
    // Given two persisted envelope kinds.
    // When generating SQL checks with the PostgreSQL dialect.
    const compiled = [connectionCredential, connectionKeyCheck].map(constraints);
    // Then both bound their exact version, algorithm and binary sizes.
    for (const [position, prefix] of ["connection_credential", "connection_key_check"].entries()) {
      const checks = compiled[position];
      expect(checks?.[`${prefix}_envelope_check`]).toBe(`"${prefix}"."envelope_version" = 1 and "${prefix}"."algorithm" = 'aes-256-gcm'`);
      expect(checks?.[`${prefix}_nonce_check`]).toBe(`octet_length("${prefix}"."nonce") = 12`);
      expect(checks?.[`${prefix}_tag_check`]).toBe(`octet_length("${prefix}"."tag") = 16`);
      expect(checks?.[`${prefix}_ciphertext_check`]).toBe(`octet_length("${prefix}"."ciphertext") between 1 and 16384`);
    }
    expect(compiled[1]?.["connection_key_check_singleton_check"]).toBe('"connection_key_check"."id" = 1');
    expect(compiled[1]?.["connection_key_check_count_check"]).toBe('"connection_key_check"."encryption_count" between 1 and 1000000');
  });

  test("retains the original bounded metadata result separately from current state", () => {
    // Given the receipt table.
    // When inspecting its persisted fields and owner-scoped identity.
    const receipt = getTableConfig(connectionMutationReceipt);
    // Then the safe DTO survives later mutations, with only a fixed-size MAC for request comparison.
    expect(receipt.primaryKeys.map((key) => key.columns.map((column) => column.name))).toEqual([["owner_user_id", "operation_id"]]);
    expect(receipt.columns.map((column) => column.name)).toEqual(["owner_user_id", "operation_id", "operation", "connection_id", "expected_revision", "request_mac", "kind", "provider", "label", "state", "revision", "created_at", "updated_at", "expires_at", "revoked_at", "credential_version"]);
    expect(constraints(connectionMutationReceipt)["connection_receipt_mac_check"]).toBe('octet_length("connection_mutation_receipt"."request_mac") = 32');
    expect(tables.flatMap((table) => getTableConfig(table).columns).some((column) => ["json", "jsonb"].includes(column.getSQLType()))).toBe(false);
  });

  test("generates only the feature delta and references the pre-existing user table", async () => {
    // Given the retained generator output.
    const glob = new Bun.Glob("*/migration.sql");
    const files = await Array.fromAsync(glob.scan({ cwd: new URL("../../connection-test-migrations/", import.meta.url).pathname, absolute: true }));
    expect(files).toHaveLength(1);
    const path = files[0];
    if (!path) throw new Error("missing migration");
    // When reading the actual generated DDL.
    const migration = await Bun.file(path).text();
    // Then only the five feature tables are created; auth remains an external FK target.
    expect([...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]).sort()).toEqual(tables.map(getTableName).sort());
    expect(migration).toMatch(/REFERENCES "user"\("id"\) ON DELETE RESTRICT ON UPDATE RESTRICT/);
    expect(migration).not.toMatch(/DROP |ALTER TABLE "(?:user|account|session|membership|invitation|installation_identity|identity_audit)"/);
  });
});
