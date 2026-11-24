import type { Database } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { layaModelFor, normalizeLayaLanguages, type LayaModel } from "@zetta/core/laya-languages";
import { installationSettings } from "@zetta/db/schema/installation";
import {
  DEFAULT_MAIL_SETTINGS,
  mailSettingsIssue,
  normalizeMailDomain,
  type MailSettings,
} from "@zetta/core/mail-provision";
import {
  DEFAULT_PHONE_SETTINGS,
  DEFAULT_PHONE_TWILIO_SETTINGS,
  isCountryCode,
  normalizeCountries,
  normalizePublicUrl,
  phoneSettingsIssue,
  type PhoneAllSettings,
} from "@zetta/core/phone";
import {
  DEFAULT_SPEECH_SETTINGS,
  normalizeSpeechSettings,
  speechSettingsIssue,
  type SpeechSettings,
  type TranscribeProvider,
} from "@zetta/core/speech";

export type NetworkMode = "local" | "network";
type InstallationCore = SpeechSettings & {
  networkMode: NetworkMode;
  publicUrl: string | null;
  onboarding: "pending" | "done";
  /** Builtin Laya decision model (plugin). */
  laya: "on" | "off";
  /** BCP-47 tags the Laya model must understand. "en" is always first. */
  layaLanguages: string[];
  /** Speech to text (modules/transcribe): the server's own model or a provider; the key is a sealed connection, never here. */
  transcribeProvider: TranscribeProvider;
  transcribeModel: string;
  transcribeLanguage: string;
  transcribeBaseUrl: string;
  transcribeConnectionId: string | null;
  /** Speech out (`SpeechSettings`, spread above): the provider and its texts. Its key is a sealed connection of provider `speech`. */
  speechConnectionId: string | null;
  /** Bot e-mail addresses (`MailSettings` in @zetta/core/mail-provision): the provider and the domain. Its key is a sealed connection of provider `mailprovider`; the cursor is the poller's own. */
  mailProvider: MailSettings["mailProvider"];
  mailDomain: string;
  mailConnectionId: string | null;
  mailCursor: string | null;
  /** Phone numbers for bots (`PhoneSettings` in @zetta/core/phone, spread above). The provider's key is a sealed connection of provider `phone`; its id is here and never leaves the server. */
  phoneConnectionId: string | null;
  /** The sealed Auth Token of the Twilio account (provider `phonetwilio`); the Telnyx key is `phoneConnectionId`. Never leaves the server. */
  phoneTwilioConnectionId: string | null;
  /** The sealed key of the shared WhatsApp server (provider `waha`; the address is the setting `wahaUrl`). Never leaves the server. */
  wahaConnectionId: string | null;
  /** Mobile push: the public VAPID key (public by design) and the sealed connection that holds the private one. Null until generated. */
  pushPublicKey: string | null;
  pushConnectionId: string | null;
  /** Whether the server checks once a day if a newer version is published (modules/updates). `off` sends nothing anywhere. */
  updateCheck: "on" | "off";
};
/** Everything saved on the installation, with the phone settings (`PhoneSettings` in @zetta/core/phone). */
export type InstallationSettings = InstallationCore & PhoneAllSettings;
export type InstallationPatch = Partial<InstallationSettings>;
/** The ids of the sealed connections that hold the installation's keys. No API returns them. */
export const SEALED_KEY_FIELDS = [
  "transcribeConnectionId",
  "speechConnectionId",
  "pushConnectionId",
  "mailConnectionId",
  "phoneConnectionId",
  "phoneTwilioConnectionId",
  "wahaConnectionId",
] as const;
/** What the API returns: the saved settings plus the model they select. The ids of the keys' connections never leave the server. */
export type InstallationView = Omit<InstallationSettings, (typeof SEALED_KEY_FIELDS)[number]> & {
  layaModel: LayaModel;
};
export const withLayaModel = (s: InstallationSettings): InstallationView => {
  const view: Record<string, unknown> = { ...s, layaModel: layaModelFor(s.layaLanguages) };
  for (const field of SEALED_KEY_FIELDS) delete view[field];
  // The poller's place in the provider's list is nobody's business but the poller's.
  delete view.mailCursor;
  return view as InstallationView;
};

const DEFAULTS: InstallationSettings = {
  networkMode: "local",
  publicUrl: null,
  onboarding: "pending",
  laya: "on",
  layaLanguages: ["en"],
  transcribeProvider: "local",
  transcribeModel: "",
  transcribeLanguage: "",
  transcribeBaseUrl: "",
  transcribeConnectionId: null,
  ...DEFAULT_SPEECH_SETTINGS,
  speechConnectionId: null,
  ...DEFAULT_MAIL_SETTINGS,
  mailConnectionId: null,
  mailCursor: null,
  ...DEFAULT_PHONE_SETTINGS,
  ...DEFAULT_PHONE_TWILIO_SETTINGS,
  phoneConnectionId: null,
  phoneTwilioConnectionId: null,
  wahaConnectionId: null,
  pushPublicKey: null,
  pushConnectionId: null,
  updateCheck: "on",
};

export class InvalidInstallationError extends Error {}

const fromRow = (row: typeof installationSettings.$inferSelect): InstallationSettings => ({
  networkMode: row.networkMode,
  publicUrl: row.publicUrl,
  onboarding: row.onboarding,
  laya: row.laya,
  layaLanguages: normalizeLayaLanguages(row.layaLanguages),
  transcribeProvider: row.transcribeProvider,
  transcribeModel: row.transcribeModel,
  transcribeLanguage: row.transcribeLanguage,
  transcribeBaseUrl: row.transcribeBaseUrl,
  transcribeConnectionId: row.transcribeConnectionId,
  speechProvider: row.speechProvider,
  speechBaseUrl: row.speechBaseUrl,
  speechModel: row.speechModel,
  speechVoice: row.speechVoice,
  speechLanguage: row.speechLanguage,
  speechConnectionId: row.speechConnectionId,
  mailProvider: row.mailProvider,
  mailDomain: row.mailDomain,
  mailConnectionId: row.mailConnectionId,
  mailCursor: row.mailCursor,
  phoneProvider: row.phoneProvider,
  phoneConnectionId: row.phoneConnectionId,
  phoneTwilio: row.phoneTwilio,
  phoneTwilioAccountSid: row.phoneTwilioAccountSid,
  phoneTwilioConnectionId: row.phoneTwilioConnectionId,
  phoneDefaultProvider: row.phoneDefaultProvider,
  wahaConnectionId: row.wahaConnectionId,
  phonePublicKey: row.phonePublicKey,
  phonePublicUrl: row.phonePublicUrl,
  phoneApplicationId: row.phoneApplicationId,
  phoneRequestMode: row.phoneRequestMode,
  phoneCountries: row.phoneCountries,
  phoneMaxNumbers: row.phoneMaxNumbers,
  phoneMaxCallMinutes: row.phoneMaxCallMinutes,
  phoneDailyMinutesPerBot: row.phoneDailyMinutesPerBot,
  phoneDailyCallsPerBot: row.phoneDailyCallsPerBot,
  pushPublicKey: row.pushPublicKey,
  pushConnectionId: row.pushConnectionId,
  updateCheck: row.updateCheck,
});

/** `onChange` runs after a saved update, so a running feature (Laya) follows the new setting without a restart. */
export function createInstallationService(
  db: Pick<Database, "select" | "insert">,
  onChange?: (settings: InstallationSettings) => void,
) {
  async function load(): Promise<InstallationSettings> {
    const [row] = await db
      .select()
      .from(installationSettings)
      .where(eq(installationSettings.id, 1))
      .limit(1);
    return row ? fromRow(row) : DEFAULTS;
  }
  return {
    load,
    async update(patch: InstallationPatch): Promise<InstallationSettings> {
      const before = await load();
      const next = { ...before, ...patch };
      next.layaLanguages = normalizeLayaLanguages(next.layaLanguages);
      // A provider that needs an address cannot be chosen without one; the address of a provider that does not use it is dropped.
      if (next.transcribeProvider === "compatible") {
        if (!next.transcribeBaseUrl)
          throw new InvalidInstallationError("A custom speech-to-text provider needs its address.");
      } else next.transcribeBaseUrl = "";
      // Speech out: the same rule (the address of a provider that takes none is dropped), and every text must fit its limit.
      const speech = normalizeSpeechSettings(next);
      const speechIssue = speechSettingsIssue(speech);
      if (speechIssue) throw new InvalidInstallationError(speechIssue);
      next.speechBaseUrl = speech.speechBaseUrl;
      // Bot addresses: the domain is stored as a plain lower case name, and a provider needs one. The poller's place restarts when the
      // provider or domain changes (the old place belongs to another account).
      next.mailDomain = normalizeMailDomain(next.mailDomain);
      const mailIssue = mailSettingsIssue(next);
      if (mailIssue) throw new InvalidInstallationError(mailIssue);
      if (before.mailProvider !== next.mailProvider || before.mailDomain !== next.mailDomain)
        if (patch.mailCursor === undefined) next.mailCursor = null;
      // Phone numbers: countries as upper case codes, the public address as an https origin, and a provider needs its pieces.
      // A word that is not a two-letter code is refused, not dropped: "brazil" must not quietly become "no countries".
      if (next.phoneCountries.split(/[\s,;]+/).some((c) => c && !isCountryCode(c.toUpperCase())))
        throw new InvalidInstallationError(
          "Give countries as two-letter codes, for example BR, US.",
        );
      next.phoneCountries = normalizeCountries(next.phoneCountries);
      next.phonePublicKey = next.phonePublicKey.trim();
      next.phoneApplicationId = next.phoneApplicationId.trim();
      next.phoneTwilioAccountSid = next.phoneTwilioAccountSid.trim();
      if (next.phonePublicUrl) {
        const origin = normalizePublicUrl(next.phonePublicUrl);
        if (origin) next.phonePublicUrl = origin;
      }
      const phoneIssue = phoneSettingsIssue(next);
      if (phoneIssue) throw new InvalidInstallationError(phoneIssue);
      if (next.networkMode === "local") next.publicUrl = null;
      else if (!next.publicUrl || new URL(next.publicUrl).protocol !== "https:") {
        throw new InvalidInstallationError("Network mode needs an https public URL.");
      }
      const values = {
        ...next,
        publicUrl: next.publicUrl ? new URL(next.publicUrl).origin : null,
        updatedAt: new Date(),
      };
      await db
        .insert(installationSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: installationSettings.id, set: values });
      const saved: InstallationSettings = {
        networkMode: values.networkMode,
        publicUrl: values.publicUrl,
        onboarding: values.onboarding,
        laya: values.laya,
        layaLanguages: values.layaLanguages,
        transcribeProvider: values.transcribeProvider,
        transcribeModel: values.transcribeModel,
        transcribeLanguage: values.transcribeLanguage,
        transcribeBaseUrl: values.transcribeBaseUrl,
        transcribeConnectionId: values.transcribeConnectionId,
        speechProvider: values.speechProvider,
        speechBaseUrl: values.speechBaseUrl,
        speechModel: values.speechModel,
        speechVoice: values.speechVoice,
        speechLanguage: values.speechLanguage,
        speechConnectionId: values.speechConnectionId,
        mailProvider: values.mailProvider,
        mailDomain: values.mailDomain,
        mailConnectionId: values.mailConnectionId,
        mailCursor: values.mailCursor,
        phoneProvider: values.phoneProvider,
        phoneConnectionId: values.phoneConnectionId,
        phoneTwilio: values.phoneTwilio,
        phoneTwilioAccountSid: values.phoneTwilioAccountSid,
        phoneTwilioConnectionId: values.phoneTwilioConnectionId,
        phoneDefaultProvider: values.phoneDefaultProvider,
        wahaConnectionId: values.wahaConnectionId,
        phonePublicKey: values.phonePublicKey,
        phonePublicUrl: values.phonePublicUrl,
        phoneApplicationId: values.phoneApplicationId,
        phoneRequestMode: values.phoneRequestMode,
        phoneCountries: values.phoneCountries,
        phoneMaxNumbers: values.phoneMaxNumbers,
        phoneMaxCallMinutes: values.phoneMaxCallMinutes,
        phoneDailyMinutesPerBot: values.phoneDailyMinutesPerBot,
        phoneDailyCallsPerBot: values.phoneDailyCallsPerBot,
        pushPublicKey: values.pushPublicKey,
        pushConnectionId: values.pushConnectionId,
        updateCheck: values.updateCheck,
      };
      onChange?.(saved);
      return saved;
    },
  };
}
export type InstallationService = ReturnType<typeof createInstallationService>;
