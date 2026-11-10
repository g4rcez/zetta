import { createFileRoute } from "@tanstack/react-router";

import { RoutinePage } from "@/features/routines/routine-page";

export const Route = createFileRoute("/_auth/routines_/$routineId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { routineId } = Route.useParams();
  return <RoutinePage routineId={routineId} />;
}
