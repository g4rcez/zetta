import type { Edge, Node } from "@xyflow/react";
import { ancestorsOf, canMove, childrenOf, descendantsOf } from "@zetta/core/org";

import type { OrgPosition } from "./org-api";
import { filtering, matchesFilters, type OrgFilterState } from "./org-search";

/** One seat of the chart on the canvas. `match` is `off` when no filter points seats out. */
export type SeatData = {
  item: OrgPosition;
  reports: number;
  collapsed: boolean;
  match: "yes" | "no" | "off";
  canEdit: boolean;
} & Record<string, unknown>;
export type SeatNode = Node<SeatData, "seat">;

export const SEAT_SIZE = { w: 232, h: 104 };
const GAP_X = 24;
const GAP_Y = 56;

type Tree = Pick<OrgPosition, "id" | "parentId" | "sortOrder" | "rank">;

/** The seats hidden because a seat above them is folded. */
export function hiddenSeats(positions: readonly Tree[], collapsed: ReadonlySet<string>) {
  const hidden = new Set<string>();
  for (const id of collapsed)
    if (positions.some((p) => p.id === id))
      for (const d of descendantsOf(positions, id)) hidden.add(d);
  return hidden;
}

/** Folded seats that hold a seat the filters point out are opened, so a search never hides what it found. */
export function foldedAfterSearch(
  positions: readonly Tree[],
  collapsed: ReadonlySet<string>,
  found: ReadonlySet<string>,
): Set<string> {
  const open = new Set<string>();
  for (const id of found) for (const a of ancestorsOf(positions, id)) open.add(a.id);
  return new Set([...collapsed].filter((id) => !open.has(id)));
}

/**
 * A top-down tree: every seat sits centered over its reports, every level has the same height. Folded seats count as leaves.
 * Returns the top-left corner of each seat that is shown.
 */
export function layoutTree(
  positions: readonly Tree[],
  collapsed: ReadonlySet<string>,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const root = positions.find((p) => p.parentId === null);
  if (!root) return out;
  const kids = (id: string) => (collapsed.has(id) ? [] : childrenOf(positions, id));
  const widths = new Map<string, number>();
  const widthOf = (id: string): number => {
    const own = kids(id);
    const w = own.length
      ? own.reduce((sum, k) => sum + widthOf(k.id), 0) + GAP_X * (own.length - 1)
      : SEAT_SIZE.w;
    const total = Math.max(SEAT_SIZE.w, w);
    widths.set(id, total);
    return total;
  };
  widthOf(root.id);
  const place = (id: string, left: number, depth: number) => {
    const w = widths.get(id)!;
    out.set(id, { x: left + (w - SEAT_SIZE.w) / 2, y: depth * (SEAT_SIZE.h + GAP_Y) });
    let at = left;
    for (const k of kids(id)) {
      place(k.id, at, depth + 1);
      at += widths.get(k.id)! + GAP_X;
    }
  };
  place(root.id, 0, 0);
  return out;
}

/** The nodes and the lines of the canvas: one line from each manager to each report. */
export function toFlow(
  positions: readonly OrgPosition[],
  opts: {
    collapsed: ReadonlySet<string>;
    filters: Pick<OrgFilterState, "q" | "show">;
    canEdit: boolean;
  },
): { nodes: SeatNode[]; edges: Edge[] } {
  const on = filtering(opts.filters);
  const found = new Set(positions.filter((p) => matchesFilters(p, opts.filters)).map((p) => p.id));
  const collapsed = on ? foldedAfterSearch(positions, opts.collapsed, found) : opts.collapsed;
  const hidden = hiddenSeats(positions, collapsed);
  const at = layoutTree(positions, collapsed);
  const shown = positions.filter((p) => !hidden.has(p.id) && at.has(p.id));
  const reports = new Map<string, number>();
  for (const p of positions)
    if (p.parentId) reports.set(p.parentId, (reports.get(p.parentId) ?? 0) + 1);
  return {
    nodes: shown.map((p): SeatNode => ({
      id: p.id,
      type: "seat",
      position: at.get(p.id)!,
      width: SEAT_SIZE.w,
      height: SEAT_SIZE.h,
      draggable: opts.canEdit && p.parentId !== null,
      data: {
        item: p,
        reports: reports.get(p.id) ?? 0,
        collapsed: collapsed.has(p.id),
        match: on ? (found.has(p.id) ? "yes" : "no") : "off",
        canEdit: opts.canEdit,
      },
    })),
    edges: shown
      .filter((p) => p.parentId && at.has(p.parentId))
      .map((p) => ({
        id: `${p.parentId}>${p.id}`,
        source: p.parentId!,
        target: p.id,
        type: "smoothstep",
      })),
  };
}

/** The seat whose box holds the point (later seats sit above earlier ones), other than `except`. */
export function seatAt(
  nodes: readonly Pick<SeatNode, "id" | "position">[],
  point: { x: number; y: number },
  except?: string,
): string | undefined {
  return [...nodes]
    .reverse()
    .find(
      (n) =>
        n.id !== except &&
        point.x >= n.position.x &&
        point.x <= n.position.x + SEAT_SIZE.w &&
        point.y >= n.position.y &&
        point.y <= n.position.y + SEAT_SIZE.h,
    )?.id;
}

export type DropMove =
  | { kind: "noop" }
  | { kind: "move"; parentId: string }
  | { kind: "refused"; message: string };

/** What dropping a seat on another one does: it starts to report to it. The same rules as the server, so a refusal never needs a round trip. */
export function dropMove(
  positions: readonly OrgPosition[],
  draggedId: string,
  targetId: string,
): DropMove {
  const dragged = positions.find((p) => p.id === draggedId);
  if (!dragged || draggedId === targetId || dragged.parentId === targetId) return { kind: "noop" };
  const problem = canMove(positions, draggedId, targetId);
  return problem
    ? { kind: "refused", message: problem.message }
    : { kind: "move", parentId: targetId };
}

/** The place a seat takes when it moves earlier (-1) or later (+1) among its siblings, or undefined at the end of the row. */
export function shiftSeat(
  positions: readonly OrgPosition[],
  id: string,
  delta: -1 | 1,
): { parentId: string; index: number } | undefined {
  const seat = positions.find((p) => p.id === id);
  if (!seat?.parentId) return undefined;
  const siblings = childrenOf(positions, seat.parentId);
  const i = siblings.findIndex((s) => s.id === id);
  const index = i + delta;
  return index < 0 || index >= siblings.length ? undefined : { parentId: seat.parentId, index };
}

/** From the CEO down to this seat, for the line above a seat's page. */
export function breadcrumb(positions: readonly OrgPosition[], id: string): OrgPosition[] {
  const self = positions.find((p) => p.id === id);
  return self ? [...ancestorsOf(positions, id).reverse(), self] : [];
}

/** Seats that can be the manager of this one: every seat that is not it or below it. */
export function managerChoices(positions: readonly OrgPosition[], id: string): OrgPosition[] {
  return positions.filter((p) => p.id !== id && !canMove(positions, id, p.id));
}

/** The words that say who holds a seat, or why nobody does. */
export function holderLine(p: Pick<OrgPosition, "holder" | "problem">): string {
  if (p.holder) return p.holder.name;
  return p.problem ? `Open seat (was ${p.problem.was})` : "Open seat";
}
