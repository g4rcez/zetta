import { createFileRoute } from "@tanstack/react-router";

import { PositionPage } from "@/features/org/position-page";

export const Route = createFileRoute("/_auth/organization_/$positionId")({
  head: () => ({ meta: [{ title: "Seat · zetta" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { positionId } = Route.useParams();
  return <PositionPage id={positionId} />;
}
