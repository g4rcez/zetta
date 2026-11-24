import { SETTING_GROUPS, type SettingGroup } from "@zetta/core/settings";
import { searchText } from "../shared/search-params";

/** The groups the page can filter on, in the order the registry lists them. */
export const SETTING_GROUP_FILTERS = Object.keys(SETTING_GROUPS) as SettingGroup[];
/** `all` is the default and is left out of the address; `changed` keeps the settings whose value is not the default. */
export const SETTINGS_SHOW = ["all", "changed"] as const;
export type SettingsShow = (typeof SETTINGS_SHOW)[number];

/** What the address of the Server settings tab holds. A filter at its default is left out. */
export type SettingsSearch = {
  group?: SettingGroup;
  show?: "changed";
  q?: string;
};

/** Drops every value that is not understood, so a hand-edited address never breaks the page. */
export function parseSettingsSearch(raw: Record<string, unknown>): SettingsSearch {
  const group = SETTING_GROUP_FILTERS.find((g) => g === raw.group);
  const q = searchText(raw.q, 100);
  return {
    ...(group ? { group } : {}),
    ...(raw.show === "changed" ? { show: "changed" as const } : {}),
    ...(q ? { q } : {}),
  };
}

/** The part of a setting the filters read. */
export type SettingFilterRow = {
  key: string;
  label: string;
  help: string;
  group: SettingGroup;
  source: "organization" | "installation" | "imported" | "default";
};

/** The settings a search keeps, in their order. The text matches the name, the help and the key. */
export function filterSettings<T extends SettingFilterRow>(
  rows: readonly T[],
  s: SettingsSearch,
): T[] {
  const q = (s.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (s.group && r.group !== s.group) return false;
    if (s.show === "changed" && r.source === "default") return false;
    if (!q) return true;
    return [r.label, r.help, r.key].some((t) => t.toLowerCase().includes(q));
  });
}
