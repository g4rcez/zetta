/**
 * The company chart: seats that report to other seats, held by people or bots. Everything here is pure (no database, no web), so the
 * server checks every edit with the same functions the web app uses to refuse a drop before it is sent.
 */

/** How high a seat sits: the one `ceo` is the root of the chart; every other seat reports to another seat. */
export const ORG_RANKS = ["ceo", "executive", "lead", "member"] as const;
export type OrgRank = (typeof ORG_RANKS)[number];

/** What a person reads on a seat. "Lead" is a team leader: it runs a unit, and may run one of the teams. */
export const ORG_RANK_LABELS: Record<OrgRank, string> = {
  ceo: "CEO",
  executive: "Executive",
  lead: "Team leader",
  member: "Member",
};

/** Who holds a seat: nobody yet, a person of the installation, or a team-visible bot. */
export const ORG_SEATS = ["open", "person", "bot"] as const;
export type OrgSeat = (typeof ORG_SEATS)[number];

export const ORG_TITLE_MAX = 80;
export const ORG_UNIT_MAX = 80;
export const ORG_DESCRIPTION_MAX = 600;
/** The deepest chain of managers the chart accepts, the CEO counting as level 1. */
export const ORG_MAX_DEPTH = 12;

export type OrgTreeNode = { id: string; parentId: string | null; rank: OrgRank };
export type OrgOrdered = OrgTreeNode & { sortOrder: number };

export type OrgTreeProblemCode =
  | "no_root"
  | "many_roots"
  | "root_not_ceo"
  | "extra_ceo"
  | "missing_parent"
  | "cycle"
  | "too_deep"
  | "self"
  | "under_own_report"
  | "root_move"
  | "not_found";
export type OrgTreeProblem = { code: OrgTreeProblemCode; message: string };

const problem = (code: OrgTreeProblemCode, message: string): OrgTreeProblem => ({ code, message });

/** Direct reports of a seat in the order the chart shows them: by `sortOrder`, then by id so the order never flickers. */
export function childrenOf<T extends OrgOrdered>(nodes: readonly T[], id: string | null): T[] {
  return nodes
    .filter((n) => n.parentId === id)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const byParent = (nodes: readonly OrgTreeNode[]) => {
  const map = new Map<string | null, string[]>();
  for (const n of nodes) map.set(n.parentId, [...(map.get(n.parentId) ?? []), n.id]);
  return map;
};

/** Every seat below this one, however deep. */
export function descendantsOf(nodes: readonly OrgTreeNode[], id: string): string[] {
  const kids = byParent(nodes);
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const stack = [...(kids.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    stack.push(...(kids.get(next) ?? []));
  }
  return out;
}

/** The chain of managers above a seat, nearest first, ending at the CEO. A broken chain stops where it breaks. */
export function ancestorsOf<T extends OrgTreeNode>(nodes: readonly T[], id: string): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: T[] = [];
  const seen = new Set<string>([id]);
  let at = byId.get(id)?.parentId ?? null;
  while (at && !seen.has(at)) {
    const node = byId.get(at);
    if (!node) break;
    out.push(node);
    seen.add(at);
    at = node.parentId;
  }
  return out;
}

/** Levels from the CEO down to this seat, the CEO counting as 1. */
export const depthOf = (nodes: readonly OrgTreeNode[], id: string) =>
  ancestorsOf(nodes, id).length + 1;

/** Levels in the subtree that starts at this seat, the seat itself counting as 1. */
export function heightOf(nodes: readonly OrgTreeNode[], id: string): number {
  const kids = byParent(nodes);
  const walk = (at: string, seen: Set<string>): number => {
    if (seen.has(at)) return 0;
    const next = new Set(seen).add(at);
    return 1 + Math.max(0, ...(kids.get(at) ?? []).map((k) => walk(k, next)));
  };
  return walk(id, new Set());
}

/**
 * Whether the whole chart is sound: no seats at all, or exactly one root that is the CEO, every other seat under a seat that exists, no
 * loop, and no chain longer than `ORG_MAX_DEPTH`. Returns the first problem in plain words, or null.
 */
export function validateTree(nodes: readonly OrgTreeNode[]): OrgTreeProblem | null {
  if (nodes.length === 0) return null;
  const ids = new Set(nodes.map((n) => n.id));
  const roots = nodes.filter((n) => n.parentId === null);
  if (roots.length === 0) return problem("no_root", "The chart has no CEO at the top.");
  if (roots.length > 1)
    return problem("many_roots", "Only one seat can be at the top of the chart.");
  if (roots[0]!.rank !== "ceo")
    return problem("root_not_ceo", "The seat at the top must be the CEO.");
  if (nodes.some((n) => n.parentId !== null && n.rank === "ceo"))
    return problem("extra_ceo", "There can be only one CEO.");
  if (nodes.some((n) => n.parentId !== null && !ids.has(n.parentId)))
    return problem("missing_parent", "A seat reports to a seat that is not in the chart.");
  for (const n of nodes) {
    const chain = ancestorsOf(nodes, n.id);
    // The walk up must end at the root. A loop stops early, at a seat that still has a manager.
    if ((chain.at(-1) ?? n).parentId !== null)
      return problem("cycle", "A seat cannot report to its own reports.");
    if (chain.length + 1 > ORG_MAX_DEPTH)
      return problem("too_deep", `The chart can have at most ${ORG_MAX_DEPTH} levels.`);
  }
  return null;
}

/** Whether a seat may be moved under another one. The web app asks this before it sends the move; the server asks it again. */
export function canMove(
  nodes: readonly OrgTreeNode[],
  id: string,
  newParentId: string,
): OrgTreeProblem | null {
  const node = nodes.find((n) => n.id === id);
  const parent = nodes.find((n) => n.id === newParentId);
  if (!node || !parent) return problem("not_found", "That seat is not in the chart any more.");
  if (node.parentId === null)
    return problem("root_move", "The CEO is the top of the chart and does not report to anyone.");
  if (id === newParentId) return problem("self", "A seat cannot report to itself.");
  if (descendantsOf(nodes, id).includes(newParentId))
    return problem("under_own_report", "A seat cannot report to one of its own reports.");
  if (depthOf(nodes, newParentId) + heightOf(nodes, id) > ORG_MAX_DEPTH)
    return problem("too_deep", `The chart can have at most ${ORG_MAX_DEPTH} levels.`);
  return null;
}

/** The nearest manager above a seat who is actually there: seats nobody holds are skipped. */
export function nearestManager<T extends OrgTreeNode & { seat: OrgSeat }>(
  nodes: readonly T[],
  id: string,
): T | undefined {
  return ancestorsOf(nodes, id).find((n) => n.seat !== "open");
}

/** The seats a person or a bot holds. */
export function positionsOf<
  T extends { seat: OrgSeat; userId?: string | null; botId?: string | null },
>(nodes: readonly T[], holder: { kind: "person" | "bot"; id: string }): T[] {
  return nodes.filter((n) =>
    holder.kind === "person"
      ? n.seat === "person" && n.userId === holder.id
      : n.seat === "bot" && n.botId === holder.id,
  );
}
