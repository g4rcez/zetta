import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { errorMessage } from "../chat/chat-client";
import { wikiQueries } from "./wiki-api";
import { itemOfHit, searchQuery, type WikiSearch } from "./wiki-filters";

/** The server's ranked, filtered results for the text in the address. Without a text there is nothing to ask. */
export function useWikiSearch(search: WikiSearch) {
  const query = search.q ? searchQuery(search) : "";
  const result = useQuery({ ...wikiQueries.search(query), enabled: Boolean(query) });
  const pages = result.data?.pages;
  const items = useMemo(() => pages?.map(itemOfHit), [pages]);
  return {
    items,
    meaning: result.data?.meaning,
    error: result.isError ? errorMessage(result.error) : undefined,
    active: Boolean(query),
    loading: Boolean(query) && result.isPending,
  };
}
