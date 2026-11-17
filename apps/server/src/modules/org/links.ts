import type { Database } from "@zetta/db";
import { and, eq, gt, inArray, or } from "@zetta/db/query";
import { discussion, discussionMember } from "@zetta/db/schema/discussions";
import { decisionConfig, workflow } from "@zetta/db/schema/features";

/**
 * The "works with" layer of the chart: which bots that hold a seat really work together. Computed from rows that exist already (rooms
 * the reader owns, the reader's workflows and decision routes); nothing is stored. A pair counts once per room, per workflow and per route.
 */
export const ORG_LINK_KINDS = ["room", "workflow", "handoff"] as const;
export type OrgLinkKind = (typeof ORG_LINK_KINDS)[number];

export type OrgLink = {
  /** Bot ids, `aId` sorting before `bId`, so a pair has one shape. */
  aId: string;
  bId: string;
  /** How many shared rooms, workflows and routes together. */
  weight: number;
  kinds: OrgLinkKind[];
  counts: Record<OrgLinkKind, number>;
};

/** The most pairs one read returns, the strongest first: the canvas stays readable. */
export const ORG_LINKS_MAX = 150;
/** A closed room still counts for this long after its last change. */
const RECENT_DAYS = 90;
/** A room with more bots than this is a crowd, not a pair of colleagues: it would draw n² lines. */
const ROOM_MAX_BOTS = 12;

type Counts = Map<string, Record<OrgLinkKind, number>>;
const keyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function bump(counts: Counts, a: string, b: string, kind: OrgLinkKind) {
  if (a === b) return;
  const key = keyOf(a, b);
  const row = counts.get(key) ?? { room: 0, workflow: 0, handoff: 0 };
  row[kind] += 1;
  counts.set(key, row);
}

/** The ids a workflow step points to, whatever kind of step it is. */
function nextOf(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const n = node as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ["next", "then", "else", "body"]) if (typeof n[k] === "string") out.push(n[k]);
  if (n.choices && typeof n.choices === "object")
    for (const v of Object.values(n.choices)) if (typeof v === "string") out.push(v);
  return out;
}
const botOfStep = (node: unknown): string | null => {
  const n = node as { type?: unknown; botId?: unknown } | undefined;
  return (n?.type === "prompt" || n?.type === "tool") && typeof n.botId === "string"
    ? n.botId
    : null;
};

/**
 * The pairs of bots that follow each other in one workflow graph: from a step of a bot, walk on through the steps that belong to no
 * bot (a condition, a wait, an approval) until the next step of a bot.
 */
export function workflowPairs(graph: unknown): [string, string][] {
  const nodes = (graph as { nodes?: Record<string, unknown> } | null)?.nodes;
  if (!nodes || typeof nodes !== "object") return [];
  const pairs = new Map<string, [string, string]>();
  for (const [id, node] of Object.entries(nodes)) {
    const from = botOfStep(node);
    if (!from) continue;
    const seen = new Set<string>([id]);
    const stack = nextOf(node);
    while (stack.length) {
      const at = stack.pop()!;
      if (seen.has(at)) continue;
      seen.add(at);
      const step = nodes[at];
      const to = botOfStep(step);
      if (to) {
        if (to !== from) pairs.set(keyOf(from, to), [from, to]);
        continue;
      }
      stack.push(...nextOf(step));
    }
  }
  return [...pairs.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([, p]) => p);
}

/** The works-with pairs for one reader, among the bots that hold a seat in the chart (`seated`, the caller reads the chart). */
export async function readOrgLinks(
  db: Pick<Database, "select">,
  readerUserId: string,
  seated: readonly string[],
) {
  if (new Set(seated).size < 2) return [] as OrgLink[];
  const isSeated = new Set(seated);
  const counts: Counts = new Map();

  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
  const roomRows = await db
    .select({ roomId: discussionMember.discussionId, botId: discussionMember.botId })
    .from(discussionMember)
    .innerJoin(discussion, eq(discussion.id, discussionMember.discussionId))
    .where(
      and(
        eq(discussion.ownerUserId, readerUserId),
        inArray(discussion.kind, ["room", "bots"]),
        or(
          inArray(discussion.status, ["open", "paused", "stalled"]),
          gt(discussion.updatedAt, since),
        ),
      ),
    );
  const rooms = new Map<string, Set<string>>();
  for (const r of roomRows) rooms.set(r.roomId, (rooms.get(r.roomId) ?? new Set()).add(r.botId));
  for (const members of rooms.values()) {
    if (members.size > ROOM_MAX_BOTS) continue;
    const here = [...members].filter((b) => isSeated.has(b));
    for (const [i, a] of here.entries())
      for (const b of here.slice(i + 1)) bump(counts, a, b, "room");
  }

  const flows = await db
    .select({ graph: workflow.graph })
    .from(workflow)
    .where(eq(workflow.ownerUserId, readerUserId));
  for (const f of flows)
    for (const [a, b] of workflowPairs(f.graph))
      if (isSeated.has(a) && isSeated.has(b)) bump(counts, a, b, "workflow");

  const routes = await db
    .select({ botId: decisionConfig.botId, options: decisionConfig.options })
    .from(decisionConfig)
    .where(and(eq(decisionConfig.ownerUserId, readerUserId), eq(decisionConfig.enabled, true)));
  for (const r of routes) {
    // One route that hands over twice to the same bot is still one handoff.
    const targets = new Set(
      r.options.flatMap((o) => (o.action === "delegate" && o.targetBotId ? [o.targetBotId] : [])),
    );
    for (const t of targets)
      if (isSeated.has(r.botId) && isSeated.has(t)) bump(counts, r.botId, t, "handoff");
  }

  return [...counts.entries()]
    .map(([key, c]): OrgLink => {
      const [aId, bId] = key.split("|") as [string, string];
      return {
        aId,
        bId,
        weight: c.room + c.workflow + c.handoff,
        kinds: ORG_LINK_KINDS.filter((k) => c[k] > 0),
        counts: c,
      };
    })
    .sort((x, y) => y.weight - x.weight || (x.aId + x.bId < y.aId + y.bId ? -1 : 1))
    .slice(0, ORG_LINKS_MAX);
}
