import { useCallback, useEffect, useMemo, useState } from "react";

import { call, errorMessage } from "../chat/chat-client";
import type { WikiLinkInfo } from "../chat/response";
import { mergeRows } from "./wiki-filters";
import type { Row, SharedRow } from "./wiki-api";

/** Every item the person can see (own and shared), loaded once per page. */
export function useWikiIndex() {
  const [data, setData] = useState<{ pages: Row[]; shared: SharedRow[] }>();
  const [error, setError] = useState<string>();
  const reload = useCallback(
    () =>
      call<{ pages: Row[]; shared: SharedRow[] }>("/api/wiki").then(
        (r) => {
          setData(r);
          setError(undefined);
        },
        (e) => setError(errorMessage(e)),
      ),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  const items = useMemo(() => (data ? mergeRows(data.pages, data.shared) : undefined), [data]);
  /** Resolves `[[slug]]` in a text. Undefined until the index is loaded, so no link shows as missing by mistake. */
  const wikiLinks = useMemo<WikiLinkInfo | undefined>(() => {
    if (!items) return undefined;
    const titles = new Map(items.map((i) => [i.slug, i.title]));
    return (slug) => (titles.has(slug) ? { title: titles.get(slug)! } : undefined);
  }, [items]);
  return { items, wikiLinks, error, reload };
}
