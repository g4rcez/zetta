import { createFileRoute } from "@tanstack/react-router";

import { TeamRolesPage } from "@/features/teams/team-roles";

// `team-roles` is its own page: the `/teams` canvas route has no <Outlet />.
export const Route = createFileRoute("/_auth/team-roles")({
  head: () => ({ meta: [{ title: "Team roles · zetta" }] }),
  component: TeamRolesPage,
});
