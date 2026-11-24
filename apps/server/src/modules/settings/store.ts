import type { Database } from "@zetta/db";
import { and, eq, isNull } from "@zetta/db/query";
import { setting } from "@zetta/db/schema/settings";

/** Where a value is stored: the whole installation, or one workspace (organization). */
export type SettingScope = { kind: "installation" } | { kind: "workspace"; id: string };
export type StoredSetting = { value: unknown; updatedBy: string | null; updatedAt: Date };
type Db = Pick<Database, "select" | "insert" | "delete">;

const scopeWhere = (scope: SettingScope) =>
  scope.kind === "installation"
    ? and(eq(setting.scopeKind, "installation"), isNull(setting.scopeId))
    : and(eq(setting.scopeKind, "workspace"), eq(setting.scopeId, scope.id));
const scopeColumns = (scope: SettingScope) =>
  scope.kind === "installation"
    ? { scopeKind: "installation" as const, scopeId: null }
    : { scopeKind: "workspace" as const, scopeId: scope.id };

/** The rows of the setting table: raw values, no validation (the service validates against the registry). */
export function createSettingsStore(db: Db) {
  return {
    /** Every stored key of one scope. */
    async readScope(scope: SettingScope): Promise<Map<string, StoredSetting>> {
      const rows = await db.select().from(setting).where(scopeWhere(scope));
      return new Map(
        rows.map((r) => [
          r.key,
          { value: r.value, updatedBy: r.updatedBy, updatedAt: r.updatedAt },
        ]),
      );
    },
    /** Saves a value, replacing the one of that key and scope. */
    async upsert(scope: SettingScope, key: string, value: unknown, updatedBy: string | null) {
      const now = new Date();
      await db
        .insert(setting)
        .values({ ...scopeColumns(scope), key, value, updatedBy, updatedAt: now })
        .onConflictDoUpdate({
          target: [setting.scopeKind, setting.scopeId, setting.key],
          set: { value, updatedBy, updatedAt: now },
        });
    },
    /** Writes only when nothing is stored for that key and scope. Returns whether it wrote. Safe with several processes at once. */
    async insertMissing(scope: SettingScope, key: string, value: unknown): Promise<boolean> {
      const rows = await db
        .insert(setting)
        .values({ ...scopeColumns(scope), key, value, updatedBy: null })
        .onConflictDoNothing()
        .returning({ key: setting.key });
      return rows.length > 0;
    },
    /** Removes the stored value, so the next scope (or the default) counts again. Returns whether there was one. */
    async remove(scope: SettingScope, key: string): Promise<boolean> {
      const rows = await db
        .delete(setting)
        .where(and(scopeWhere(scope), eq(setting.key, key)))
        .returning({ key: setting.key });
      return rows.length > 0;
    },
  };
}
export type SettingsStore = ReturnType<typeof createSettingsStore>;
