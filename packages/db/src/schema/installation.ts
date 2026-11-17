import { sql } from "drizzle-orm";
import { check, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

/** Singleton (id = 1). A missing row means the defaults: local network mode, onboarding pending. */
export const installationSettings = zetta.table(
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
    /** Builtin Laya decision model (plugin). On by default: the first boot downloads about 1.3 to 1.7 GB. An administrator can turn it off. */
    laya: text("laya", { enum: ["on", "off"] })
      .default("on")
      .notNull(),
    /** BCP-47 tags the Laya model must understand ("en" always first). Any non-English tag selects the multilingual model. */
    layaLanguages: jsonb("laya_languages").$type<string[]>().default(["en"]).notNull(),
    /**
     * Speech to text (modules/transcribe): the server's own Whisper model (`local`), OpenAI, or any server that speaks OpenAI's
     * /audio/transcriptions (`compatible`, with `transcribeBaseUrl`). Empty model and language mean the provider's default and the
     * language of the person's browser. The API key is not here: it is a sealed connection of provider `transcribe`.
     */
    transcribeProvider: text("transcribe_provider", { enum: ["local", "openai", "compatible"] })
      .default("local")
      .notNull(),
    transcribeModel: text("transcribe_model").default("").notNull(),
    transcribeLanguage: text("transcribe_language").default("").notNull(),
    transcribeBaseUrl: text("transcribe_base_url").default("").notNull(),
    transcribeConnectionId: uuid("transcribe_connection_id"),
    /** Whether the server checks once a day if a newer version is published. `off` sends nothing anywhere. */
    updateCheck: text("update_check", { enum: ["on", "off"] })
      .default("on")
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
