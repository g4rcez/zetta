import type { Database } from "@zetta/db";
import type { ActiveActor } from "../identity/access";

export const SEARCH_KINDS = ["conversation", "message", "memory", "artifact", "task"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  /** The matching text. Words that match the query as typed (accents included) are wrapped in `[[` and `]]`. */
  snippet: string;
  /** Set for conversations and messages: where the hit opens. */
  conversationId: string | null;
  messageId: string | null;
  updatedAt: string;
};

const MAX_QUERY = 200;
const HEADLINE = `'MaxFragments=1,MinWords=6,MaxWords=24,StartSel=[[,StopSel=]]'`;
/**
 * One SELECT per kind, all with the same columns. Each filters by the owner ($2), so a hit can never come from another user. The
 * `to_tsvector(...)` expressions are written exactly as in the GIN indexes (packages/db/src/schema/search.ts) so the indexes are used.
 * $1 is the user's text and is only ever a bound parameter.
 */
const BRANCH: Record<SearchKind, string> = {
  conversation: `select 'conversation' as kind, c.id::text, c.title, c.title as snippet, c.id as conversation_id, null::uuid as message_id,
      ts_rank(to_tsvector('simple', f_unaccent(c.title)), q.q) as rank, c.updated_at
    from conversation c, q where c.owner_user_id = $2 and not c.archived and to_tsvector('simple', f_unaccent(c.title)) @@ q.q
    order by rank desc, c.updated_at desc limit $3`,
  message: `select 'message', m.id::text, c.title, ts_headline('simple', m.content, q.q || q.h, ${HEADLINE}), c.id, m.id,
      ts_rank(to_tsvector('simple', f_unaccent(m.content)), q.q), m.created_at
    from message m join conversation c on c.id = m.conversation_id, q
    where m.owner_user_id = $2 and c.owner_user_id = $2 and not c.archived and m.role <> 'system'
      and to_tsvector('simple', f_unaccent(m.content)) @@ q.q
    order by 7 desc, m.created_at desc limit $3`,
  // The id of a memory hit is its slug, which is how the memory item opens.
  memory: `select 'memory', w.slug, w.title, ts_headline('simple', w.content, q.q || q.h, ${HEADLINE}), null::uuid, null::uuid,
      ts_rank(to_tsvector('simple', f_unaccent(w.title || ' ' || w.howto || ' ' || w.content)), q.q), w.updated_at
    from memory_item w, q where w.owner_user_id = $2 and w.status <> 'archived'
      and to_tsvector('simple', f_unaccent(w.title || ' ' || w.howto || ' ' || w.content)) @@ q.q
    order by 7 desc, w.updated_at desc limit $3`,
  artifact: `select 'artifact', a.id::text, a.title, ts_headline('simple', a.description, q.q || q.h, ${HEADLINE}), null::uuid, null::uuid,
      ts_rank(to_tsvector('simple', f_unaccent(a.title || ' ' || a.description || ' ' || a.file_name)), q.q), a.created_at
    from artifact a, q where a.owner_user_id = $2
      and to_tsvector('simple', f_unaccent(a.title || ' ' || a.description || ' ' || a.file_name)) @@ q.q
    order by 7 desc, a.created_at desc limit $3`,
  task: `select 'task', t.id::text, t.title, ts_headline('simple', t.description, q.q || q.h, ${HEADLINE}), t.conversation_id, null::uuid,
      ts_rank(to_tsvector('simple', f_unaccent(t.title || ' ' || t.description)), q.q), t.updated_at
    from task t, q where t.owner_user_id = $2 and to_tsvector('simple', f_unaccent(t.title || ' ' || t.description)) @@ q.q
    order by 7 desc, t.updated_at desc limit $3`,
};

/** Full-text search over everything the signed-in user owns: chats, messages, memory items (which hold what bots remember), artifacts and tasks. */
export function createSearch(db: Database) {
  return {
    async search(
      a: ActiveActor,
      raw: string,
      opts: { kinds?: readonly SearchKind[]; limit?: number } = {},
    ): Promise<SearchHit[]> {
      const q = raw.trim().slice(0, MAX_QUERY);
      if (!q) return [];
      const kinds = opts.kinds?.length
        ? SEARCH_KINDS.filter((k) => opts.kinds!.includes(k))
        : SEARCH_KINDS;
      const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
      const text = `with q as (select websearch_to_tsquery('simple', f_unaccent($1)) as q, websearch_to_tsquery('simple', $1) as h)
        select * from (${kinds.map((k) => `(${BRANCH[k]})`).join(" union all ")}) hits(kind, id, title, snippet, conversation_id, message_id, rank, updated_at) order by rank desc, updated_at desc limit $3`;
      const { rows } = await db.$client.query(text, [q, a.userId, limit]);
      return rows.map((r: Record<string, unknown>) => ({
        kind: r.kind as SearchKind,
        id: r.id as string,
        title: r.title as string,
        snippet: r.snippet as string,
        conversationId: (r.conversation_id as string | null) ?? null,
        messageId: (r.message_id as string | null) ?? null,
        updatedAt: new Date(r.updated_at as string).toISOString(),
      }));
    },
  };
}
export type SearchService = ReturnType<typeof createSearch>;
