import { createFileRoute } from "@tanstack/react-router";

import { SearchPage } from "@/features/search/search-page";

type SearchParams = { q?: string };

export const Route = createFileRoute("/_auth/search")({
  validateSearch: (search: Record<string, unknown>): SearchParams =>
    typeof search.q === "string" && search.q.trim() ? { q: search.q.trim().slice(0, 200) } : {},
  component: RouteComponent,
});

function RouteComponent() {
  const { q } = Route.useSearch();
  return <SearchPage initial={q ?? ""} />;
}
