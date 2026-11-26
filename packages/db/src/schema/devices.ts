import { sql } from "drizzle-orm";
import { check, index, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";
import { inWorkspace } from "./workspace-table";

import { user } from "./auth";
import { bot } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const owner = () =>
  text("owner_user_id")
    .notNull()
    .references(() => user.id, restrict);

/**
 * A computer that keeps a connection open to this server (the Zetta desktop app) so the owner's bots can run work on it. The row holds no
 * secret: `credential_hash` is the SHA-256 of a random credential that was shown once, when the app signed in and paired. A device is
 * revoked, not deleted, so the audit trail keeps its name.
 */
export const device = zetta.table(
  "device",
  {
    workspaceId: inWorkspace(),
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    name: text("name").notNull(),
    /** `darwin`, `linux` or `win32`: what the bot is told the computer is. */
    platform: text("platform").notNull(),
    credentialHash: text("credential_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    check("device_name_check", sql`length(${t.name}) between 1 and 60`),
    check("device_platform_check", sql`${t.platform} in ('darwin', 'linux', 'win32')`),
    check("device_credential_check", sql`length(${t.credentialHash}) = 64`),
    uniqueIndex("device_credential_hash_unique").on(t.credentialHash),
    uniqueIndex("device_owner_name_unique")
      .on(t.workspaceId, t.ownerUserId, t.name)
      .where(sql`${t.revokedAt} is null`),
    index("device_owner_idx").on(t.ownerUserId),
  ],
);

/** Which bots may use a device. A device nobody is listed for is used by no bot. A row goes when the device or the bot does. */
export const deviceBot = zetta.table(
  "device_bot",
  {
    workspaceId: inWorkspace(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade", onUpdate: "restrict" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, { onDelete: "cascade", onUpdate: "restrict" }),
    ownerUserId: owner(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.botId] }),
    index("device_bot_bot_id_idx").on(t.botId),
    index("device_bot_owner_idx").on(t.ownerUserId),
  ],
);
