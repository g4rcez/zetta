import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { orgQueries, type OrgPosition } from "./org-api";

/** Who a seat reports to, in words: the manager's holder, or the manager's title when nobody holds that seat. */
export function reportsToText(positions: readonly OrgPosition[], seat: OrgPosition): string {
  const manager = positions.find((p) => p.id === seat.parentId);
  if (!manager) return "Top of the company";
  return `Reports to ${manager.holder?.name ?? `an open seat (${manager.title})`}`;
}

/** The link that shows a seat on the chart (the chart brings it into view). */
export function SeeOnChart({ seatId }: { seatId: string }) {
  return (
    <Link
      to="/organization"
      search={{ focus: seatId }}
      className="underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      See on the chart
    </Link>
  );
}

/**
 * "Reports to Ana · See on the chart" for a bot that holds a seat in the company chart. Nothing for a bot that holds none, and nothing
 * while the chart loads, so a panel that shows it never jumps.
 */
export function BotReportsTo({ botId }: { botId: string }) {
  const { data } = useQuery(orgQueries.get());
  const seat = data?.positions.find((p) => p.holder?.kind === "bot" && p.holder.botId === botId);
  if (!data || !seat) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {reportsToText(data.positions, seat)} · <SeeOnChart seatId={seat.id} />
    </p>
  );
}
