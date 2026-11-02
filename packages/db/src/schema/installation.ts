import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
    /** Builtin Laya decision model (plugin). Off by default: turning it on downloads about 1.7 GB. */
    laya: text("laya", { enum: ["on", "off"] })
      .default("off")
      .notNull(),
    /** BCP-47 tags the Laya model must understand ("en" always first). Any non-English tag selects the multilingual model. */
    layaLanguages: jsonb("laya_languages").$type<string[]>().default(["en"]).notNull(),
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
