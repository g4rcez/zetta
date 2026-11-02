import { createHash } from "node:crypto";
import type { Database } from "@zetta/db";
import { and, desc, eq, inArray, lt, ne, sql } from "@zetta/db/query";
import { artifact } from "@zetta/db/schema/artifacts";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { knowledgeDoc } from "@zetta/db/schema/knowledge";
import { task } from "@zetta/db/schema/tasks";
import { team } from "@zetta/db/schema/teams";
import {
  WIKI_RELATIONS,
  WIKI_SCORE_DEFAULT,
  WIKI_SCORE_MAX,
  WIKI_TYPES,
  wikiChunk,
  wikiLink,
  wikiPage,
  wikiPageTeam,
  wikiRevision,
  wikiSource,
  wikiSuggestion,
  type WikiPageStatus,
  type WikiRelation,
  type WikiSourceKind,
  type WikiType,
} from "@zetta/db/schema/wiki";
import { raiseAttention } from "../features/attention";
import { MEMORY_MAX_ENTRIES, unsafeMemory } from "../features/knowledge";
import { looksSecret } from "../features/safety";
import { chunkText } from "../knowledge/chunk";
import { embedQuery, type Embedder } from "../knowledge/embed";

export type WikiCode =
  | "SECRET_REJECTED"
  | "UNSAFE"
  | "CONFLICT"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "FULL"
  | "INVALID"
  | "SLUG_TAKEN"
  | "MANAGED";
export class WikiError extends Error {
  constructor(readonly code: WikiCode) {
    super(code);
  }
}
/** Who changes a page. A bot write also records the chat it came from; `system` is the source check. */
export type WikiAuthor =
  | { by: "user" }
  | { by: "system" }
  | { by: "bot"; botId: string; conversationId?: string | null | undefined };
/**
 * Who reads. A person (a plain user id) sees all of their own items. A bot also needs the items' `type` to allow it: `solo` items only
 * for their author bot, `teams` items only for bots in one of the item's teams.
 */
export type WikiReader = string | { userId: string; botId?: string | undefined };
export type WikiPage = typeof wikiPage.$inferSelect;
/** own: the asker's page. shared: another active member published it; the asker reads it and can only suggest changes. */
export type WikiAccess = "own" | "shared";
export type WikiNeighbor = {
  relation: WikiRelation;
  direction: "out" | "in";
  slug: string;
  title: string;
};
export type WikiHit = {
  slug: string;
  title: string;
  type: WikiType;
  howto: string;
  tags: string[];
  score: number;
  status: WikiPageStatus;
  access: WikiAccess;
  ownerName: string | null;
  /** Items linked to or from this one (up to 3), so a bot can follow the graph without another search. */
  neighbors: WikiNeighbor[];
};
export type Explained = {
  id: string;
  updatedAt: string;
  /** Which rankings found the item: words in the text, words that are tags, or the nearest passage by meaning. */
  why: { keyword: boolean; tags: string[]; meaning: boolean; passage: string };
};
export type WikiHitExplained = WikiHit & Explained;
/** Narrows the items a search looks at. */
export type WikiFilter = {
  types?: WikiType[];
  statuses?: WikiPageStatus[];
  tags?: string[];
  tagMode?: "any" | "all";
  access?: "own" | "shared";
  by?: "user" | "bot" | "system";
  botId?: string;
  teamId?: string;
  minScore?: number;
  maxScore?: number;
  updatedSince?: Date;
};
// ts_headline options: the markers are control characters no text holds, so the web can split on them without parsing HTML.
const PASSAGE = "MaxFragments=1,MaxWords=28,MinWords=10,StartSel=\u0001,StopSel=\u0002";

/** What a version holds. type, teams, score and the author bot are metadata: changing them is not a new version. */
type Content = Pick<WikiPage, "title" | "howto" | "content" | "tags" | "status">;
export type WikiMeta = {
  type?: WikiType | undefined;
  teams?: readonly string[] | undefined;
  score?: number | undefined;
  authorBotId?: string | null | undefined;
};

export const WIKI_LIMITS = {
  slug: 80,
  title: 160,
  howto: 300,
  content: 20_000,
  tags: 12,
  tag: 40,
  pages: 2000,
  sources: 12,
  teams: 20,
} as const;
const PAGES_PER_TICK = 50,
  BACKFILL = 64,
  EMBED_CHARS = 2000,
  NEIGHBORS_PER_HIT = 3,
  GRAPH_NODES = 30,
  GRAPH_DEPTH = 2;
// Same model and cut-offs as company knowledge (see knowledge/service.ts); re-measure on a model change.
const QUERY_EMBED_MS = 2500,
  MAX_DISTANCE = 0.2,
  CANDIDATES = 20,
  RRF_K = 60;
const CHECK_EVERY_MS = 5 * 60_000,
  CHECKS_PER_TICK = 50,
  OLD_DAYS = 90;

// Words that say nothing about the topic (English and Portuguese). A whole message is matched on the other words only.
const STOP = new Set(
  `the and for with from this that these those have has had are was were not but you your can could would should what when where which who how why will all any into about please need needs want make use get got let one not than then them they its our out too very also just more some such only over under para com uma uns que como por mais mas dos das nos nas isso esse essa este esta foi ser sua seu tem quero preciso favor pode ainda sobre entre quando onde qual quais`.split(
    " ",
  ),
);
const vec = (v: number[]) => `[${v.join(",")}]`;
const strip = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
/** "Acme – Billing API" -> "acme-billing-api". Empty when nothing usable is left. */
export const wikiSlug = (s: string) =>
  strip(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WIKI_LIMITS.slug)
    .replace(/-+$/, "");
/** Tags are slugs too: lower-case words joined by hyphens, no duplicates, a bounded number. */
export const wikiTags = (tags: readonly string[]) =>
  [
    ...new Set(
      tags
        .map((t) =>
          strip(t)
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, WIKI_LIMITS.tag),
        )
        .filter(Boolean),
    ),
  ].slice(0, WIKI_LIMITS.tags);
const LINK = new RegExp(`\\[\\[(?:(${WIKI_RELATIONS.join("|")}):)?([a-z0-9-]+)\\]\\]`, "g");
/** The edges a content writes: `[[slug]]` is `related`, `[[depends-on:slug]]` (also part-of, supersedes) is typed. A link to itself is no edge. */
export function wikiLinks(content: string, self: string) {
  const out = new Map<string, { relation: WikiRelation; slug: string }>();
  for (const m of content.matchAll(LINK)) {
    const relation = (m[1] ?? "related") as WikiRelation,
      slug = m[2]!;
    if (slug !== self) out.set(`${relation}:${slug}`, { relation, slug });
  }
  return [...out.values()];
}
export type WikiLinkRelation = "related" | "depends-on" | "part-of" | "supersedes";
const LINK_LABEL: Record<WikiLinkRelation, string> = {
  related: "Related",
  "depends-on": "Depends on",
  "part-of": "Part of",
  supersedes: "Supersedes",
};
const contentOf = (p: WikiPage): Content => ({
  title: p.title,
  howto: p.howto,
  content: p.content,
  tags: p.tags,
  status: p.status,
});
const same = (a: Content, b: Content) =>
  a.title === b.title &&
  a.howto === b.howto &&
  a.content === b.content &&
  a.status === b.status &&
  a.tags.length === b.tags.length &&
  a.tags.every((t, i) => t === b.tags[i]);
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));
const pageLink = (slug: string) => `/wiki/${encodeURIComponent(slug)}`;
const who = (r: WikiReader) => (typeof r === "string" ? { userId: r, botId: undefined } : r);
const uniqueViolation = (e: unknown) =>
  (e as { code?: string }).code === "23505" ||
  (e as { cause?: { code?: string } }).cause?.code === "23505";

/**
 * Which items the reader may see, for the table (or alias) named `t`: the reader's own items that the bot's access allows, plus items
 * another active member published (`all`). A published item counts only while its owner is an active member, so removing a member
 * withdraws what they published.
 */
export function visibleTo(reader: WikiReader, t = "wiki_page"): ReturnType<typeof sql> {
  const { userId, botId } = who(reader);
  const c = (col: string) => sql`${sql.identifier(t)}.${sql.identifier(col)}`;
  const own = botId
    ? sql`(${c("type")} in ('owner', 'all') or (${c("type")} = 'solo' and ${c("author_bot_id")} = ${botId})
        or (${c("type")} = 'teams' and exists (select 1 from wiki_page_team wt join team_member tm on tm.team_id = wt.team_id
          where wt.page_id = ${c("id")} and tm.bot_id = ${botId})))`
    : sql`true`;
  return sql`((${c("owner_user_id")} = ${userId} and ${own}) or (${c("type")} = 'all' and ${c("status")} <> 'archived'
    and exists (select 1 from membership m where m.user_id = ${c("owner_user_id")} and m.status = 'active')))`;
}

/** The facets of a search as one SQL condition on `wiki_page`. */
function filterSql(f: WikiFilter, userId: string): ReturnType<typeof sql> {
  const list = (xs: readonly string[]) =>
    sql.join(
      xs.map((x) => sql`${x}`),
      sql`, `,
    );
  const parts: ReturnType<typeof sql>[] = [];
  if (f.types?.length) parts.push(sql`wiki_page.type in (${list(f.types)})`);
  if (f.statuses?.length) parts.push(sql`wiki_page.status in (${list(f.statuses)})`);
  if (f.tags?.length) {
    const arr = sql`array[${list(f.tags)}]::text[]`;
    parts.push(f.tagMode === "all" ? sql`wiki_page.tags @> ${arr}` : sql`wiki_page.tags && ${arr}`);
  }
  if (f.access === "own") parts.push(sql`wiki_page.owner_user_id = ${userId}`);
  if (f.access === "shared") parts.push(sql`wiki_page.owner_user_id <> ${userId}`);
  if (f.by) parts.push(sql`wiki_page.updated_by = ${f.by}`);
  if (f.botId) parts.push(sql`wiki_page.updated_by_bot_id = ${f.botId}`);
  if (f.teamId)
    parts.push(
      sql`exists (select 1 from wiki_page_team wt where wt.page_id = wiki_page.id and wt.team_id = ${f.teamId})`,
    );
  if (f.minScore !== undefined) parts.push(sql`wiki_page.score >= ${f.minScore}`);
  if (f.maxScore !== undefined) parts.push(sql`wiki_page.score <= ${f.maxScore}`);
  if (f.updatedSince)
    parts.push(sql`wiki_page.updated_at >= ${f.updatedSince.toISOString()}::timestamptz`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

/**
 * The operator's wiki (see schema/wiki.ts). An item belongs to one user and is read by the bots its type allows; the owner may publish
 * it to every active member, who read it and suggest changes but never write it. Writes are serialised per item, keep a revision of
 * every version, and refuse secrets; a bot's text is also screened for injection phrasing, because items are replayed into prompts.
 * Items link to each other (`wiki_link`) and to their evidence (`wiki_source`), and are marked stale when the evidence changes.
 */
export function createWiki(db: Database, deps: { embedder?: Embedder } = {}) {
  let busy = false,
    checking = false;

  function check(c: Content, author: WikiAuthor) {
    if (!c.title.trim() || !c.content.trim()) throw new WikiError("INVALID");
    if (
      c.title.length > WIKI_LIMITS.title ||
      c.howto.length > WIKI_LIMITS.howto ||
      c.content.length > WIKI_LIMITS.content
    )
      throw new WikiError("INVALID");
    const text = `${c.title}\n${c.howto}\n${c.tags.join(" ")}\n${c.content}`;
    if (looksSecret(text)) throw new WikiError("SECRET_REJECTED");
    if (author.by === "bot" && unsafeMemory(text)) throw new WikiError("UNSAFE");
  }

  /**
   * The one write path: `change` gets the current page (undefined when new) inside the transaction and returns the next content and,
   * when it sets them, metadata. `expectedVersion` makes it fail with CONFLICT when someone saved in between. A page whose content did
   * not change is not saved again; a change of metadata alone updates the page without a new version.
   */
  async function save(
    owner: string,
    slug: string,
    author: WikiAuthor,
    change: (cur: WikiPage | undefined) => Content & { meta?: WikiMeta },
    expectedVersion?: number,
  ) {
    const key = wikiSlug(slug);
    if (!key) throw new WikiError("INVALID");
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wiki:${owner}:${key}`}))`);
        const [cur] = await tx
          .select()
          .from(wikiPage)
          .where(and(eq(wikiPage.ownerUserId, owner), eq(wikiPage.slug, key)));
        if (cur && author.by === "bot") {
          // A bot edits only what it can read; a slug it cannot see is taken by an item of another bot or team.
          const seen = await tx
            .select({ id: wikiPage.id })
            .from(wikiPage)
            .where(and(eq(wikiPage.id, cur.id), visibleTo({ userId: owner, botId: author.botId })));
          if (!seen.length) throw new WikiError("SLUG_TAKEN");
        }
        if (expectedVersion !== undefined && (cur?.version ?? 0) !== expectedVersion)
          throw new WikiError("CONFLICT");
        const next = change(cur);
        const c: Content = {
          title: next.title.trim(),
          howto: next.howto.trim(),
          content: next.content.trim(),
          tags: wikiTags(next.tags),
          status: next.status,
        };
        check(c, author);

        const m = next.meta ?? {};
        const curTeams = cur
          ? (
              await tx
                .select({ id: wikiPageTeam.teamId })
                .from(wikiPageTeam)
                .where(eq(wikiPageTeam.pageId, cur.id))
            ).map((r) => r.id)
          : [];
        const type = m.type ?? cur?.type ?? "owner";
        const authorBotId = cur
          ? m.authorBotId !== undefined
            ? m.authorBotId
            : cur.authorBotId
          : (m.authorBotId ?? (author.by === "bot" ? author.botId : null));
        const score = m.score ?? cur?.score ?? WIKI_SCORE_DEFAULT;
        const teams = type === "teams" ? [...new Set(m.teams ?? curTeams)] : [];
        if (
          !WIKI_TYPES.includes(type) ||
          !Number.isInteger(score) ||
          score < 0 ||
          score > WIKI_SCORE_MAX
        )
          throw new WikiError("INVALID");
        // A bot never publishes: `all` is a person's choice (routes only).
        if (author.by === "bot" && type === "all" && cur?.type !== "all")
          throw new WikiError("INVALID");
        if (type === "solo" && !authorBotId) throw new WikiError("INVALID");
        if (authorBotId && authorBotId !== cur?.authorBotId && author.by !== "bot") {
          // A person names the bot an item belongs to: it must be one of their own.
          const [mine] = await tx
            .select({ id: bot.id })
            .from(bot)
            .where(and(eq(bot.id, authorBotId), eq(bot.ownerUserId, owner)));
          if (!mine) throw new WikiError("INVALID");
        }
        if (type === "teams") {
          if (!teams.length || teams.length > WIKI_LIMITS.teams) throw new WikiError("INVALID");
          const mine = await tx
            .select({ id: team.id })
            .from(team)
            .where(and(inArray(team.id, teams), eq(team.ownerUserId, owner)));
          if (mine.length !== teams.length) throw new WikiError("INVALID");
        }
        // An item that holds a Drive document is written by the sync: its title and text are the document's, and it is never published
        // (the document was read with one person's token).
        if (cur) {
          const [managed] = await tx
            .select({ id: knowledgeDoc.id })
            .from(knowledgeDoc)
            .where(eq(knowledgeDoc.pageId, cur.id))
            .limit(1);
          if (managed && (c.title !== cur.title || c.content !== cur.content || type === "all"))
            throw new WikiError("MANAGED");
        }
        // What goes into every prompt is bounded (features/knowledge.ts): one bot keeps at most this many notes of its own, a person this
        // many profile items. The check runs when an item enters one of the two sets.
        const profile = type === "owner" && c.tags.includes("profile");
        const entersSet =
          (type === "solo" && (!cur || cur.type !== "solo" || cur.authorBotId !== authorBotId)) ||
          (profile && (!cur || cur.type !== "owner" || !cur.tags.includes("profile")));
        if (entersSet) {
          const [{ n } = { n: 0 }] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(wikiPage)
            .where(
              and(
                eq(wikiPage.ownerUserId, owner),
                ne(wikiPage.status, "archived"),
                type === "solo"
                  ? and(eq(wikiPage.type, "solo"), eq(wikiPage.authorBotId, authorBotId!))
                  : and(
                      eq(wikiPage.type, "owner"),
                      sql`${wikiPage.tags} @> array['profile']::text[]`,
                    ),
              ),
            );
          if (n >= MEMORY_MAX_ENTRIES) throw new WikiError("FULL");
        }
        const metaChanged =
          !cur ||
          cur.type !== type ||
          cur.score !== score ||
          cur.authorBotId !== authorBotId ||
          !sameSet(curTeams, teams);
        const contentChanged = !cur || !same(cur, c);
        if (cur && !contentChanged && !metaChanged)
          return { page: cur, created: false, changed: false };

        const botId = author.by === "bot" ? author.botId : null;
        let page: WikiPage;
        if (cur) {
          const by = contentChanged
            ? {
                ...c,
                version: cur.version + 1,
                updatedBy: author.by,
                updatedByBotId: botId,
                updatedAt: new Date(),
              }
            : {};
          [page] = (await tx
            .update(wikiPage)
            .set({ ...by, type, score, authorBotId })
            .where(eq(wikiPage.id, cur.id))
            .returning()) as [WikiPage];
        } else {
          const [{ n } = { n: 0 }] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(wikiPage)
            .where(eq(wikiPage.ownerUserId, owner));
          if (n >= WIKI_LIMITS.pages) throw new WikiError("FULL");
          [page] = (await tx
            .insert(wikiPage)
            .values({
              ownerUserId: owner,
              slug: key,
              ...c,
              type,
              score,
              authorBotId,
              updatedBy: author.by,
              updatedByBotId: botId,
            })
            .returning()) as [WikiPage];
        }
        if (!cur || !sameSet(curTeams, teams)) {
          await tx.delete(wikiPageTeam).where(eq(wikiPageTeam.pageId, page.id));
          if (teams.length)
            await tx
              .insert(wikiPageTeam)
              .values(teams.map((teamId) => ({ pageId: page.id, teamId })));
        }
        if (contentChanged) {
          // Edges follow the content; chunks are rebuilt (and embedded) by the ticker.
          await tx.delete(wikiLink).where(eq(wikiLink.fromPageId, page.id));
          const edges = wikiLinks(c.content, key);
          if (edges.length)
            await tx
              .insert(wikiLink)
              .values(
                edges.map((e) => ({ fromPageId: page.id, relation: e.relation, toSlug: e.slug })),
              );
          await tx.delete(wikiChunk).where(eq(wikiChunk.pageId, page.id));
          await tx.insert(wikiRevision).values({
            pageId: page.id,
            ownerUserId: owner,
            version: page.version,
            ...c,
            author: author.by,
            botId,
            conversationId: author.by === "bot" ? (author.conversationId ?? null) : null,
          });
        }
        return { page, created: !cur, changed: true };
      });
    } catch (e) {
      if (uniqueViolation(e)) throw new WikiError("SLUG_TAKEN");
      throw e;
    }
  }

  /** What a source reference points to right now, read only from the owner's own rows. Undefined when it does not exist (any more). */
  async function lookup(
    owner: string,
    kind: WikiSourceKind,
    ref: string,
  ): Promise<{ label: string; version: string } | undefined> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    if (kind === "url") {
      try {
        const u = new URL(ref);
        return u.protocol === "https:"
          ? { label: `${u.hostname}${u.pathname}`.slice(0, 160), version: "" }
          : undefined;
      } catch {
        return undefined;
      }
    }
    if (!uuid) return undefined;
    if (kind === "task") {
      const [t] = await db
        .select({ title: task.title, status: task.status, updatedAt: task.updatedAt })
        .from(task)
        .where(and(eq(task.id, ref), eq(task.ownerUserId, owner)));
      return (
        t && { label: t.title.slice(0, 160), version: `${t.status}@${t.updatedAt.toISOString()}` }
      );
    }
    if (kind === "doc") {
      const [d] = await db
        .select({
          name: knowledgeDoc.name,
          version: knowledgeDoc.version,
          state: knowledgeDoc.state,
        })
        .from(knowledgeDoc)
        .where(and(eq(knowledgeDoc.id, ref), eq(knowledgeDoc.ownerUserId, owner)));
      return d && d.state !== "removed"
        ? { label: d.name.slice(0, 160), version: d.version }
        : undefined;
    }
    const [a] = await db
      .select({ title: artifact.title, sha256: artifact.sha256 })
      .from(artifact)
      .where(and(eq(artifact.id, ref), eq(artifact.ownerUserId, owner)));
    return a && { label: a.title.slice(0, 160), version: a.sha256 };
  }

  /** "task:<id>", "doc:<id>", "artifact:<id>" or "url:https://…" -> a source row, or the reference back in `skipped`. */
  async function resolve(owner: string, refs: readonly string[]) {
    const found: { kind: WikiSourceKind; ref: string; label: string; seenVersion: string }[] = [];
    const skipped: string[] = [];
    for (const raw of [...new Set(refs.map((r) => r.trim()))].slice(0, WIKI_LIMITS.sources)) {
      const at = raw.indexOf(":");
      const kind = raw.slice(0, at) as WikiSourceKind,
        ref = raw.slice(at + 1).trim();
      const hit = ["task", "doc", "artifact", "url"].includes(kind)
        ? await lookup(owner, kind, ref)
        : undefined;
      if (hit) found.push({ kind, ref, label: hit.label, seenVersion: hit.version });
      else skipped.push(raw);
    }
    return { found, skipped };
  }

  /** Links evidence to a page. `replace` drops the old links first; `add` keeps them and refreshes the ones given again. */
  async function linkSources(
    owner: string,
    pageId: string,
    refs: readonly string[],
    mode: "replace" | "add",
  ) {
    const { found, skipped } = await resolve(owner, refs);
    await db.transaction(async (tx) => {
      if (mode === "replace")
        await tx
          .delete(wikiSource)
          .where(and(eq(wikiSource.pageId, pageId), eq(wikiSource.ownerUserId, owner)));
      for (const s of found)
        await tx
          .insert(wikiSource)
          .values({ pageId, ownerUserId: owner, ...s })
          .onConflictDoUpdate({
            target: [wikiSource.pageId, wikiSource.kind, wikiSource.ref],
            set: {
              label: s.label,
              seenVersion: s.seenVersion,
              status: "current",
              checkedAt: new Date(),
            },
          });
    });
    return { linked: found.length, skipped };
  }

  /** A full save says the page is true now: every source it keeps is measured again from that moment. */
  async function rebaseline(owner: string, pageId: string) {
    const rows = await db
      .select()
      .from(wikiSource)
      .where(and(eq(wikiSource.pageId, pageId), eq(wikiSource.ownerUserId, owner)));
    for (const s of rows) {
      const now = await lookup(owner, s.kind, s.ref);
      await db
        .update(wikiSource)
        .set(
          now
            ? { seenVersion: now.version, status: "current", checkedAt: new Date() }
            : { status: "gone", checkedAt: new Date() },
        )
        .where(eq(wikiSource.id, s.id));
    }
  }

  /**
   * Creates the page or replaces its content. Howto, tags and metadata keep their old values when not given; a full save makes it current
   * again. `sources` replaces the page's evidence; without it the kept evidence is measured again. A page shared by another member is not
   * written here: the asker's own page with the same slug would hide it, so the caller suggests a change instead.
   */
  async function write(
    owner: string,
    v: WikiMeta & {
      slug: string;
      title: string;
      content: string;
      howto?: string | undefined;
      tags?: readonly string[] | undefined;
      status?: WikiPageStatus | undefined;
      expectedVersion?: number | undefined;
      sources?: readonly string[] | undefined;
    },
    author: WikiAuthor,
  ) {
    const r = await save(
      owner,
      v.slug,
      author,
      (cur) => ({
        title: v.title,
        content: v.content,
        howto: v.howto ?? cur?.howto ?? "",
        tags: v.tags ? [...v.tags] : (cur?.tags ?? []),
        status: v.status ?? "current",
        meta: { type: v.type, teams: v.teams, score: v.score, authorBotId: v.authorBotId },
      }),
      v.expectedVersion,
    );
    const s = v.sources
      ? await linkSources(owner, r.page.id, v.sources, "replace")
      : (await rebaseline(owner, r.page.id), { linked: 0, skipped: [] as string[] });
    return { ...r, skippedSources: s.skipped };
  }

  /**
   * A short fact kept without a bot tool call (the "remember that ..." message). target "memory" is a note only that bot reads
   * (type solo, tag memory); "user" is about the person and every bot of theirs reads it (type owner, tag profile). The slug follows the
   * text, so saying the same thing twice saves it once.
   */
  async function remember(
    owner: string,
    v: { content: string; botId: string; target: "user" | "memory" },
    author: WikiAuthor,
  ) {
    const text = v.content.trim();
    const hash = createHash("sha256")
      .update(`${v.target === "memory" ? v.botId : ""}\n${text.toLowerCase().replace(/\s+/g, " ")}`)
      .digest("hex")
      .slice(0, 12);
    const slug = `memory-${hash}`;
    // The same fact in other letters or spacing is the fact already saved.
    const [have] = await db
      .select()
      .from(wikiPage)
      .where(
        and(
          eq(wikiPage.ownerUserId, owner),
          eq(wikiPage.slug, slug),
          ne(wikiPage.status, "archived"),
        ),
      );
    if (have) return { page: have, created: false, changed: false, skippedSources: [] as string[] };
    return write(
      owner,
      {
        slug,
        title: text.slice(0, 60),
        content: text,
        tags: [v.target === "user" ? "profile" : "memory"],
        type: v.target === "user" ? "owner" : "solo",
        score: v.target === "user" ? 90 : 80,
        ...(v.target === "memory" && { authorBotId: v.botId }),
      },
      author,
    );
  }

  /** Replaces one unique span of the content; a page that was marked stale stays stale until someone saves it in full. */
  function patch(owner: string, slug: string, match: string, content: string, author: WikiAuthor) {
    return save(owner, slug, author, (cur) => {
      if (!cur || cur.status === "archived") throw new WikiError("NOT_FOUND");
      const hits = cur.content.split(match).length - 1;
      if (!match || hits === 0) throw new WikiError("NOT_FOUND");
      if (hits > 1) throw new WikiError("AMBIGUOUS");
      return { ...contentOf(cur), content: cur.content.replace(match, () => content) };
    });
  }

  async function setStatus(
    owner: string,
    slug: string,
    status: WikiPageStatus,
    author: WikiAuthor,
  ) {
    const r = await save(owner, slug, author, (cur) => {
      if (!cur) throw new WikiError("NOT_FOUND");
      return { ...contentOf(cur), status };
    });
    if (status === "current" && r.changed && author.by !== "system")
      await rebaseline(owner, r.page.id); // a person confirmed it again
    return r;
  }

  /**
   * "Checked, still true": a stale item becomes current, and a current one counts as saved now (it leaves the 90-day list). The text and
   * the version stay as they are; the evidence is measured again from this moment.
   */
  async function confirm(owner: string, slug: string, author: WikiAuthor) {
    const [cur] = await db
      .select()
      .from(wikiPage)
      .where(and(eq(wikiPage.ownerUserId, owner), eq(wikiPage.slug, slug)));
    if (!cur || cur.status === "archived") throw new WikiError("NOT_FOUND");
    if (cur.status === "stale") return setStatus(owner, slug, "current", author);
    const [page] = await db
      .update(wikiPage)
      .set({ updatedAt: new Date() })
      .where(eq(wikiPage.id, cur.id))
      .returning();
    await rebaseline(owner, cur.id);
    return { page: page!, created: false, changed: true };
  }

  /**
   * Adds a link to another item as its own line at the end of the content, with no rewrite of the text. A link to the same item that
   * is already there (any relation) is kept as it is. The target must be an item the owner can read.
   */
  async function addLink(
    owner: string,
    slug: string,
    to: string,
    relation: WikiLinkRelation,
    author: WikiAuthor,
  ) {
    const [target] = await db
      .select({ slug: wikiPage.slug })
      .from(wikiPage)
      .where(
        and(
          eq(wikiPage.slug, to),
          visibleTo({ userId: owner, botId: author.by === "bot" ? author.botId : undefined }),
          ne(wikiPage.status, "archived"),
        ),
      );
    if (!target || to === slug) throw new WikiError("NOT_FOUND");
    return save(owner, slug, author, (cur) => {
      if (!cur || cur.status === "archived") throw new WikiError("NOT_FOUND");
      if ([...cur.content.matchAll(LINK)].some((m) => m[2] === to)) return contentOf(cur);
      const link = relation === "related" ? `[[${to}]]` : `[[${relation}:${to}]]`;
      return {
        ...contentOf(cur),
        content: `${cur.content.trimEnd()}\n\n${LINK_LABEL[relation]}: ${link}`,
      };
    });
  }

  /**
   * Who may read the item, how important it is, and which bot wrote it. Publishing (`all`) is a person's choice (routes only, never a
   * bot tool). It is not a new version: the text does not change.
   */
  async function setMeta(owner: string, slug: string, meta: WikiMeta, author: WikiAuthor) {
    const r = await save(owner, slug, author, (cur) => {
      if (!cur) throw new WikiError("NOT_FOUND");
      return { ...contentOf(cur), meta };
    });
    return r.page;
  }

  /** Writes the text of an old version as the newest one. */
  async function restore(owner: string, slug: string, version: number, author: WikiAuthor) {
    const [r] = await db
      .select()
      .from(wikiRevision)
      .innerJoin(wikiPage, eq(wikiPage.id, wikiRevision.pageId))
      .where(
        and(
          eq(wikiPage.ownerUserId, owner),
          eq(wikiPage.slug, wikiSlug(slug)),
          eq(wikiRevision.version, version),
        ),
      );
    if (!r) throw new WikiError("NOT_FOUND");
    const old = r.wiki_revision;
    return save(owner, slug, author, () => ({
      title: old.title,
      howto: old.howto,
      content: old.content,
      tags: old.tags,
      status: old.status,
    }));
  }

  /** The reader's own page with that slug, else a page another active member shared. */
  async function read(reader: WikiReader, slug: string) {
    const key = wikiSlug(slug);
    if (!key) return undefined;
    const rows = await db
      .select({ page: wikiPage, ownerName: user.name })
      .from(wikiPage)
      .innerJoin(user, eq(user.id, wikiPage.ownerUserId))
      .where(and(eq(wikiPage.slug, key), visibleTo(reader)));
    const own = rows.find((r) => r.page.ownerUserId === who(reader).userId);
    const hit = own ?? rows[0];
    if (!hit) return undefined;
    const access: WikiAccess = own ? "own" : "shared";
    const teams = own
      ? (
          await db
            .select({ id: wikiPageTeam.teamId })
            .from(wikiPageTeam)
            .where(eq(wikiPageTeam.pageId, hit.page.id))
        ).map((r) => r.id)
      : [];
    const near = (await graph(reader, [key], { limit: GRAPH_NODES })).edges;
    // `linkedFrom` stays the list of pages that link here; `links` are the edges this page writes.
    const linkedFrom = near
      .filter((e) => e.to === key)
      .map((e) => ({ slug: e.from, title: e.fromTitle, relation: e.relation }));
    const links = near
      .filter((e) => e.from === key)
      .map((e) => ({ slug: e.to, title: e.toTitle, relation: e.relation }));
    return {
      page: { ...hit.page, teams },
      access,
      ownerName: access === "own" ? null : hit.ownerName,
      linkedFrom,
      links,
    };
  }

  /** Items a person picked for a message: the reader's own or published ones that are not archived, in the order given. */
  async function byIds(reader: WikiReader, ids: readonly string[]) {
    if (!ids.length) return [];
    const rows = await db
      .select({
        id: wikiPage.id,
        slug: wikiPage.slug,
        title: wikiPage.title,
        howto: wikiPage.howto,
        content: wikiPage.content,
        tags: wikiPage.tags,
      })
      .from(wikiPage)
      .where(
        and(inArray(wikiPage.id, [...ids]), ne(wikiPage.status, "archived"), visibleTo(reader)),
      );
    return ids.flatMap((id) => rows.find((r) => r.id === id) ?? []);
  }

  type Edge = {
    from: string;
    fromTitle: string;
    relation: WikiRelation;
    to: string;
    toTitle: string;
  };
  /** Edges between items the reader can see, where one end is in `slugs`. A link to an item the reader cannot see is not shown. */
  async function edgesAround(reader: WikiReader, slugs: readonly string[]): Promise<Edge[]> {
    if (!slugs.length) return [];
    const list = sql.join(
      slugs.map((x) => sql`${x}`),
      sql`, `,
    );
    const { rows } = await db.execute(sql`
      select pf.slug as "from", pf.title as "fromTitle", l.relation, pt.slug as "to", pt.title as "toTitle"
      from wiki_link l
      join wiki_page pf on pf.id = l.from_page_id
      join wiki_page pt on pt.slug = l.to_slug
      where (pf.slug in (${list}) or pt.slug in (${list}))
        and pf.status <> 'archived' and pt.status <> 'archived'
        and ${visibleTo(reader, "pf")} and ${visibleTo(reader, "pt")}
      limit 300`);
    const seen = new Set<string>();
    return (rows as Edge[]).filter((e) => {
      const k = `${e.from}|${e.relation}|${e.to}`;
      return !seen.has(k) && seen.add(k);
    });
  }

  /** The items around `slugs`, walking links in both directions up to `depth` steps and `limit` items. */
  async function graph(
    reader: WikiReader,
    slugs: readonly string[],
    o: { depth?: number; limit?: number } = {},
  ) {
    const depth = Math.min(o.depth ?? 1, GRAPH_DEPTH),
      limit = o.limit ?? GRAPH_NODES;
    const nodes = new Map<string, string>();
    const edges: Edge[] = [];
    const seen = new Set<string>(slugs);
    let frontier = [...slugs];
    for (let step = 0; step < depth && frontier.length && seen.size < limit; step++) {
      const found = await edgesAround(reader, frontier);
      const next: string[] = [];
      for (const e of found) {
        edges.push(e);
        nodes.set(e.from, e.fromTitle);
        nodes.set(e.to, e.toTitle);
        for (const x of [e.from, e.to])
          if (!seen.has(x) && seen.size < limit) {
            seen.add(x);
            next.push(x);
          }
      }
      frontier = next;
    }
    const uniq = new Map(edges.map((e) => [`${e.from}|${e.relation}|${e.to}`, e]));
    return {
      nodes: [...nodes].map(([slug, title]) => ({ slug, title })),
      edges: [...uniq.values()],
    };
  }

  /** The items linked to or from `slug`, up to `depth` (at most 2) steps away. */
  async function neighbors(reader: WikiReader, slug: string, depth = 1) {
    const key = wikiSlug(slug);
    if (!key || !(await read(reader, key))) throw new WikiError("NOT_FOUND");
    const g = await graph(reader, [key], { depth });
    return { slug: key, nodes: g.nodes.filter((n) => n.slug !== key), edges: g.edges };
  }

  async function history(owner: string, slug: string) {
    return db
      .select({
        version: wikiRevision.version,
        title: wikiRevision.title,
        status: wikiRevision.status,
        author: wikiRevision.author,
        botId: wikiRevision.botId,
        conversationId: wikiRevision.conversationId,
        createdAt: wikiRevision.createdAt,
      })
      .from(wikiRevision)
      .innerJoin(wikiPage, eq(wikiPage.id, wikiRevision.pageId))
      .where(and(eq(wikiPage.ownerUserId, owner), eq(wikiPage.slug, wikiSlug(slug))))
      .orderBy(desc(wikiRevision.version))
      .limit(100);
  }

  /** Evidence of one of the owner's pages. */
  async function sources(owner: string, slug: string) {
    return db
      .select({
        kind: wikiSource.kind,
        ref: wikiSource.ref,
        label: wikiSource.label,
        status: wikiSource.status,
        checkedAt: wikiSource.checkedAt,
      })
      .from(wikiSource)
      .innerJoin(wikiPage, eq(wikiPage.id, wikiSource.pageId))
      .where(and(eq(wikiPage.ownerUserId, owner), eq(wikiPage.slug, wikiSlug(slug))))
      .orderBy(wikiSource.id);
  }

  /** All of the owner's items (a person sees every type), newest first. */
  async function list(owner: string) {
    return db
      .select({
        id: wikiPage.id,
        slug: wikiPage.slug,
        title: wikiPage.title,
        type: wikiPage.type,
        howto: wikiPage.howto,
        tags: wikiPage.tags,
        score: wikiPage.score,
        status: wikiPage.status,
        version: wikiPage.version,
        authorBotId: wikiPage.authorBotId,
        updatedByBotId: wikiPage.updatedByBotId,
        createdAt: wikiPage.createdAt,
        teams: sql<
          string[]
        >`coalesce((select array_agg(wt.team_id::text) from wiki_page_team wt where wt.page_id = ${wikiPage.id}), '{}')`,
        updatedBy: wikiPage.updatedBy,
        updatedAt: wikiPage.updatedAt,
      })
      .from(wikiPage)
      .where(eq(wikiPage.ownerUserId, owner))
      .orderBy(desc(wikiPage.updatedAt))
      .limit(WIKI_LIMITS.pages);
  }

  /** Items other active members published, newest first. */
  async function listShared(reader: string) {
    return db
      .select({
        id: wikiPage.id,
        slug: wikiPage.slug,
        title: wikiPage.title,
        type: wikiPage.type,
        howto: wikiPage.howto,
        tags: wikiPage.tags,
        score: wikiPage.score,
        status: wikiPage.status,
        ownerName: user.name,
        createdAt: wikiPage.createdAt,
        version: wikiPage.version,
        updatedAt: wikiPage.updatedAt,
      })
      .from(wikiPage)
      .innerJoin(user, eq(user.id, wikiPage.ownerUserId))
      .where(and(ne(wikiPage.ownerUserId, reader), visibleTo(reader)))
      .orderBy(desc(wikiPage.updatedAt))
      .limit(500);
  }

  /**
   * The items the reader may see that best fit `text`. Three rankings are fused (reciprocal rank): keywords in title, howto and content;
   * words that are tags; and the nearest chunks by meaning. The fused rank is scaled by the item's score (x0.5 at 0, x1.5 at 100).
   * Archived items are left out. Each hit lists a few linked items. `filter` narrows the items before ranking; `explain` adds, for each
   * hit, which rankings found it and the best passage (the nearest chunk, or the words in context).
   */
  async function rank(
    reader: WikiReader,
    text: string,
    k: number,
    o: { filter?: WikiFilter | undefined; explain?: boolean } = {},
  ): Promise<{ hits: (WikiHit & Partial<Explained>)[]; meaning: boolean }> {
    const q = text.trim().slice(0, 500);
    if (!q) return { hits: [], meaning: false };
    const { userId } = who(reader);
    const scope = o.filter
      ? sql`${visibleTo(reader)} and ${filterSql(o.filter, userId)}`
      : visibleTo(reader);
    const [any] = await db
      .select({ id: wikiPage.id })
      .from(wikiPage)
      .where(and(visibleTo(reader), ne(wikiPage.status, "archived")))
      .limit(1);
    if (!any) return { hits: [], meaning: false };
    let qv: number[] | undefined;
    if (deps.embedder)
      try {
        qv = await embedQuery(deps.embedder, q, QUERY_EMBED_MS);
      } catch {
        /* keyword search only */
      }
    const words = [
      ...new Set(
        strip(q)
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 1),
      ),
    ].slice(0, 20);
    // A short query is a search: every word must match. A longer one is a whole message: any word may match and the rank orders them.
    const terms = words.filter((w) => w.length > 2 && !STOP.has(w));
    const tsq =
      terms.length > 3
        ? sql`to_tsquery('simple', ${terms.join(" | ")})`
        : sql`websearch_to_tsquery('simple', f_unaccent(${q}))`;
    const visible = scope;
    const vector = qv ? vec(qv) : null;
    const wordArray = words.length
      ? sql`array[${sql.join(
          words.map((w) => sql`${w}`),
          sql`, `,
        )}]::text[]`
      : sql`array[]::text[]`;
    const doc = sql`to_tsvector('simple', f_unaccent(wiki_page.title || ' ' || wiki_page.howto || ' ' || wiki_page.content))`;
    const extra = o.explain
      ? sql`, f.kw, f.tg, f.vc, wiki_page.id, wiki_page.updated_at as "updatedAt",
          array(select t from unnest(wiki_page.tags) t where t = any(${wordArray})) as "matchedTags",
          case when f.vc then (select c.text from wiki_chunk c where c.page_id = wiki_page.id and c.embedding is not null
              order by c.embedding <=> ${vector}::vector limit 1)
            else ts_headline('simple', wiki_page.content, qq.q, ${PASSAGE}::text) end as passage`
      : sql``;
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set local hnsw.iterative_scan = strict_order`); // the visibility filter is applied after the index scan
      const { rows } = await tx.execute(sql`
        with qq as (select ${tsq} as q),
          kw as (select wiki_page.id, row_number() over (order by ts_rank(${doc}, qq.q) desc) as r
            from wiki_page, qq where ${visible} and wiki_page.status <> 'archived' and ${doc} @@ qq.q limit ${CANDIDATES}),
          tg as (select wiki_page.id, row_number() over (order by wiki_page.score desc) as r
            from wiki_page where ${words.length ? sql`wiki_page.tags && ${wordArray}` : sql`false`}
              and ${visible} and wiki_page.status <> 'archived' limit ${CANDIDATES}),
          near as (select c.page_id, c.embedding <=> ${vector}::vector as d
            from wiki_chunk c join wiki_page on wiki_page.id = c.page_id
            where ${qv ? sql`true` : sql`false`} and c.embedding is not null and ${visible} and wiki_page.status <> 'archived'
              and (c.embedding <=> ${vector}::vector) <= ${MAX_DISTANCE}
            order by c.embedding <=> ${vector}::vector limit ${CANDIDATES * 2}),
          vc as (select page_id as id, row_number() over (order by min(d)) as r from near group by page_id),
          fused as (select id, sum(1.0 / (${RRF_K} + r)) as s, bool_or(src = 'kw') as kw, bool_or(src = 'tg') as tg, bool_or(src = 'vc') as vc
            from (select id, r, 'kw' as src from kw union all select id, r, 'tg' from tg union all select id, r, 'vc' from vc) x group by id)
        select wiki_page.slug, wiki_page.title, wiki_page.type, wiki_page.howto, wiki_page.tags, wiki_page.score, wiki_page.status,
          case when wiki_page.owner_user_id = ${userId} then 'own' else 'shared' end as access,
          case when wiki_page.owner_user_id = ${userId} then null else u.name end as "ownerName" ${extra}
        from fused f join wiki_page on wiki_page.id = f.id join "user" u on u.id = wiki_page.owner_user_id, qq
        order by f.s * (0.5 + wiki_page.score / 100.0) desc limit ${k}`);
      return rows as unknown as (Omit<WikiHit, "neighbors"> & {
        kw?: boolean;
        tg?: boolean;
        vc?: boolean;
        id?: string;
        updatedAt?: Date;
        matchedTags?: string[];
        passage?: string;
      })[];
    });
    if (!rows.length) return { hits: [], meaning: Boolean(qv) };
    const edges = await edgesAround(
      reader,
      rows.map((r) => r.slug),
    );
    const hits = rows.map((r) => {
      const { kw, tg: _tg, vc, matchedTags, passage, updatedAt, id, ...hit } = r;
      return {
        ...hit,
        neighbors: edges
          .flatMap((e): WikiNeighbor[] =>
            e.from === r.slug
              ? [{ relation: e.relation, direction: "out", slug: e.to, title: e.toTitle }]
              : e.to === r.slug
                ? [{ relation: e.relation, direction: "in", slug: e.from, title: e.fromTitle }]
                : [],
          )
          .slice(0, NEIGHBORS_PER_HIT),
        ...(o.explain && {
          id: id!,
          updatedAt: new Date(updatedAt!).toISOString(),
          why: {
            keyword: Boolean(kw),
            tags: matchedTags ?? [],
            meaning: Boolean(vc),
            passage: (passage ?? "").slice(0, 600),
          },
        }),
      };
    });
    return { hits, meaning: Boolean(qv) };
  }

  async function search(reader: WikiReader, text: string, k = 8): Promise<WikiHit[]> {
    return (await rank(reader, text, k)).hits;
  }

  /** The search of the Wiki page: filtered, with the reason each item matched. `meaning` tells whether search by meaning was available. */
  async function explore(
    reader: WikiReader,
    text: string,
    filter: WikiFilter = {},
    k = 50,
  ): Promise<{ hits: WikiHitExplained[]; meaning: boolean }> {
    const r = await rank(reader, text, k, { filter, explain: true });
    return { hits: r.hits as WikiHitExplained[], meaning: r.meaning };
  }

  /**
   * A change to a page another active member shared. One open suggestion per author and page: a new one replaces it. The owner is told;
   * nothing changes until they accept it.
   */
  async function suggest(
    reader: string,
    slug: string,
    v: {
      content: string;
      title?: string | undefined;
      howto?: string | undefined;
      tags?: readonly string[] | undefined;
      reason?: string | undefined;
    },
    author: { by: "user" } | { by: "bot"; botId: string },
  ) {
    const r = await read(reader, slug);
    if (!r || r.access !== "shared") throw new WikiError("NOT_FOUND");
    const p = r.page;
    const c: Content = {
      title: (v.title ?? p.title).trim(),
      howto: (v.howto ?? p.howto).trim(),
      content: v.content.trim(),
      tags: wikiTags(v.tags ?? p.tags),
      status: "current",
    };
    check(c, author);
    const reason = (v.reason ?? "").trim().slice(0, 500);
    if (looksSecret(reason) || (author.by === "bot" && unsafeMemory(reason)))
      throw new WikiError(looksSecret(reason) ? "SECRET_REJECTED" : "UNSAFE");
    const fields = {
      title: c.title,
      howto: c.howto,
      content: c.content,
      tags: c.tags,
      reason,
      baseVersion: p.version,
      botId: author.by === "bot" ? author.botId : null,
      createdAt: new Date(),
    };
    const [row] = await db
      .insert(wikiSuggestion)
      .values({ pageId: p.id, pageOwnerUserId: p.ownerUserId, authorUserId: reader, ...fields })
      .onConflictDoUpdate({
        target: [wikiSuggestion.pageId, wikiSuggestion.authorUserId],
        targetWhere: sql`${wikiSuggestion.status} = 'open'`,
        set: fields,
      })
      .returning();
    await raiseAttention(db, p.ownerUserId, {
      title: `Suggested change to the wiki page “${p.title}”`,
      detail: reason || "Another member suggested a new text for a page you shared.",
      nextAction: "Accept or reject it in the Wiki.",
      resultLink: pageLink(p.slug),
      source: "bot",
      sourceKey: `wiki-suggestion:${p.id}`,
    }).catch(() => {});
    return { suggestion: row!, page: { slug: p.slug, title: p.title, ownerName: r.ownerName } };
  }

  /** Open suggestions for the user's pages (with the current text to compare), and the user's own suggestions. */
  async function suggestions(owner: string) {
    const incoming = await db
      .select({
        id: wikiSuggestion.id,
        slug: wikiPage.slug,
        pageTitle: wikiPage.title,
        currentContent: wikiPage.content,
        pageVersion: wikiPage.version,
        title: wikiSuggestion.title,
        howto: wikiSuggestion.howto,
        tags: wikiSuggestion.tags,
        content: wikiSuggestion.content,
        reason: wikiSuggestion.reason,
        baseVersion: wikiSuggestion.baseVersion,
        authorName: user.name,
        createdAt: wikiSuggestion.createdAt,
      })
      .from(wikiSuggestion)
      .innerJoin(wikiPage, eq(wikiPage.id, wikiSuggestion.pageId))
      .innerJoin(user, eq(user.id, wikiSuggestion.authorUserId))
      .where(
        and(
          eq(wikiSuggestion.pageOwnerUserId, owner),
          eq(wikiPage.ownerUserId, owner),
          eq(wikiSuggestion.status, "open"),
        ),
      )
      .orderBy(desc(wikiSuggestion.createdAt))
      .limit(100);
    const outgoing = await db
      .select({
        id: wikiSuggestion.id,
        slug: wikiPage.slug,
        pageTitle: wikiPage.title,
        status: wikiSuggestion.status,
        reason: wikiSuggestion.reason,
        createdAt: wikiSuggestion.createdAt,
        decidedAt: wikiSuggestion.decidedAt,
      })
      .from(wikiSuggestion)
      .innerJoin(wikiPage, eq(wikiPage.id, wikiSuggestion.pageId))
      .where(eq(wikiSuggestion.authorUserId, owner))
      .orderBy(desc(wikiSuggestion.createdAt))
      .limit(50);
    return { incoming, outgoing };
  }

  /** The page owner accepts (a new version, refused when the page changed after the suggestion was written) or rejects it. */
  async function decide(owner: string, id: string, decision: "accept" | "reject") {
    const [s] = await db
      .select({ s: wikiSuggestion, slug: wikiPage.slug })
      .from(wikiSuggestion)
      .innerJoin(wikiPage, eq(wikiPage.id, wikiSuggestion.pageId))
      .where(
        and(
          eq(wikiSuggestion.id, id),
          eq(wikiSuggestion.pageOwnerUserId, owner),
          eq(wikiPage.ownerUserId, owner),
          eq(wikiSuggestion.status, "open"),
        ),
      );
    if (!s) throw new WikiError("NOT_FOUND");
    const close = (status: "accepted" | "rejected" | "outdated") =>
      db
        .update(wikiSuggestion)
        .set({ status, decidedAt: new Date() })
        .where(eq(wikiSuggestion.id, id));
    if (decision === "reject") {
      await close("rejected");
      return { status: "rejected" as const };
    }
    try {
      const r = await save(
        owner,
        s.slug,
        { by: "user" },
        () => ({
          title: s.s.title,
          howto: s.s.howto,
          tags: s.s.tags,
          content: s.s.content,
          status: "current",
        }),
        s.s.baseVersion,
      );
      await close("accepted");
      return { status: "accepted" as const, version: r.page.version };
    } catch (e) {
      if (e instanceof WikiError && e.code === "CONFLICT") await close("outdated");
      throw e;
    }
  }

  async function withdraw(author: string, id: string) {
    const [row] = await db
      .update(wikiSuggestion)
      .set({ status: "withdrawn", decidedAt: new Date() })
      .where(
        and(
          eq(wikiSuggestion.id, id),
          eq(wikiSuggestion.authorUserId, author),
          eq(wikiSuggestion.status, "open"),
        ),
      )
      .returning({ id: wikiSuggestion.id });
    if (!row) throw new WikiError("NOT_FOUND");
  }

  /**
   * What needs a person's (or the review job's) attention: links to pages that do not exist, pages nothing links to and that link to
   * nothing, pages not saved for 90 days, stale pages, pages with no evidence, and open suggestions.
   */
  async function checks(owner: string) {
    const pages = await db
      .select({
        id: wikiPage.id,
        slug: wikiPage.slug,
        title: wikiPage.title,
        status: wikiPage.status,
        tags: wikiPage.tags,
        updatedAt: wikiPage.updatedAt,
      })
      .from(wikiPage)
      .where(and(eq(wikiPage.ownerUserId, owner), ne(wikiPage.status, "archived")));
    const links = await db
      .select({ slug: wikiPage.slug, target: wikiLink.toSlug })
      .from(wikiLink)
      .innerJoin(wikiPage, eq(wikiPage.id, wikiLink.fromPageId))
      .where(and(eq(wikiPage.ownerUserId, owner), ne(wikiPage.status, "archived")));
    const targets = [...new Set(links.map((l) => l.target))];
    const existing = new Set(
      targets.length
        ? (
            await db
              .select({ slug: wikiPage.slug })
              .from(wikiPage)
              .where(
                and(
                  inArray(wikiPage.slug, targets),
                  visibleTo(owner),
                  ne(wikiPage.status, "archived"),
                ),
              )
          ).map((r) => r.slug)
        : [],
    );
    const sourced = new Set(
      (
        await db
          .selectDistinct({ pageId: wikiSource.pageId })
          .from(wikiSource)
          .where(eq(wikiSource.ownerUserId, owner))
      ).map((r) => r.pageId),
    );
    const linked = new Set(
      links.flatMap((l) => (existing.has(l.target) ? [l.slug, l.target] : [])),
    );
    const old = Date.now() - OLD_DAYS * 86_400_000;
    const brief = (p: (typeof pages)[number]) => ({ slug: p.slug, title: p.title });
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(wikiSuggestion)
      .where(and(eq(wikiSuggestion.pageOwnerUserId, owner), eq(wikiSuggestion.status, "open")));
    return {
      brokenLinks: links.filter((l) => !existing.has(l.target)),
      unlinked: pages.filter((p) => !linked.has(p.slug)).map(brief),
      old: pages.filter((p) => p.status === "current" && p.updatedAt.getTime() < old).map(brief),
      stale: pages.filter((p) => p.status === "stale").map(brief),
      // A Drive item is backed by its document, not by a source row.
      unsourced: pages.filter((p) => !sourced.has(p.id) && !p.tags.includes("drive")).map(brief),
      openSuggestions: n,
    };
  }

  /**
   * Server tick: cuts pages saved since the last run into chunks, then embeds chunks that have no embedding yet. A page saved again
   * meanwhile loses its chunks in the same transaction as the save, so a stale chunk is never written or kept.
   */
  async function tick() {
    if (busy || !deps.embedder) return;
    busy = true;
    try {
      const bare = await db
        .select({
          id: wikiPage.id,
          owner: wikiPage.ownerUserId,
          version: wikiPage.version,
          content: wikiPage.content,
        })
        .from(wikiPage)
        .where(
          and(
            ne(wikiPage.status, "archived"),
            sql`not exists (select 1 from wiki_chunk c where c.page_id = ${wikiPage.id})`,
          ),
        )
        .orderBy(wikiPage.updatedAt)
        .limit(PAGES_PER_TICK);
      for (const p of bare)
        await db.transaction(async (tx) => {
          const [now] = await tx
            .select({ version: wikiPage.version })
            .from(wikiPage)
            .where(eq(wikiPage.id, p.id))
            .for("share");
          if (!now || now.version !== p.version) return;
          const pieces = chunkText(p.content);
          if (pieces.length)
            await tx
              .insert(wikiChunk)
              .values(
                pieces.map((text, ord) => ({ pageId: p.id, ownerUserId: p.owner, ord, text })),
              )
              .onConflictDoNothing();
        });
      const todo = await db
        .select({
          id: wikiChunk.id,
          text: wikiChunk.text,
          title: wikiPage.title,
          howto: wikiPage.howto,
          tags: wikiPage.tags,
        })
        .from(wikiChunk)
        .innerJoin(wikiPage, eq(wikiPage.id, wikiChunk.pageId))
        .where(and(sql`${wikiChunk.embedding} is null`, ne(wikiPage.status, "archived")))
        .orderBy(wikiChunk.createdAt)
        .limit(BACKFILL);
      if (!todo.length) return;
      const vs = await deps.embedder.embed(
        todo.map((c) =>
          `${c.title}\n${c.howto}\n${c.tags.join(" ")}\n${c.text}`.slice(0, EMBED_CHARS),
        ),
        "passage",
      );
      for (const [i, c] of todo.entries())
        if (vs[i])
          await db.update(wikiChunk).set({ embedding: vs[i]! }).where(eq(wikiChunk.id, c.id));
    } finally {
      busy = false;
    }
  }

  /**
   * Server tick: compares each page's evidence with what it is now, a bounded number per run. A changed or deleted task, document or
   * artifact marks the page stale (a new version by `system`) and tells the owner once per page until they deal with it.
   */
  async function checkSources(now = new Date()) {
    if (checking) return;
    checking = true;
    try {
      const due = await db
        .select({
          s: wikiSource,
          slug: wikiPage.slug,
          title: wikiPage.title,
          status: wikiPage.status,
        })
        .from(wikiSource)
        .innerJoin(wikiPage, eq(wikiPage.id, wikiSource.pageId))
        .where(
          and(
            eq(wikiSource.status, "current"),
            ne(wikiSource.kind, "url"),
            lt(wikiSource.checkedAt, new Date(now.getTime() - CHECK_EVERY_MS)),
            ne(wikiPage.status, "archived"),
          ),
        )
        .orderBy(wikiSource.checkedAt)
        .limit(CHECKS_PER_TICK);
      for (const d of due) {
        const cur = await lookup(d.s.ownerUserId, d.s.kind, d.s.ref);
        const status = !cur ? "gone" : cur.version !== d.s.seenVersion ? "changed" : "current";
        await db
          .update(wikiSource)
          .set({ status, checkedAt: now })
          .where(eq(wikiSource.id, d.s.id));
        if (status === "current") continue;
        if (d.status === "current")
          await setStatus(d.s.ownerUserId, d.slug, "stale", { by: "system" }).catch(() => {});
        await raiseAttention(db, d.s.ownerUserId, {
          title: `The wiki page “${d.title}” may be out of date`,
          detail: `Its source “${d.s.label}” (${d.s.kind}) ${status === "gone" ? "is gone" : "changed"} since the page was saved.`,
          nextAction: "Check the page, then save it or ask a bot to update it.",
          resultLink: pageLink(d.slug),
          source: "bot",
          sourceKey: `wiki-stale:${d.s.pageId}`,
        }).catch(() => {});
      }
    } finally {
      checking = false;
    }
  }

  return {
    write,
    remember,
    patch,
    addLink,
    confirm,
    setStatus,
    setMeta,
    restore,
    read,
    byIds,
    neighbors,
    history,
    sources,
    linkSources,
    list,
    listShared,
    search,
    explore,
    suggest,
    suggestions,
    decide,
    withdraw,
    checks,
    tick,
    checkSources,
  };
}
export type Wiki = ReturnType<typeof createWiki>;
