import { createFileRoute } from "@tanstack/react-router";

import { RoomsPage } from "@/features/discussions/discussions-page";

type RoomsSearch = { id?: string; view?: "canvas"; new?: true };

export const Route = createFileRoute("/_auth/rooms")({
  validateSearch: (search: Record<string, unknown>): RoomsSearch => ({
    ...(typeof search.id === "string" && /^[0-9a-f-]{36}$/i.test(search.id)
      ? { id: search.id }
      : {}),
    ...(search.view === "canvas" ? { view: "canvas" as const } : {}),
    ...(search.new === true || search.new === "true" ? { new: true as const } : {}),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { id, view, new: creating } = Route.useSearch();
  return <RoomsPage selectedId={id} view={view ?? "chat"} creating={Boolean(creating)} />;
}
