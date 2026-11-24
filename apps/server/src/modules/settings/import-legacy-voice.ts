// Upgrade path for the voice variables that were removed because the database already holds the value (`transcribe_provider`,
// `speech_provider`, `transcribe_model`, `transcribe_language`, `speech_model` of `installation_settings`). Like `import-env.ts` it runs at
// every start with the environment handed to it, writes only while the column still holds what it held before anyone chose, and says in
// one line which variable to remove. The value of a variable is never logged. Secrets are not here: they are never read.
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { installationSettings } from "@zetta/db/schema/installation";
import { LEGACY_VOICE_ENV as VAR } from "@zetta/core/settings";
import { localModelOf, languageCode } from "../transcribe/transcriber";
import { localSpeechModelOf } from "../speech/local";

export type LegacyVoiceImport = { column: string; env: string }[];

const isOff = (v: string | undefined) => v?.trim().toLowerCase() === "off";

export async function importLegacyVoiceSettings({
  db,
  env,
  log = (m) => console.info(m),
  warn = (m) => console.warn(m),
}: {
  db: Pick<Database, "select" | "insert" | "update">;
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}): Promise<LegacyVoiceImport> {
  const done: LegacyVoiceImport = [];
  const wrote = (column: string, name: string) => {
    done.push({ column, env: name });
    log(
      `installation setting ${column} imported from ${name}; it now lives in the database: remove the variable`,
    );
  };
  try {
    const row = () =>
      db
        .select()
        .from(installationSettings)
        .where(eq(installationSettings.id, 1))
        .then((r) => r[0]);
    const at = new Date();
    // ZETTA_TRANSCRIBE=off: the provider `off`, only while the column holds its default (`local`); a row that is not there yet holds it.
    if (isOff(env[VAR.transcribe])) {
      const rows = await db
        .insert(installationSettings)
        .values({ id: 1, transcribeProvider: "off" })
        .onConflictDoUpdate({
          target: installationSettings.id,
          set: { transcribeProvider: "off", updatedAt: at },
          setWhere: eq(installationSettings.transcribeProvider, "local"),
        })
        .returning({ id: installationSettings.id });
      if (rows.length) wrote("transcribeProvider", VAR.transcribe);
    }
    // ZETTA_SPEECH_LOCAL=off switched the local voice off: where the provider is `local`, it becomes `off`.
    if (isOff(env[VAR.speechLocal])) {
      const rows = await db
        .update(installationSettings)
        .set({ speechProvider: "off", updatedAt: at })
        .where(
          and(eq(installationSettings.id, 1), eq(installationSettings.speechProvider, "local")),
        )
        .returning({ id: installationSettings.id });
      if (rows.length) wrote("speechProvider", VAR.speechLocal);
    }
    // The model and language fallbacks of the voice that runs on this server: kept as stored values while the column is empty and the
    // provider is `local` (a provider's own model name must never receive a Whisper or Kokoro repository).
    const current = await row();
    if (current) {
      const set: Partial<typeof installationSettings.$inferInsert> = {};
      const model = localModelOf(env[VAR.transcribeModel]?.trim());
      if (current.transcribeProvider === "local" && !current.transcribeModel && model) {
        set.transcribeModel = model;
        wrote("transcribeModel", VAR.transcribeModel);
      }
      const language = languageCode(env[VAR.transcribeLanguage]);
      if (current.transcribeProvider === "local" && !current.transcribeLanguage && language) {
        set.transcribeLanguage = language;
        wrote("transcribeLanguage", VAR.transcribeLanguage);
      }
      const speech = localSpeechModelOf(env[VAR.speechModel]?.trim());
      if (current.speechProvider === "local" && !current.speechModel && speech) {
        set.speechModel = speech;
        wrote("speechModel", VAR.speechModel);
      }
      if (Object.keys(set).length)
        await db
          .update(installationSettings)
          .set({ ...set, updatedAt: at })
          .where(eq(installationSettings.id, 1));
    }
  } catch (error) {
    warn(
      `voice settings import skipped: ${error instanceof Error ? error.message : "the database refused"}`,
    );
  }
  return done;
}
