import { sql } from "drizzle-orm";
import { check, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { DEFAULT_SPEECH_PROVIDER, SPEECH_LIMITS, SPEECH_PROVIDERS } from "@zetta/core/speech";
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
    /**
     * Speech out (text to speech): `off | browser | openai | compatible | elevenlabs`. `browser` needs no setup. Empty model, voice and
     * language mean the provider's default. `speechBaseUrl` is used by `compatible` only. The API key is not here: it is a sealed
     * connection of provider `speech` (purpose `installation.speech-key`), and `speechConnectionId` records which one (no foreign key,
     * like `transcribeConnectionId`: the API never returns it).
     */
    speechProvider: text("speech_provider", { enum: SPEECH_PROVIDERS })
      .default(DEFAULT_SPEECH_PROVIDER)
      .notNull(),
    speechBaseUrl: text("speech_base_url").default("").notNull(),
    speechModel: text("speech_model").default("").notNull(),
    speechVoice: text("speech_voice").default("").notNull(),
    speechLanguage: text("speech_language").default("").notNull(),
    speechConnectionId: uuid("speech_connection_id"),
    /**
     * Mobile push (Web Push, VAPID). The public key is public by design: the browser needs it to subscribe. The private key is a sealed
     * connection of provider `push` (purpose `installation.push-key`) owned by the administrator who installed; `pushConnectionId`
     * records which one (never returned by the API). Both are null until the server generates the pair at first use.
     */
    pushPublicKey: text("push_public_key"),
    pushConnectionId: uuid("push_connection_id"),
    /** Whether the server checks once a day if a newer version is published. `off` sends nothing anywhere. */
    updateCheck: text("update_check", { enum: ["on", "off"] })
      .default("on")
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("installation_settings_singleton_check", sql`${table.id} = 1`),
    check(
      "installation_settings_speech_check",
      sql`length(${table.speechBaseUrl}) <= ${sql.raw(String(SPEECH_LIMITS.baseUrl))} and length(${table.speechModel}) <= ${sql.raw(String(SPEECH_LIMITS.model))} and length(${table.speechVoice}) <= ${sql.raw(String(SPEECH_LIMITS.voice))} and length(${table.speechLanguage}) <= ${sql.raw(String(SPEECH_LIMITS.language))}`,
    ),
    check(
      "installation_settings_push_public_key_check",
      sql`${table.pushPublicKey} is null or length(${table.pushPublicKey}) between 1 and 200`,
    ),
    check(
      "installation_settings_network_url_check",
      sql`${table.networkMode} = 'local' or ${table.publicUrl} is not null`,
    ),
  ],
);
