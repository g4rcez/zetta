import { createFileRoute } from "@tanstack/react-router";

import { RoutinesPage } from "@/features/routines/routines-page";
import { parseRoutinesSearch, type RoutinesSearch } from "@/features/routines/routines-search";

export const Route = createFileRoute("/_auth/routines")({
  validateSearch: (search: Record<string, unknown>): RoutinesSearch => parseRoutinesSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <RoutinesPage
      search={search}
      setSearch={(next, replace) =>
        void navigate({ search: (prev) => ({ ...prev, ...next }), replace: replace === "replace" })
      }
    />
  );
}
