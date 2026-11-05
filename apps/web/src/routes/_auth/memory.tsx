import { Outlet, createFileRoute, useChildMatches } from "@tanstack/react-router";

import { MemoryExplorer } from "@/features/memory/explorer";
import { parseMemorySearch, type MemorySearch } from "@/features/memory/memory-filters";

export const Route = createFileRoute("/_auth/memory")({
  head: () => ({ meta: [{ title: "Memory · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): MemorySearch => parseMemorySearch(search),
  component: RouteComponent,
});

/** This route is the parent of /memory/$slug: the explorer shows only when no item page is open. */
function RouteComponent() {
  const search = Route.useSearch();
  const child = useChildMatches();
  return child.length ? <Outlet /> : <MemoryExplorer search={search} />;
}
