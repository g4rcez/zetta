import { createFileRoute } from "@tanstack/react-router";

import { RoutinePage } from "@/features/routines/routine-page";
import { parseRoutineSearch, type RoutineSearch } from "@/features/routines/routines-search";

export const Route = createFileRoute("/_auth/routines_/$routineId")({
  validateSearch: (search: Record<string, unknown>): RoutineSearch => parseRoutineSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const { routineId } = Route.useParams();
  const { edit } = Route.useSearch();
  return <RoutinePage routineId={routineId} edit={edit} />;
}
