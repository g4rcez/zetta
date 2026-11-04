import { createFileRoute } from "@tanstack/react-router";

import { AgendaPage } from "@/features/agenda/agenda-page";
import { isUuid } from "@/features/shared/search-params";

type AgendaSearch = { item?: string };

export const Route = createFileRoute("/_auth/agenda")({
  validateSearch: (search: Record<string, unknown>): AgendaSearch =>
    isUuid(search.item) ? { item: search.item } : {},
  component: RouteComponent,
});

function RouteComponent() {
  const { item } = Route.useSearch();
  return <AgendaPage focusId={item} />;
}
