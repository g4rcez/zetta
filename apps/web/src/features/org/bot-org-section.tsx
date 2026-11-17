import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { errorMessage } from "../chat/chat-client";
import { RankMark } from "./org-bits";
import { orgQueries } from "./org-api";
import { reportsToText, SeeOnChart } from "./reports-to";

/** The seats this bot holds in the company chart, and who each reports to. A bot is put in a seat on the Organization page. */
export function BotOrgSection({ botId }: { botId: string }) {
  const query = useQuery(orgQueries.get());
  if (query.error)
    return (
      <p role="alert" className="text-xs text-destructive">
        {errorMessage(query.error)}
      </p>
    );
  const positions = query.data?.positions;
  if (!positions) return <p className="text-xs text-muted-foreground">Loading the chart…</p>;
  const seats = positions.filter((p) => p.holder?.kind === "bot" && p.holder.botId === botId);
  return (
    <section aria-label="Organization" className="space-y-2 text-sm">
      {seats.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This bot holds no seat in the company chart.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {seats.map((s) => {
            const manager = positions.find((p) => p.id === s.parentId);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-2">
                <Link
                  to="/organization/$positionId"
                  params={{ positionId: s.id }}
                  className="flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                >
                  {s.title}
                  <RankMark rank={s.rank} />
                </Link>
                <span className="text-xs text-muted-foreground">
                  {reportsToText(positions, s)}
                  {manager?.holder ? ` (${manager.title})` : ""} · <SeeOnChart seatId={s.id} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/organization" className="text-xs underline underline-offset-2">
        Open the organization
      </Link>
    </section>
  );
}
