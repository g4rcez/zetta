import { isUuid, searchText } from "../shared/search-params";

/**
 * The Skills page keeps its view in the URL: the tab, what was searched, the filter over the list and whose skills are listed.
 * Defaults are left out, so the plain address is the default view. Pure, so the route and the tests share it.
 */
export type SkillsSearch = {
  /** The marketplace tab. Absent: My skills. */
  tab?: "market";
  /** What was searched in the marketplace: words, `owner/repo` or a link. */
  q?: string;
  /** A filter over the skills listed in the marketplace results. */
  filter?: string;
  /** An admin looking at every person's skills. Absent: only their own. */
  scope?: "all";
  /** My skills: words in the name or description. */
  find?: string;
  /** My skills: where it came from. Absent: both. */
  source?: "github" | "manual";
  /** My skills: the order. Absent: most recently changed first. */
  sort?: "name" | "used" | "size";
  /** My skills: only those this bot brings. */
  bot?: string;
  /** My skills: the removed ones, to restore. Absent: the active ones. */
  view?: "archived";
  /** My skills: only those no bot used in the last 30 days. */
  use?: "unused";
};

/** `validateSearch` for the route: anything that is not understood is dropped. */
export function parseSkillsSearch(raw: Record<string, unknown>): SkillsSearch {
  const q = searchText(raw.q, 300);
  const filter = searchText(raw.filter, 100);
  return {
    ...(raw.tab === "market" ? { tab: "market" as const } : {}),
    ...(q ? { q } : {}),
    ...(filter ? { filter } : {}),
    ...(raw.scope === "all" ? { scope: "all" as const } : {}),
    ...(searchText(raw.find, 100) ? { find: searchText(raw.find, 100)! } : {}),
    ...(raw.source === "github" || raw.source === "manual" ? { source: raw.source } : {}),
    ...(raw.sort === "name" || raw.sort === "used" || raw.sort === "size"
      ? { sort: raw.sort }
      : {}),
    ...(isUuid(raw.bot) ? { bot: raw.bot } : {}),
    ...(raw.view === "archived" ? { view: "archived" as const } : {}),
    ...(raw.use === "unused" ? { use: "unused" as const } : {}),
  };
}

/** The search after a change: empty values leave the address, so it stays short. */
export function withSearch(
  current: SkillsSearch,
  patch: Partial<Record<keyof SkillsSearch, string | undefined>>,
) {
  return parseSkillsSearch({ ...current, ...patch });
}
