import { searchText } from "../shared/search-params";

/** The `/bots` page keeps its filter in the address: the words searched in a bot's name, role or description. The plain address lists every bot. */
export type BotsSearch = { q?: string };

/** `validateSearch` for the route: anything that is not understood is dropped. */
export function parseBotsSearch(raw: Record<string, unknown>): BotsSearch {
  const q = searchText(raw.q, 100);
  return q ? { q } : {};
}

type Searchable = { name: string; role?: string; description: string };

/** The bots that match every word of `q`, in their original order. Empty `q` keeps them all. */
export function filterBots<T extends Searchable>(bots: readonly T[], q: string | undefined): T[] {
  const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...bots];
  return bots.filter((b) => {
    const hay = `${b.name} ${b.role ?? ""} ${b.description}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
