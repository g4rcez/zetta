import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { errorMessage } from "../chat/chat-client";
import type { WikiLinkInfo } from "../chat/response";
import { mergeRows } from "./wiki-filters";
import { wikiQueries } from "./wiki-api";

/** Every item the person can see (own and shared). Every caller shares one request. */
export function useWikiIndex() {
  const query = useQuery(wikiQueries.index());
  const data = query.data;
  const error = query.isError ? errorMessage(query.error) : undefined;
  const items = useMemo(() => (data ? mergeRows(data.pages, data.shared) : undefined), [data]);
  /** Resolves `[[slug]]` in a text. Undefined until the index is loaded, so no link shows as missing by mistake. */
  const wikiLinks = useMemo<WikiLinkInfo | undefined>(() => {
    if (!items) return undefined;
    const titles = new Map(items.map((i) => [i.slug, i.title]));
    return (slug) => (titles.has(slug) ? { title: titles.get(slug)! } : undefined);
  }, [items]);
  return { items, wikiLinks, error, reload: () => query.refetch() };
}
