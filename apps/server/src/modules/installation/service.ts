import type { Database } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { layaModelFor, normalizeLayaLanguages, type LayaModel } from "@zetta/core/laya-languages";
import { installationSettings } from "@zetta/db/schema/installation";
import {
  DEFAULT_SPEECH_SETTINGS,
  normalizeSpeechSettings,
  speechSettingsIssue,
  type SpeechSettings,
} from "@zetta/core/speech";

export type NetworkMode = "local" | "network";
export type InstallationSettings = SpeechSettings & {
  networkMode: NetworkMode;
  publicUrl: string | null;
  onboarding: "pending" | "done";
  /** Builtin Laya decision model (plugin). */
  laya: "on" | "off";
  /** BCP-47 tags the Laya model must understand. "en" is always first. */
  layaLanguages: string[];
  /** Speech to text (modules/transcribe): the server's own model or a provider; the key is a sealed connection, never here. */
  transcribeProvider: "local" | "openai" | "compatible";
  transcribeModel: string;
  transcribeLanguage: string;
  transcribeBaseUrl: string;
  transcribeConnectionId: string | null;
  /** Speech out (`SpeechSettings`, spread above): the provider and its texts. Its key is a sealed connection of provider `speech`. */
  speechConnectionId: string | null;
  /** Mobile push: the public VAPID key (public by design) and the sealed connection that holds the private one. Null until generated. */
  pushPublicKey: string | null;
  pushConnectionId: string | null;
  /** Whether the server checks once a day if a newer version is published (modules/updates). `off` sends nothing anywhere. */
  updateCheck: "on" | "off";
};
export type InstallationPatch = Partial<InstallationSettings>;
/** The ids of the sealed connections that hold the installation's keys. No API returns them. */
export const SEALED_KEY_FIELDS = [
  "transcribeConnectionId",
  "speechConnectionId",
  "pushConnectionId",
] as const;
/** What the API returns: the saved settings plus the model they select. The ids of the keys' connections never leave the server. */
export type InstallationView = Omit<InstallationSettings, (typeof SEALED_KEY_FIELDS)[number]> & {
  layaModel: LayaModel;
};
export const withLayaModel = (s: InstallationSettings): InstallationView => {
  const view: Record<string, unknown> = { ...s, layaModel: layaModelFor(s.layaLanguages) };
  for (const field of SEALED_KEY_FIELDS) delete view[field];
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
      const next = { ...(await load()), ...patch };
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
