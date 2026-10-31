import { Link } from "@tanstack/react-router";
import { CrownIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { errorMessage } from "../chat/chat-client";
import { teamsApi, type Team } from "./teams-api";

/** The teams this bot belongs to, with a crown on the ones it leads. Set the lead on the Teams canvas. */
export function BotTeamsSection({ botId }: { botId: string }) {
  const [teams, setTeams] = useState<Team[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    teamsApi.list().then(
      (all) => setTeams(all.filter((t) => t.members.some((m) => m.botId === botId))),
      (e) => setError(errorMessage(e)),
    );
  }, [botId]);
  if (error)
    return (
      <p role="alert" className="text-xs text-destructive">
        {error}
      </p>
    );
  if (!teams) return <p className="text-xs text-muted-foreground">Loading teams…</p>;
  return (
    <section aria-label="Teams" className="space-y-2 text-sm">
      {teams.length === 0 ? (
        <p className="text-xs text-muted-foreground">Not in any team.</p>
      ) : (
        <ul className="space-y-1.5">
          {teams.map((t) => {
            const me = t.members.find((m) => m.botId === botId)!;
            return (
              <li key={t.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                {me.kind === "chief" ? (
                  <span className="flex items-center gap-1 text-xs text-warn">
                    <CrownIcon className="size-3" aria-hidden="true" />
                    Team lead
                  </span>
                ) : (
                  <span className="truncate text-xs text-muted-foreground">
                    {me.role || "Member"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/teams" className="text-xs underline underline-offset-2">
        Open the Teams canvas
      </Link>
    </section>
  );
}
