import type { SettingKey, SettingValue } from "@zetta/core/settings";
import type { ActiveActor } from "../identity/access";
import { createSettingsService } from "./service";
import type { SettingScope, SettingsStore, StoredSetting } from "./store";

/** An in-memory `SettingsStore` with the semantics of the table: one row per key and scope, the installation scope included. For tests. */
export function createMemorySettingsStore(): SettingsStore & { reads: number } {
  const rows = new Map<string, StoredSetting>();
  const id = (scope: SettingScope, key: string) =>
    `${scope.kind === "installation" ? "installation" : `workspace:${scope.id}`}|${key}`;
  const prefix = (scope: SettingScope) =>
    `${scope.kind === "installation" ? "installation" : `workspace:${scope.id}`}|`;
  const store = {
    reads: 0,
    async readScope(scope: SettingScope) {
      store.reads++;
      const out = new Map<string, StoredSetting>();
      for (const [k, v] of rows)
        if (k.startsWith(prefix(scope))) out.set(k.slice(prefix(scope).length), { ...v });
      return out;
    },
    async upsert(scope: SettingScope, key: string, value: unknown, updatedBy: string | null) {
      rows.set(id(scope, key), { value: structuredClone(value), updatedBy, updatedAt: new Date() });
    },
    async insertMissing(scope: SettingScope, key: string, value: unknown) {
      if (rows.has(id(scope, key))) return false;
      rows.set(id(scope, key), {
        value: structuredClone(value),
        updatedBy: null,
        updatedAt: new Date(),
      });
      return true;
    },
    async remove(scope: SettingScope, key: string) {
      return rows.delete(id(scope, key));
    },
  };
  return store;
}

/**
 * A settings service over the in-memory store, with the two calls a test needs: `set` a value and `unset` it again. A reader under test is
 * handed `service`; the test changes a value between two calls to prove the change applies in the same process, with no restart. The cache
 * is dropped by every write, as in production.
 */
export function createTestSettings() {
  const store = createMemorySettingsStore();
  const service = createSettingsService({ store });
  const admin = { userId: "test-admin", isAdmin: true } as ActiveActor;
  return {
    store,
    service,
    set: <K extends SettingKey>(key: K, value: SettingValue<K>) =>
      service.set(admin, key, value, { via: "person" }),
    unset: (key: SettingKey) => service.unset(admin, key, { via: "person" }),
  };
}
