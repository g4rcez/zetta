import { createFileRoute } from "@tanstack/react-router";

import { DiscussionsPage } from "@/features/discussions/discussions-page";

type DiscussionsSearch = { id?: string };

export const Route = createFileRoute("/_auth/discussions")({
  validateSearch: (search: Record<string, unknown>): DiscussionsSearch => (typeof search.id === "string" && /^[0-9a-f-]{36}$/i.test(search.id) ? { id: search.id } : {}),
  component: RouteComponent,
});

function RouteComponent() {
  const { id } = Route.useSearch();
  return <DiscussionsPage selectedId={id} />;
}
