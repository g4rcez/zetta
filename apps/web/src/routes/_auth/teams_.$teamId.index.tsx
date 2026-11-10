import { createFileRoute } from "@tanstack/react-router";

import { TeamPage, TEAM_TABS, type TeamTab } from "@/features/teams/team-page";

type TeamSearch = { tab?: Exclude<TeamTab, "chat"> };

export const Route = createFileRoute("/_auth/teams_/$teamId/")({
  head: () => ({ meta: [{ title: "Team · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): TeamSearch =>
    TEAM_TABS.some((t) => t.id === search.tab && t.id !== "chat")
      ? { tab: search.tab as Exclude<TeamTab, "chat"> }
      : {},
  component: RouteComponent,
});

function RouteComponent() {
  const { teamId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TeamPage
      teamId={teamId}
      tab={tab ?? "chat"}
      onTab={(t) => void navigate({ search: t === "chat" ? {} : { tab: t } })}
    />
  );
}
