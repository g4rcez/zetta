import { searchText } from "../shared/search-params";

/** The People page keeps what was searched in the address, so a reload or a shared link shows the same list. */
export type PeopleSearch = {
  /** Words in a name, job title or department. Absent: everyone. */
  q?: string;
};

/** `validateSearch` for the route: anything that is not understood is dropped. */
export function parsePeopleSearch(raw: Record<string, unknown>): PeopleSearch {
  const q = searchText(raw.q, 100);
  return q ? { q } : {};
}

/** The search after a change: an empty value leaves the address. */
export const withPeopleSearch = (
  current: PeopleSearch,
  patch: Partial<Record<keyof PeopleSearch, string | undefined>>,
) => parsePeopleSearch({ ...current, ...patch });
