import type { Item, Relation, Status, WikiType } from "./wiki-api";
import { matches, type WikiFilter } from "./wiki-filters";

/** One item of GET /api/wiki-graph. */
export type GraphNodeData = {
  id: string;
  slug: string;
  title: string;
  type: WikiType;
  tags: string[];
  score: number;
  status: Status;
  access: "own" | "shared";
  inDegree: number;
  outDegree: number;
  updatedAt: string;
};
export type GraphData = {
  nodes: GraphNodeData[];
  edges: { from: string; to: string; relation: Relation }[];
  /** Links of the person's own items to a slug no readable item has. */
  dangling: { from: string; to: string; relation: Relation }[];
  truncated: boolean;
};

/** A node as the drawing library gets it. */
export type GNode = {
  id: string;
  slug: string;
  title: string;
  /** Radius, from importance and number of links. */
  size: number;
  group: string;
  /** Does not match the filters: drawn faint, not removed, so the shape of the graph stays. */
  dim: boolean;
  /** A search result. */
  hit: boolean;
  /** Linked to nothing. */
  orphan: boolean;
  /** A link target that has no item yet. */
  missing: boolean;
};
export type GLink = {
  source: string;
  target: string;
  relation: Relation;
  dim: boolean;
  missing: boolean;
};
export type Graph = {
  nodes: GNode[];
  links: GLink[];
  /** The groups the colors mean, in order. */
  legend: { group: string; label: string }[];
  orphans: number;
};
export type ColorBy = "type" | "tag";

export const TYPE_LABEL: Record<WikiType, string> = {
  solo: "One bot",
  owner: "All my bots",
  teams: "Teams",
  all: "Shared",
};
const TOP_TAGS = 3;
export const OTHER = "other";
export const MISSING = "missing";

/** Importance and links make a node bigger, so what matters shows first. */
export const nodeSize = (score: number, degree: number) => 3 + score / 25 + Math.sqrt(degree);

/** How each relation is drawn: an arrow where direction matters, a dash pattern that tells the typed ones apart. */
export const RELATION_STYLE: Record<Relation, { arrow: boolean; dash: number[] | undefined }> = {
  related: { arrow: false, dash: undefined },
  "depends-on": { arrow: true, dash: undefined },
  "part-of": { arrow: true, dash: [4, 2] },
  supersedes: { arrow: true, dash: [1, 2] },
};

/** A node as the list filters know an item. The graph has no author, bot, team or text, so those facets are left out: a text is matched by the server's `hits`. */
const asItem = (n: GraphNodeData): Item => ({
  id: n.id,
  slug: n.slug,
  title: n.title,
  type: n.type,
  howto: "",
  tags: n.tags,
  score: n.score,
  status: n.status,
  access: n.access,
  by: null,
  ownerName: null,
  botId: null,
  teams: [],
  createdAt: n.updatedAt,
  updatedAt: n.updatedAt,
});
const graphFilter = (f: WikiFilter): WikiFilter => {
  const { by: _by, bot: _bot, team: _team, ...rest } = f;
  return { ...rest, q: "" };
};

export function buildGraph(
  data: GraphData,
  o: {
    filter: WikiFilter;
    colorBy: ColorBy;
    /** Ids of the search results: they are marked, and every other node is dimmed. */
    hits?: ReadonlySet<string> | undefined;
    showMissing: boolean;
    now?: number;
  },
): Graph {
  const filter = graphFilter(o.filter);
  const top = new Map<string, number>();
  if (o.colorBy === "tag")
    for (const n of data.nodes) for (const t of n.tags) top.set(t, (top.get(t) ?? 0) + 1);
  const topTags = [...top]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_TAGS)
    .map(([t]) => t);
  const groupOf = (n: GraphNodeData) =>
    o.colorBy === "type" ? n.type : (n.tags.find((t) => topTags.includes(t)) ?? OTHER);
  const dimOf = new Map(
    data.nodes.map((n) => [
      n.id,
      !matches(asItem(n), filter, o.now) || (o.hits ? !o.hits.has(n.id) : false),
    ]),
  );
  const nodes: GNode[] = data.nodes.map((n) => ({
    id: n.id,
    slug: n.slug,
    title: n.title,
    size: nodeSize(n.score, n.inDegree + n.outDegree),
    group: groupOf(n),
    dim: dimOf.get(n.id) ?? false,
    hit: o.hits?.has(n.id) ?? false,
    orphan: n.inDegree + n.outDegree === 0,
    missing: false,
  }));
  const links: GLink[] = data.edges.map((e) => ({
    source: e.from,
    target: e.to,
    relation: e.relation,
    dim: Boolean(dimOf.get(e.from) || dimOf.get(e.to)),
    missing: false,
  }));
  if (o.showMissing) {
    const seen = new Set<string>();
    for (const d of data.dangling) {
      const id = `${MISSING}:${d.to}`;
      if (!seen.has(id)) {
        seen.add(id);
        nodes.push({
          id,
          slug: d.to,
          title: d.to,
          size: nodeSize(0, 1),
          group: MISSING,
          dim: false,
          hit: false,
          orphan: false,
          missing: true,
        });
      }
      links.push({
        source: d.from,
        target: id,
        relation: d.relation,
        dim: Boolean(dimOf.get(d.from)),
        missing: true,
      });
    }
  }
  const groups = [...new Set(nodes.map((n) => n.group))];
  const order = (g: string) => (g === MISSING ? 2 : g === OTHER ? 1 : 0);
  const legend = groups
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((g) => ({
      group: g,
      label:
        g === MISSING
          ? "Missing item"
          : g === OTHER
            ? "Other"
            : o.colorBy === "type"
              ? TYPE_LABEL[g as WikiType]
              : g,
    }));
  return { nodes, links, legend, orphans: nodes.filter((n) => n.orphan).length };
}

/** The ids within `depth` links of `id`, following links in both directions. */
export function neighborhood(
  links: readonly { source: string; target: string }[],
  id: string,
  depth = 1,
) {
  const seen = new Set([id]);
  let frontier = [id];
  for (let step = 0; step < depth && frontier.length; step++) {
    const next: string[] = [];
    for (const l of links) {
      for (const [from, to] of [
        [l.source, l.target],
        [l.target, l.source],
      ] as const)
        if (frontier.includes(from) && !seen.has(to)) {
          seen.add(to);
          next.push(to);
        }
    }
    frontier = next;
  }
  return seen;
}

/** The size sentence under a graph: what it shows, for people who cannot see the drawing. */
export function summary(g: Graph, truncated: boolean) {
  const items = g.nodes.filter((n) => !n.missing).length;
  const links = g.links.filter((l) => !l.missing).length;
  return `${items} ${items === 1 ? "item" : "items"}, ${links} ${links === 1 ? "link" : "links"}, ${g.orphans} not linked${truncated ? ". Showing the first part of a larger wiki" : ""}`;
}

/** The answer of GET /api/wiki/:slug/graph (items keyed by slug) as graph data, for the small graph on an item page. */
export function fromNeighbors(r: {
  slug: string;
  /** The title of the item the graph is about; the answer lists only its neighbors. */
  title?: string;
  nodes: { slug: string; title: string }[];
  edges: { from: string; to: string; relation: Relation }[];
}): GraphData {
  const titles = new Map([
    [r.slug, r.title ?? r.slug],
    ...r.nodes.map((n) => [n.slug, n.title] as const),
  ]);
  const slugs = [...new Set([r.slug, ...r.nodes.map((n) => n.slug)])];
  const deg = (s: string, side: "from" | "to") => r.edges.filter((e) => e[side] === s).length;
  return {
    nodes: slugs.map((s) => ({
      id: s,
      slug: s,
      title: titles.get(s) ?? s,
      type: "owner" as const,
      tags: [],
      score: 50,
      status: "current" as const,
      access: "own" as const,
      inDegree: deg(s, "to"),
      outDegree: deg(s, "from"),
      updatedAt: "",
    })),
    edges: r.edges,
    dangling: [],
    truncated: false,
  };
}
