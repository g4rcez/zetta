import { createFileRoute } from "@tanstack/react-router";

import { TeamSettingsPage } from "@/features/teams/team-settings";

// `teams_` keeps this page out of the Teams canvas route, which has no <Outlet />.
export const Route = createFileRoute("/_auth/teams_/$teamId/settings")({
  head: () => ({ meta: [{ title: "Team settings · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): { room?: string } =>
    typeof search.room === "string" && /^[0-9a-f-]{36}$/i.test(search.room)
      ? { room: search.room }
      : {},
  component: RouteComponent,
});

function RouteComponent() {
  const { teamId } = Route.useParams();
  const { room } = Route.useSearch();
  return <TeamSettingsPage teamId={teamId} roomId={room} />;
}
