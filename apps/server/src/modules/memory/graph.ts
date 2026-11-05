import type { Database } from "@zetta/db";
import { sql } from "@zetta/db/query";
import type { MemoryItemStatus, MemoryRelation, MemoryType } from "@zetta/db/schema/memory";
import { visibleTo, type MemoryReader } from "./service";

const MAX_NODES = 2500,
  MAX_EDGES = 10_000,
  MAX_DANGLING = 500;

export type GraphNode = {
  id: string;
  slug: string;
  title: string;
  type: MemoryType;
  tags: string[];
  score: number;
  status: MemoryItemStatus;
  access: "own" | "shared";
  inDegree: number;
  outDegree: number;
  updatedAt: string;
};
export type MemoryGraph = {
  nodes: GraphNode[];
  edges: { from: string; to: string; relation: MemoryRelation }[];
  /** Links of the person's own items to a slug no readable item has (the same ones the checks list as broken). */
  dangling: { from: string; to: string; relation: MemoryRelation }[];
  /** True when there are more items or links than one graph holds. */
  truncated: boolean;
};

/**
 * Every item the reader can see (archived ones left out) and the links between them. Nodes are keyed by id: a slug can belong to an
 * own item and to a published one, and a link goes to the reader's own item first. A link to an item the reader cannot see is not
 * an edge, so the graph never shows what a page may not.
 */
export function createMemoryGraph(db: Database) {
  return async function memoryGraph(reader: MemoryReader): Promise<MemoryGraph> {
    const userId = typeof reader === "string" ? reader : reader.userId;
    return db.transaction(async (tx) => {
      const nodes = (
        await tx.execute(sql`
          select p.id, p.slug, p.title, p.type, p.tags, p.score, p.status, p.updated_at as "updatedAt",
            case when p.owner_user_id = ${userId} then 'own' else 'shared' end as access
          from memory_item p where ${visibleTo(reader, "p")} and p.status <> 'archived'
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
              from memory_link l
              join memory_item f on f.id = l.from_page_id and f.id in (${list})
              join memory_item t on t.slug = l.to_slug and t.id in (${list}) and t.id <> f.id
              order by l.from_page_id, l.relation, l.to_slug, (t.owner_user_id = ${userId}) desc
              limit ${MAX_EDGES + 1}`)
          ).rows as unknown as { from: string; to: string; relation: MemoryRelation }[]);
      const dangling = none
        ? []
        : ((
            await tx.execute(sql`
              select l.from_page_id as "from", l.to_slug as "to", l.relation
              from memory_link l join memory_item f on f.id = l.from_page_id and f.owner_user_id = ${userId} and f.id in (${list})
              where not exists (select 1 from memory_item t where t.slug = l.to_slug and t.id in (${list}))
              limit ${MAX_DANGLING}`)
          ).rows as unknown as { from: string; to: string; relation: MemoryRelation }[]);
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
export type MemoryGraphReader = ReturnType<typeof createMemoryGraph>;
