import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bytea,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";

const metadataColumns = () => ({
  kind: text("kind", { enum: ["api-key"] }).notNull(),
  provider: text("provider").notNull(),
  label: text("label").notNull(),
  state: text("state", { enum: ["active", "revoked"] }).notNull(),
  revision: integer("revision").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

function metadataChecks(
  name: string,
  table: Readonly<Record<keyof ReturnType<typeof metadataColumns>, AnyPgColumn>>,
) {
  return [
    check(`${name}_kind_check`, sql`${table.kind} = 'api-key'`),
    check(
      `${name}_provider_check`,
      sql`${table.provider} collate "C" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`,
    ),
    check(
      `${name}_label_check`,
      sql`char_length(${table.label}) between 1 and 100 and octet_length(${table.label}) <= 400`,
    ),
    check(`${name}_revision_check`, sql`${table.revision} between 1 and 2147483647`),
    check(
      `${name}_state_check`,
      sql`(${table.state} = 'active' and ${table.revokedAt} is null) or (${table.state} = 'revoked' and ${table.revokedAt} is not null)`,
    ),
  ];
}

const envelopeColumns = () => ({
  envelopeVersion: integer("envelope_version").notNull(),
  algorithm: text("algorithm", { enum: ["aes-256-gcm"] }).notNull(),
  keyId: text("key_id").notNull(),
  nonce: bytea("nonce").notNull(),
  tag: bytea("tag").notNull(),
  ciphertext: bytea("ciphertext").notNull(),
});

function envelopeChecks(
  name: string,
  table: Readonly<Record<keyof ReturnType<typeof envelopeColumns>, AnyPgColumn>>,
) {
  return [
    check(
      `${name}_envelope_check`,
      sql`${table.envelopeVersion} = 1 and ${table.algorithm} = 'aes-256-gcm'`,
    ),
    check(`${name}_key_id_check`, sql`${table.keyId} collate "C" ~ '^[a-z0-9_-]{1,32}$'`),
    check(`${name}_nonce_check`, sql`octet_length(${table.nonce}) = 12`),
    check(`${name}_tag_check`, sql`octet_length(${table.tag}) = 16`),
    check(`${name}_ciphertext_check`, sql`octet_length(${table.ciphertext}) between 1 and 16384`),
  ];
}

// The service owns immutable identity, forward-only transitions and atomic current-version existence.
export const connection = zetta.table(
  "connection",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ...metadataColumns(),
    currentCredentialVersion: integer("current_credential_version").notNull(),
  },
  (table) => [
    ...metadataChecks("connection", table),
    check("connection_owner_check", sql`octet_length(${table.ownerUserId}) between 1 and 256`),
    check(
      "connection_version_check",
      sql`${table.currentCredentialVersion} between 1 and 2147483647`,
    ),
    unique("connection_owner_kind_unique").on(table.id, table.ownerUserId, table.kind),
    index("connection_owner_id_idx").on(table.ownerUserId, table.id),
  ],
);

// No cascading or reverse FK: tombstones survive deletion of ciphertext or connection rows.
export const connectionNonce = zetta.table(
  "connection_nonce",
  {
    keyId: text("key_id").notNull(),
    nonce: bytea("nonce").notNull(),
    purpose: text("purpose", { enum: ["credential", "key-check", "user-key"] }).notNull(),
    connectionId: uuid("connection_id"),
    credentialVersion: integer("credential_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.keyId, table.nonce] }),
    unique("connection_nonce_credential_unique").on(
      table.keyId,
      table.nonce,
      table.connectionId,
      table.credentialVersion,
    ),
    unique("connection_nonce_purpose_unique").on(table.keyId, table.nonce, table.purpose),
    check("connection_nonce_key_id_check", sql`${table.keyId} collate "C" ~ '^[a-z0-9_-]{1,32}$'`),
    check("connection_nonce_length_check", sql`octet_length(${table.nonce}) = 12`),
    check(
      "connection_nonce_identity_check",
      sql`
    (${table.purpose} in ('key-check', 'user-key') and ${table.connectionId} is null and ${table.credentialVersion} is null)
    or (${table.purpose} = 'credential' and ${table.connectionId} is not null and ${table.credentialVersion} is not null and ${table.credentialVersion} between 1 and 2147483647)
  `,
    ),
  ],
);

export const connectionCredential = zetta.table(
  "connection_credential",
  {
    connectionId: uuid("connection_id").notNull(),
    credentialVersion: integer("credential_version").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    kind: text("kind", { enum: ["api-key"] }).notNull(),
    ...envelopeColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("connection_credential_connection_id_owner_user_id_kind_idx").on(
      table.connectionId,
      table.ownerUserId,
      table.kind,
    ),
    index("connection_credential_key_id_nonce_connection_id_credential_ver").on(
      table.keyId,
      table.nonce,
      table.connectionId,
      table.credentialVersion,
    ),
    primaryKey({ columns: [table.connectionId, table.credentialVersion] }),
    check("connection_credential_kind_check", sql`${table.kind} = 'api-key'`),
    check(
      "connection_credential_version_check",
      sql`${table.credentialVersion} between 1 and 2147483647`,
    ),
    ...envelopeChecks("connection_credential", table),
    foreignKey({
      name: "connection_credential_owner_fk",
      columns: [table.connectionId, table.ownerUserId, table.kind],
      foreignColumns: [connection.id, connection.ownerUserId, connection.kind],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "connection_credential_nonce_fk",
      columns: [table.keyId, table.nonce, table.connectionId, table.credentialVersion],
      foreignColumns: [
        connectionNonce.keyId,
        connectionNonce.nonce,
        connectionNonce.connectionId,
        connectionNonce.credentialVersion,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
  ],
);

// One random 256-bit key per user, wrapped by the deployment key. Credentials are sealed under it with key id `u<keyVersion>`,
// so deleting this row makes that user's credentials unrecoverable and rotating the deployment key only rewraps these rows.
export const connectionUserKey = zetta.table(
  "connection_user_key",
  {
    ownerUserId: text("owner_user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "restrict", onUpdate: "restrict" }),
    keyVersion: integer("key_version").notNull(),
    ...envelopeColumns(),
    noncePurpose: text("nonce_purpose", { enum: ["user-key"] }).notNull(),
    encryptionCount: integer("encryption_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("connection_user_key_key_id_nonce_nonce_purpose_idx").on(
      table.keyId,
      table.nonce,
      table.noncePurpose,
    ),
    check(
      "connection_user_key_owner_check",
      sql`octet_length(${table.ownerUserId}) between 1 and 256`,
    ),
    check("connection_user_key_version_check", sql`${table.keyVersion} between 1 and 2147483647`),
    check("connection_user_key_purpose_check", sql`${table.noncePurpose} = 'user-key'`),
    check("connection_user_key_count_check", sql`${table.encryptionCount} between 0 and 1000000`),
    ...envelopeChecks("connection_user_key", table),
    foreignKey({
      name: "connection_user_key_nonce_fk",
      columns: [table.keyId, table.nonce, table.noncePurpose],
      foreignColumns: [connectionNonce.keyId, connectionNonce.nonce, connectionNonce.purpose],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
  ],
);

export const connectionKeyCheck = zetta.table(
  "connection_key_check",
  {
    id: integer("id").primaryKey(),
    ...envelopeColumns(),
    noncePurpose: text("nonce_purpose", { enum: ["key-check"] }).notNull(),
    encryptionCount: integer("encryption_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("connection_key_check_key_id_nonce_nonce_purpose_idx").on(
      table.keyId,
      table.nonce,
      table.noncePurpose,
    ),
    check("connection_key_check_singleton_check", sql`${table.id} = 1`),
    check("connection_key_check_purpose_check", sql`${table.noncePurpose} = 'key-check'`),
    check("connection_key_check_count_check", sql`${table.encryptionCount} between 1 and 1000000`),
    ...envelopeChecks("connection_key_check", table),
    foreignKey({
      name: "connection_key_check_nonce_fk",
      columns: [table.keyId, table.nonce, table.noncePurpose],
      foreignColumns: [connectionNonce.keyId, connectionNonce.nonce, connectionNonce.purpose],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
  ],
);

// These metadata fields are the original committed result, not a join to today's connection state.
export const connectionMutationReceipt = zetta.table(
  "connection_mutation_receipt",
  {
    ownerUserId: text("owner_user_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    operation: text("operation", {
      enum: ["create-api-key", "replace-api-key", "revoke"],
    }).notNull(),
    connectionId: uuid("connection_id").notNull(),
    expectedRevision: integer("expected_revision"),
    requestMac: bytea("request_mac").notNull(),
    ...metadataColumns(),
    credentialVersion: integer("credential_version").notNull(),
  },
  (table) => [
    index("connection_mutation_receipt_connection_id_owner_user_id_kind_id").on(
      table.connectionId,
      table.ownerUserId,
      table.kind,
    ),
    primaryKey({ columns: [table.ownerUserId, table.operationId] }),
    ...metadataChecks("connection_receipt", table),
    check("connection_receipt_mac_check", sql`octet_length(${table.requestMac}) = 32`),
    check(
      "connection_receipt_version_check",
      sql`${table.credentialVersion} between 1 and 2147483647`,
    ),
    check(
      "connection_receipt_operation_check",
      sql`
    (${table.operation} = 'create-api-key' and ${table.expectedRevision} is null and ${table.revision} = 1 and ${table.credentialVersion} = 1 and ${table.state} = 'active')
    or (${table.operation} in ('replace-api-key', 'revoke') and ${table.expectedRevision} is not null and ${table.expectedRevision} between 1 and 2147483646 and ${table.revision} = ${table.expectedRevision} + 1
      and ((${table.operation} = 'replace-api-key' and ${table.state} = 'active') or (${table.operation} = 'revoke' and ${table.state} = 'revoked')))
  `,
    ),
    foreignKey({
      name: "connection_receipt_owner_fk",
      columns: [table.connectionId, table.ownerUserId, table.kind],
      foreignColumns: [connection.id, connection.ownerUserId, connection.kind],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
  ],
);
