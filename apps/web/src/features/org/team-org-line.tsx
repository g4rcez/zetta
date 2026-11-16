import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { orgQueries } from "./org-api";

/** On a team's page: who the company chart says leads the team. Shows nothing when no seat that is held runs it. */
export function TeamOrgLine({ teamId }: { teamId: string }) {
  const positions = useQuery(orgQueries.get()).data?.positions;
  const seat = positions?.find((p) => p.team?.id === teamId && p.holder);
  if (!seat?.holder) return null;
  return (
    <p className="text-sm text-muted-foreground">
      In the company chart, this team is led by{" "}
      <Link
        to="/organization/$positionId"
        params={{ positionId: seat.id }}
        className="font-medium text-foreground underline underline-offset-2"
      >
        {seat.holder.name}, {seat.title}
      </Link>
      .
    </p>
  );
}
