import { searchText } from "../shared/search-params";

/**
 * The Apps list keeps its view in the address: the tab and the words searched. Defaults are left out, so the plain address is the
 * default view (the Apps tab). Pure, so the route and the tests share it.
 */
export type AppsSearch = {
  /** The Tools tab. Absent: Apps. */
  tab?: "tools";
  /** Words searched among the tools. */
  q?: string;
};
export function parseAppsSearch(raw: Record<string, unknown>): AppsSearch {
  const q = searchText(raw.q, 200);
  return { ...(raw.tab === "tools" ? { tab: "tools" as const } : {}), ...(q ? { q } : {}) };
}
export function withAppsSearch(
  current: AppsSearch,
  patch: Partial<Record<keyof AppsSearch, string | undefined>>,
) {
  return parseAppsSearch({ ...current, ...patch });
}

/** One app's page: which section is open. Absent: Open when the app has a page, else Tools. */
export type AppSearch = { tab?: "open" | "tools" | "data" | "versions" | "bots" | "calls" };
const APP_TABS = new Set(["open", "tools", "data", "versions", "bots", "calls"]);
export function parseAppSearch(raw: Record<string, unknown>): AppSearch {
  return typeof raw.tab === "string" && APP_TABS.has(raw.tab)
    ? { tab: raw.tab as NonNullable<AppSearch["tab"]> }
    : {};
}
export function withAppSearch(
  current: AppSearch,
  patch: Partial<Record<keyof AppSearch, string | undefined>>,
) {
  return parseAppSearch({ ...current, ...patch });
}
