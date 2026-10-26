import { createFileRoute } from "@tanstack/react-router";

import { AgendaPage } from "@/features/agenda/agenda-page";

type AgendaSearch = { item?: string };

export const Route = createFileRoute("/_auth/agenda")({
  validateSearch: (search: Record<string, unknown>): AgendaSearch => (typeof search.item === "string" && /^[0-9a-f-]{36}$/i.test(search.item) ? { item: search.item } : {}),
  component: RouteComponent,
});

function RouteComponent() {
  const { item } = Route.useSearch();
  return <AgendaPage focusId={item} />;
}
