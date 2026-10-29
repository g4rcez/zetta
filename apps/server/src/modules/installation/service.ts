import type { Database } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { installationSettings } from "@zetta/db/schema/installation";

export type NetworkMode = "local" | "network";
export type InstallationSettings = {
  networkMode: NetworkMode;
  publicUrl: string | null;
  onboarding: "pending" | "done";
};
export type InstallationPatch = Partial<InstallationSettings>;

const DEFAULTS: InstallationSettings = {
  networkMode: "local",
  publicUrl: null,
  onboarding: "pending",
};

export class InvalidInstallationError extends Error {}

export function createInstallationService(db: Pick<Database, "select" | "insert">) {
  async function load(): Promise<InstallationSettings> {
    const [row] = await db
      .select()
      .from(installationSettings)
      .where(eq(installationSettings.id, 1))
      .limit(1);
    return row
      ? { networkMode: row.networkMode, publicUrl: row.publicUrl, onboarding: row.onboarding }
      : DEFAULTS;
  }
  return {
    load,
    async update(patch: InstallationPatch): Promise<InstallationSettings> {
      const next = { ...(await load()), ...patch };
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
      return {
        networkMode: values.networkMode,
        publicUrl: values.publicUrl,
        onboarding: values.onboarding,
      };
    },
  };
}
export type InstallationService = ReturnType<typeof createInstallationService>;
