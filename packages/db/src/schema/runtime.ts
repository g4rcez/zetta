import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { zetta } from "./pg-schema";

/**
 * One row per running server process. A process writes `heartbeat_at` from the database clock every few seconds; work that names a
 * dead instance (no heartbeat for a while, or `stopped_at` set) is recovered by the others, and work of a live instance is left alone.
 */
export const serverInstance = zetta.table(
  "server_instance",
  {
    id: uuid("id").primaryKey(),
    /** Operator-facing name (`ZETTA_INSTANCE_NAME`, default host:port). A new process with the name of a stopped one replaces it. */
    name: text("name").notNull(),
    role: text("role", { enum: ["all", "api", "worker"] }).notNull(),
    version: text("version"),
    /** Where another instance can reach this one (reserved for proxying a request to the owner of a turn). */
    internalUrl: text("internal_url"),
    capabilities: jsonb("capabilities"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).defaultNow().notNull(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (t) => [
    index("server_instance_live_idx")
      .on(t.heartbeatAt)
      .where(sql`${t.stoppedAt} is null`),
    index("server_instance_name_idx").on(t.name),
  ],
);

/** Better Auth's rate limit counters (`rateLimit.storage: "database"`), shared by every instance. Rows are keyed by client address and path. */
export const rateLimit = zetta.table("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/**
 * The key pair browsers seal credentials to (see @zetta/core/sealed-transport), one per hour. The private half is sealed under the
 * connection key that already protects stored secrets, so every instance can open a body sealed to a key another instance made.
 */
export const transportKey = zetta.table("transport_key", {
  kid: text("kid").primaryKey(),
  publicJwk: jsonb("public_jwk").notNull(),
  privateSealed: text("private_sealed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
