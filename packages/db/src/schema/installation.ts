import { sql } from "drizzle-orm";
import { check, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { DEFAULT_MAIL_PROVIDER, MAIL_LIMITS, MAIL_PROVIDERS } from "@zetta/core/mail-provision";
import {
  DEFAULT_PHONE_SETTINGS,
  DEFAULT_PHONE_TWILIO_SETTINGS,
  PHONE_LIMITS,
  PHONE_PROVIDER_IDS,
  PHONE_PROVIDERS,
  PHONE_REQUEST_MODES,
  PHONE_TWILIO_SWITCHES,
} from "@zetta/core/phone";
import {
  DEFAULT_SPEECH_PROVIDER,
  SPEECH_LIMITS,
  SPEECH_PROVIDERS,
  TRANSCRIBE_PROVIDERS,
} from "@zetta/core/speech";
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
     * Speech to text (modules/transcribe): `off`, the server's own Whisper model (`local`, the default), OpenAI, or any server that speaks OpenAI's
     * /audio/transcriptions (`compatible`, with `transcribeBaseUrl`). Empty model and language mean the provider's default and the
     * language of the person's browser. The API key is not here: it is a sealed connection of provider `transcribe`.
     */
    transcribeProvider: text("transcribe_provider", { enum: TRANSCRIBE_PROVIDERS })
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
    /**
     * Bot e-mail addresses: `off | resend`. The domain the addresses live on (empty while off). The provider's API key is a sealed
     * connection of provider `mailprovider` (purpose `installation.mail-key`); `mailConnectionId` records which one (no foreign key, the
     * API never returns it). `mailCursor` is the id of the newest received mail the poller has stored, so a restart picks up there.
     */
    mailProvider: text("mail_provider", { enum: MAIL_PROVIDERS })
      .default(DEFAULT_MAIL_PROVIDER)
      .notNull(),
    mailDomain: text("mail_domain").default("").notNull(),
    mailConnectionId: uuid("mail_connection_id"),
    mailCursor: text("mail_cursor"),
    /**
     * Phone numbers for bots: `off | telnyx`. The provider's API key is a sealed connection of provider `phone` (purpose
     * `installation.phone-key`); `phoneConnectionId` records which one (no foreign key, the API never returns it). The public key (for
     * webhook signatures), the public address and the provider's call application id are not secrets. `phoneCountries` is the list of
     * countries numbers may be ordered in; the limits bound cost. See docs/operations/phone.md.
     */
    phoneProvider: text("phone_provider", { enum: PHONE_PROVIDERS })
      .default(DEFAULT_PHONE_SETTINGS.phoneProvider)
      .notNull(),
    phoneConnectionId: uuid("phone_connection_id"),
    phonePublicKey: text("phone_public_key").default("").notNull(),
    phonePublicUrl: text("phone_public_url").default("").notNull(),
    phoneApplicationId: text("phone_application_id").default("").notNull(),
    phoneRequestMode: text("phone_request_mode", { enum: PHONE_REQUEST_MODES })
      .default(DEFAULT_PHONE_SETTINGS.phoneRequestMode)
      .notNull(),
    phoneCountries: text("phone_countries").default("").notNull(),
    phoneMaxNumbers: integer("phone_max_numbers")
      .default(DEFAULT_PHONE_SETTINGS.phoneMaxNumbers)
      .notNull(),
    phoneMaxCallMinutes: integer("phone_max_call_minutes")
      .default(DEFAULT_PHONE_SETTINGS.phoneMaxCallMinutes)
      .notNull(),
    phoneDailyMinutesPerBot: integer("phone_daily_minutes_per_bot")
      .default(DEFAULT_PHONE_SETTINGS.phoneDailyMinutesPerBot)
      .notNull(),
    phoneDailyCallsPerBot: integer("phone_daily_calls_per_bot")
      .default(DEFAULT_PHONE_SETTINGS.phoneDailyCallsPerBot)
      .notNull(),
    /**
     * Twilio next to Telnyx. `phoneProvider` and `phoneConnectionId` above are the Telnyx switch and its sealed key (their names were kept so
     * nothing is renamed). Twilio has its own switch, its Account SID (public) and its Auth Token as a sealed connection of provider
     * `phonetwilio` (purpose `installation.phone-twilio-key`). `phoneDefaultProvider` is used when a request names no provider. The
     * provider of a number is on the number (`phone_number.provider`).
     */
    phoneTwilio: text("phone_twilio", { enum: PHONE_TWILIO_SWITCHES })
      .default(DEFAULT_PHONE_TWILIO_SETTINGS.phoneTwilio)
      .notNull(),
    phoneTwilioAccountSid: text("phone_twilio_account_sid").default("").notNull(),
    phoneTwilioConnectionId: uuid("phone_twilio_connection_id"),
    phoneDefaultProvider: text("phone_default_provider", { enum: PHONE_PROVIDER_IDS })
      .default(DEFAULT_PHONE_TWILIO_SETTINGS.phoneDefaultProvider)
      .notNull(),
    /**
     * The WhatsApp server (WAHA) every person shares who uses WhatsApp without their own server. Its address is the setting `wahaUrl`; its
     * API key is a sealed connection of provider `waha` (purpose `installation.waha-key`), and `wahaConnectionId` records which one (no
     * foreign key, the API never returns it).
     */
    wahaConnectionId: uuid("waha_connection_id"),
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
      "installation_settings_mail_check",
      sql`${table.mailProvider} in ('off', 'resend') and length(${table.mailDomain}) <= ${sql.raw(String(MAIL_LIMITS.domain))} and (${table.mailCursor} is null or length(${table.mailCursor}) <= ${sql.raw(String(MAIL_LIMITS.cursor))})`,
    ),
    check(
      "installation_settings_phone_check",
      sql`${table.phoneProvider} in ('off', 'telnyx') and ${table.phoneRequestMode} in ('off', 'owner_request', 'operator_approval') and length(${table.phonePublicKey}) <= ${sql.raw(String(PHONE_LIMITS.publicKey))} and length(${table.phonePublicUrl}) <= ${sql.raw(String(PHONE_LIMITS.publicUrl))} and length(${table.phoneApplicationId}) <= ${sql.raw(String(PHONE_LIMITS.applicationId))} and length(${table.phoneCountries}) <= ${sql.raw(String(PHONE_LIMITS.countries))}`,
    ),
    check(
      "installation_settings_phone_twilio_check",
      sql`${table.phoneTwilio} in ('off', 'on') and ${table.phoneDefaultProvider} in ('telnyx', 'twilio') and length(${table.phoneTwilioAccountSid}) <= ${sql.raw(String(PHONE_LIMITS.accountSid))}`,
    ),
    check(
      "installation_settings_phone_limits_check",
      sql`${table.phoneMaxNumbers} between ${sql.raw(String(PHONE_LIMITS.maxNumbers.min))} and ${sql.raw(String(PHONE_LIMITS.maxNumbers.max))} and ${table.phoneMaxCallMinutes} between ${sql.raw(String(PHONE_LIMITS.maxCallMinutes.min))} and ${sql.raw(String(PHONE_LIMITS.maxCallMinutes.max))} and ${table.phoneDailyMinutesPerBot} between ${sql.raw(String(PHONE_LIMITS.dailyMinutesPerBot.min))} and ${sql.raw(String(PHONE_LIMITS.dailyMinutesPerBot.max))} and ${table.phoneDailyCallsPerBot} between ${sql.raw(String(PHONE_LIMITS.dailyCallsPerBot.min))} and ${sql.raw(String(PHONE_LIMITS.dailyCallsPerBot.max))}`,
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
