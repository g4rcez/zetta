import { isUuid, searchText } from "../shared/search-params";

/**
 * The Lessons page keeps its view in the URL: what was searched, which verdict, which kind of item, whose bot and the order. Defaults are
 * left out, so the plain address is the default view (the worst first). Pure, so the route and the tests share it.
 */
export type LessonsSearch = {
  /** The suggestions of the tidy-up. Absent: what is worth keeping. */
  tab?: "suggestions";
  /** Words in the title, slug, how-to or tags. */
  find?: string;
  /** Only items with this verdict. Absent: all. */
  label?: "helps" | "unclear" | "hurts" | "unused";
  /** Only memory items, or only skills. Absent: both. */
  kind?: "memory" | "skill";
  /** The order. Absent: the worst first. */
  sort?: "best" | "uses" | "recent" | "name";
  /** Only what this bot used, brings, or wrote as its own note. */
  bot?: string;
  /** The archived items, to bring back. Absent: the active ones. */
  view?: "archived";
};

const LABELS = ["helps", "unclear", "hurts", "unused"] as const;
const SORTS = ["best", "uses", "recent", "name"] as const;

/** `validateSearch` for the route: anything that is not understood is dropped. */
export function parseLessonsSearch(raw: Record<string, unknown>): LessonsSearch {
  const find = searchText(raw.find, 100);
  return {
    ...(raw.tab === "suggestions" ? { tab: "suggestions" as const } : {}),
    ...(find ? { find } : {}),
    ...(LABELS.find((l) => l === raw.label) ? { label: raw.label as LessonsSearch["label"] } : {}),
    ...(raw.kind === "memory" || raw.kind === "skill" ? { kind: raw.kind } : {}),
    ...(SORTS.find((s) => s === raw.sort) ? { sort: raw.sort as LessonsSearch["sort"] } : {}),
    ...(isUuid(raw.bot) ? { bot: raw.bot } : {}),
    ...(raw.view === "archived" ? { view: "archived" as const } : {}),
  };
}

/** The search after a change: empty values leave the address, so it stays short. */
export function withLessonsSearch(
  current: LessonsSearch,
  patch: Partial<Record<keyof LessonsSearch, string | undefined>>,
) {
  return parseLessonsSearch({ ...current, ...patch });
}
