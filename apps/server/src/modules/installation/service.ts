import type { Database } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { layaModelFor, normalizeLayaLanguages, type LayaModel } from "@zetta/core/laya-languages";
import { installationSettings } from "@zetta/db/schema/installation";

export type NetworkMode = "local" | "network";
export type InstallationSettings = {
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
};
export type InstallationPatch = Partial<InstallationSettings>;
/** What the API returns: the saved settings plus the model they select. The id of the key's connection never leaves the server. */
export type InstallationView = Omit<InstallationSettings, "transcribeConnectionId"> & {
  layaModel: LayaModel;
};
export const withLayaModel = (s: InstallationSettings): InstallationView => {
  const { transcribeConnectionId: _connection, ...rest } = s;
  return { ...rest, layaModel: layaModelFor(s.layaLanguages) };
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
      };
      onChange?.(saved);
      return saved;
    },
  };
}
export type InstallationService = ReturnType<typeof createInstallationService>;
