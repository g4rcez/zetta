import { Outlet, createFileRoute, useChildMatches } from "@tanstack/react-router";

import { WikiExplorer } from "@/features/wiki/explorer";
import { parseWikiSearch, type WikiSearch } from "@/features/wiki/wiki-filters";

export const Route = createFileRoute("/_auth/memory")({
  head: () => ({ meta: [{ title: "Memory · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): WikiSearch => parseWikiSearch(search),
  component: RouteComponent,
});

/** This route is the parent of /memory/$slug: the explorer shows only when no item page is open. */
function RouteComponent() {
  const search = Route.useSearch();
  const child = useChildMatches();
  return child.length ? <Outlet /> : <WikiExplorer search={search} />;
}
