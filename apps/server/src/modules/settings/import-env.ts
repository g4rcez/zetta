// Upgrade path: a value that an administrator set in an environment variable before the setting moved to the database is stored once, so
// behaviour does not change on the first start after the upgrade. It runs at every start and writes only what is missing, so it is safe to
// run twice and with several instances starting at the same time (`on conflict do nothing`). Secrets are never imported (none are in the
// registry). A line says which variable to remove; the value is never logged.
import type { Database } from "@zetta/db";
import {
  SECRETS_NOT_IMPORTED,
  SETTINGS,
  parseSettingValue,
  settingFromEnv,
  type SettingKey,
} from "@zetta/core/settings";
import { createSettingsStore, type SettingsStore } from "./store";

export type EnvImportResult = {
  /** Keys written now, with the variable they came from. */
  imported: { key: SettingKey; env: string }[];
  /** Keys whose variable is set but could not be used: the default stays. */
  skipped: { key: SettingKey; env: string; reason: "unusable" | "invalid" }[];
};

export async function importEnvSettings({
  db,
  store: given,
  env,
  log = (m) => console.info(m),
  warn = (m) => console.warn(m),
}: {
  db?: Pick<Database, "select" | "insert" | "delete">;
  /** Replaces `db` in tests. */
  store?: SettingsStore;
  /** The environment to read. Passed in so this module reads no environment of its own. */
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}): Promise<EnvImportResult> {
  const opened = given ?? (db ? createSettingsStore(db) : undefined);
  if (!opened) throw new Error("The import needs a database or a store.");
  const store: SettingsStore = opened;
  const result: EnvImportResult = { imported: [], skipped: [] };
  try {
    for (const key of Object.keys(SETTINGS) as SettingKey[]) {
      const def = SETTINGS[key];
      const names = [def.env, ...((def as { envAlso?: readonly string[] }).envAlso ?? [])];
      const name = names.find((n) => env[n]?.trim());
      if (!name) continue;
      const candidate = settingFromEnv(key, env[name]!);
      const parsed = candidate === undefined ? undefined : parseSettingValue(key, candidate);
      if (!parsed?.ok) {
        const reason = parsed ? "invalid" : "unusable";
        result.skipped.push({ key, env: name, reason });
        warn(
          `setting ${key}: ${name} is set but is not a usable value, so it is ignored and the default stays. Remove the variable or set the value in Studio.`,
        );
        continue;
      }
      if (await store.insertMissing({ kind: "installation" }, key, parsed.value)) {
        result.imported.push({ key, env: name });
        log(
          `setting ${key} imported from ${name}; it now lives in the database: remove the variable`,
        );
      }
    }
    // A secret is never copied: it needs an administrator who owns it. Say where to save it; never say the value.
    for (const [name, where] of Object.entries(SECRETS_NOT_IMPORTED))
      if (env[name]?.trim())
        warn(
          `${name} is set but is ignored: secrets are never read from the environment. Save the key in ${where}, then remove the variable.`,
        );
  } catch (error) {
    // Most likely the table is not there yet (a migration that has not run). Starting is more important than importing.
    warn(
      `settings import skipped: ${error instanceof Error ? error.message : "the database refused"}`,
    );
  }
  return result;
}
