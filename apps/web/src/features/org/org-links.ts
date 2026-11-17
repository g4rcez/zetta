import type { Edge } from "@xyflow/react";

import type { OrgLink, OrgLinkKind, OrgPosition } from "./org-api";
import { SEAT_SIZE, type SeatNode } from "./org-graph";

/** What a dotted line carries: the pair, and the words that say why they are joined. */
export type WorksData = { link: OrgLink; names: [string, string]; sentence: string } & Record<
  string,
  unknown
>;
export type WorksEdge = Edge<WorksData, "works">;

const NOUN: Record<OrgLinkKind, [string, string]> = {
  room: ["room", "rooms"],
  workflow: ["workflow", "workflows"],
  handoff: ["decision handoff", "decision handoffs"],
};

/** "3 rooms, 1 workflow": what two bots share, in the order rooms, workflows, handoffs. */
export function shared(counts: OrgLink["counts"]): string {
  return (Object.keys(NOUN) as OrgLinkKind[])
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${NOUN[k][counts[k] === 1 ? 0 : 1]}`)
    .join(", ");
}

/** "Work together in 3 rooms, 1 workflow". */
export const linkSentence = (link: Pick<OrgLink, "counts">) =>
  `Work together in ${shared(link.counts)}`;

/** The name of the bot that holds a seat, by bot id. A bot in two seats is named by the first one. */
export function botNames(positions: readonly OrgPosition[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of positions)
    if (p.holder?.kind === "bot" && !out.has(p.holder.botId))
      out.set(p.holder.botId, p.holder.name);
  return out;
}

/** The pairs whose two bots hold a seat in the chart, with the words to show for each. Pairs the chart cannot name are left out. */
export function namedLinks(links: readonly OrgLink[], positions: readonly OrgPosition[]) {
  const names = botNames(positions);
  return links.flatMap((link) => {
    const a = names.get(link.aId);
    const b = names.get(link.bId);
    return a && b
      ? [{ link, names: [a, b] as [string, string], sentence: linkSentence(link) }]
      : [];
  });
}

/**
 * The dotted lines of the "works with" layer, one per pair of bots whose seats are both on the canvas (a seat inside a folded branch
 * has no place, so its lines wait until the branch opens). Seats keep the places `toFlow` gave them. A line leaves the side of a seat that
 * faces the other; two seats in one column join on their right sides so the line never runs along the reporting lines.
 */
export function linkEdges(links: readonly OrgLink[], nodes: readonly SeatNode[]): WorksEdge[] {
  const seatOf = new Map<string, SeatNode>();
  for (const n of nodes) {
    const h = n.data.item.holder;
    if (h?.kind === "bot" && !seatOf.has(h.botId)) seatOf.set(h.botId, n);
  }
  const out: WorksEdge[] = [];
  for (const link of links) {
    const a = seatOf.get(link.aId);
    const b = seatOf.get(link.bId);
    if (!a || !b || a.id === b.id) continue;
    const names: [string, string] = [a.data.item.holder!.name, b.data.item.holder!.name];
    const sentence = linkSentence(link);
    const sameColumn = Math.abs(a.position.x - b.position.x) < SEAT_SIZE.w / 2;
    const [from, to] = sameColumn
      ? a.position.y <= b.position.y
        ? [a, b]
        : [b, a]
      : a.position.x <= b.position.x
        ? [a, b]
        : [b, a];
    out.push({
      id: `works:${link.aId}|${link.bId}`,
      source: from.id,
      target: to.id,
      sourceHandle: "r-out",
      targetHandle: sameColumn ? "r-in" : "l-in",
      type: "works",
      zIndex: 0,
      focusable: true,
      ariaLabel: `${names[0]} and ${names[1]}: ${sentence}`,
      data: { link, names, sentence },
    });
  }
  return out;
}
