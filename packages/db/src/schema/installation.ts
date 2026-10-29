import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Singleton (id = 1). A missing row means the defaults: local network mode, onboarding pending. */
export const installationSettings = pgTable(
  "installation_settings",
  {
    id: integer("id").primaryKey(),
    networkMode: text("network_mode", { enum: ["local", "network"] })
      .default("local")
      .notNull(),
    publicUrl: text("public_url"),
    onboarding: text("onboarding", { enum: ["pending", "done"] })
      .default("pending")
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("installation_settings_singleton_check", sql`${table.id} = 1`),
    check(
      "installation_settings_network_url_check",
      sql`${table.networkMode} = 'local' or ${table.publicUrl} is not null`,
    ),
  ],
);
