import { useEffect, useState } from "react";

import { call, errorMessage } from "../chat/chat-client";
import type { Hit, Item } from "./wiki-api";
import { itemOfHit, searchQuery, type WikiSearch } from "./wiki-filters";

/** The server's ranked, filtered results for the text in the address. Without a text there is nothing to ask. */
export function useWikiSearch(search: WikiSearch) {
  const query = search.q ? searchQuery(search) : "";
  const [state, setState] = useState<{
    items?: Item[];
    meaning?: boolean;
    error?: string;
    for?: string;
  }>({});
  useEffect(() => {
    if (!query) return;
    let live = true; // an older answer never replaces a newer one
    call<{ pages: Hit[]; meaning: boolean }>(`/api/wiki?${query}`).then(
      (r) => live && setState({ items: r.pages.map(itemOfHit), meaning: r.meaning, for: query }),
      (e) => live && setState({ error: errorMessage(e), for: query }),
    );
    return () => {
      live = false;
    };
  }, [query]);
  return { ...state, active: Boolean(query), loading: Boolean(query) && state.for !== query };
}
