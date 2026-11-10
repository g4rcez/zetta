import { searchText } from "../shared/search-params";

/**
 * The "new bot" page keeps its view in the address: which starting point is open (the built-in templates, or the Grok Bot
 * marketplace), what was searched there, the category and the bot picked. Defaults are left out, so the plain address is the
 * templates view. Pure, so the route and the tests share it.
 */
export type BotsNewSearch = {
  /** The marketplace starting point. Absent: the built-in templates. */
  source?: "grok";
  /** Marketplace: words in a bot's name, creator or summary. */
  q?: string;
  /** Marketplace: one category. Absent: all. */
  category?: string;
  /** Marketplace: the bot picked (its id), shown in the preview. */
  grok?: string;
};

const MARKETPLACE_ID = /^[a-z0-9][a-z0-9_-]{0,80}$/;

/** `validateSearch` for the route: anything that is not understood is dropped. */
export function parseBotsNewSearch(raw: Record<string, unknown>): BotsNewSearch {
  // The search, category and pick only mean something inside the marketplace view.
  if (raw.source !== "grok") return {};
  const q = searchText(raw.q, 100);
  const category = searchText(raw.category, 60);
  const grok = typeof raw.grok === "string" && MARKETPLACE_ID.test(raw.grok) ? raw.grok : undefined;
  return {
    source: "grok",
    ...(q ? { q } : {}),
    ...(category ? { category } : {}),
    ...(grok ? { grok } : {}),
  };
}

/** The search after a change: empty values leave the address, so it stays short. */
export function withBotsNewSearch(
  current: BotsNewSearch,
  patch: Partial<Record<keyof BotsNewSearch, string | undefined>>,
): BotsNewSearch {
  return parseBotsNewSearch({ ...current, ...patch });
}
