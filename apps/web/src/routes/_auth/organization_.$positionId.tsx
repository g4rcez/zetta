import { createFileRoute, redirect } from "@tanstack/react-router";

/** The seat has no page of its own any more: its panel opens beside the chart. Old links to a seat land there. */
export const Route = createFileRoute("/_auth/organization_/$positionId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/organization", search: { focus: params.positionId }, replace: true });
  },
});
