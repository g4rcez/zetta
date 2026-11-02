import { boolean, jsonb, timestamp, uuid, text } from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { bot } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;

/**
 * A bot's private Postgres schema and the LOGIN role that alone may use it (modules/bot-database). Both are named `<snake slug>_bot`.
 * No password is stored: it is derived from a server key, so this row only records what was provisioned and the owner's switches.
 */
export const botDatabase = zetta.table("bot_database", {
  botId: uuid("bot_id")
    .primaryKey()
    .references(() => bot.id, restrict),
  schemaName: text("schema_name").notNull().unique(),
  roleName: text("role_name").notNull().unique(),
  // Owner's off switch: false hides the database tools from the bot (the data is kept).
  access: boolean("access").default(true).notNull(),
  templates: jsonb("templates").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }),
});
