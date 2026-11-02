import type { Database } from "@zetta/db";
import { sql } from "@zetta/db/query";
import type { WikiPageStatus, WikiRelation, WikiType } from "@zetta/db/schema/wiki";
import { visibleTo, type WikiReader } from "./service";

const MAX_NODES = 2500,
  MAX_EDGES = 10_000,
  MAX_DANGLING = 500;

export type GraphNode = {
  id: string;
  slug: string;
  title: string;
  type: WikiType;
  tags: string[];
  score: number;
  status: WikiPageStatus;
  access: "own" | "shared";
  inDegree: number;
  outDegree: number;
  updatedAt: string;
};
export type WikiGraph = {
  nodes: GraphNode[];
  edges: { from: string; to: string; relation: WikiRelation }[];
  /** Links of the person's own items to a slug no readable item has (the same ones the checks list as broken). */
  dangling: { from: string; to: string; relation: WikiRelation }[];
  /** True when there are more items or links than one graph holds. */
  truncated: boolean;
};

/**
 * Every item the reader can see (archived ones left out) and the links between them. Nodes are keyed by id: a slug can belong to an
 * own item and to a published one, and a link goes to the reader's own item first. A link to an item the reader cannot see is not
 * an edge, so the graph never shows what a page may not.
 */
export function createWikiGraph(db: Database) {
  return async function wikiGraph(reader: WikiReader): Promise<WikiGraph> {
    const userId = typeof reader === "string" ? reader : reader.userId;
    return db.transaction(async (tx) => {
      const nodes = (
        await tx.execute(sql`
          select p.id, p.slug, p.title, p.type, p.tags, p.score, p.status, p.updated_at as "updatedAt",
            case when p.owner_user_id = ${userId} then 'own' else 'shared' end as access
          from wiki_page p where ${visibleTo(reader, "p")} and p.status <> 'archived'
          order by (p.owner_user_id = ${userId}) desc, p.updated_at desc limit ${MAX_NODES + 1}`)
      ).rows as unknown as (Omit<GraphNode, "inDegree" | "outDegree" | "updatedAt"> & {
        updatedAt: Date;
      })[];
      const more = nodes.length > MAX_NODES;
      const kept = nodes.slice(0, MAX_NODES);
      const ids = kept.map((n) => n.id);
      const none = ids.length === 0;
      const list = sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      );
      const edges = none
        ? []
        : ((
            await tx.execute(sql`
              select distinct on (l.from_page_id, l.relation, l.to_slug) l.from_page_id as "from", t.id as "to", l.relation
              from wiki_link l
              join wiki_page f on f.id = l.from_page_id and f.id in (${list})
              join wiki_page t on t.slug = l.to_slug and t.id in (${list}) and t.id <> f.id
              order by l.from_page_id, l.relation, l.to_slug, (t.owner_user_id = ${userId}) desc
              limit ${MAX_EDGES + 1}`)
          ).rows as unknown as { from: string; to: string; relation: WikiRelation }[]);
      const dangling = none
        ? []
        : ((
            await tx.execute(sql`
              select l.from_page_id as "from", l.to_slug as "to", l.relation
              from wiki_link l join wiki_page f on f.id = l.from_page_id and f.owner_user_id = ${userId} and f.id in (${list})
              where not exists (select 1 from wiki_page t where t.slug = l.to_slug and t.id in (${list}))
              limit ${MAX_DANGLING}`)
          ).rows as unknown as { from: string; to: string; relation: WikiRelation }[]);
      const out = new Map<string, number>(),
        into = new Map<string, number>();
      for (const e of edges.slice(0, MAX_EDGES)) {
        out.set(e.from, (out.get(e.from) ?? 0) + 1);
        into.set(e.to, (into.get(e.to) ?? 0) + 1);
      }
      return {
        nodes: kept.map((n) => ({
          ...n,
          updatedAt: new Date(n.updatedAt).toISOString(),
          inDegree: into.get(n.id) ?? 0,
          outDegree: out.get(n.id) ?? 0,
        })),
        edges: edges.slice(0, MAX_EDGES),
        dangling,
        truncated: more || edges.length > MAX_EDGES,
      };
    });
  };
}
export type WikiGraphReader = ReturnType<typeof createWikiGraph>;
