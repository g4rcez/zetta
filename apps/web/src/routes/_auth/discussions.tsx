import { createFileRoute } from "@tanstack/react-router";

import { DiscussionsPage } from "@/features/discussions/discussions-page";

type DiscussionsSearch = { id?: string; view?: "canvas" };

export const Route = createFileRoute("/_auth/discussions")({
  validateSearch: (search: Record<string, unknown>): DiscussionsSearch => ({
    ...(typeof search.id === "string" && /^[0-9a-f-]{36}$/i.test(search.id)
      ? { id: search.id }
      : {}),
    ...(search.view === "canvas" ? { view: "canvas" as const } : {}),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { id, view } = Route.useSearch();
  return <DiscussionsPage selectedId={id} view={view ?? "chat"} />;
}
