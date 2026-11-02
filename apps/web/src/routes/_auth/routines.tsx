import { createFileRoute } from "@tanstack/react-router";

import { RoutinesPage } from "@/features/routines/routines-page";

type RoutinesSearch = { routine?: string };

export const Route = createFileRoute("/_auth/routines")({
  validateSearch: (search: Record<string, unknown>): RoutinesSearch =>
    typeof search.routine === "string" && /^[0-9a-f-]{36}$/i.test(search.routine)
      ? { routine: search.routine }
      : {},
  component: RouteComponent,
});

function RouteComponent() {
  const { routine } = Route.useSearch();
  return <RoutinesPage focusId={routine} />;
}
