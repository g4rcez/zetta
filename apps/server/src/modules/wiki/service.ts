import type { Database } from "@zetta/db";
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "@zetta/db/query";
import { artifact } from "@zetta/db/schema/artifacts";
import { user } from "@zetta/db/schema/auth";
import { knowledgeDoc } from "@zetta/db/schema/knowledge";
import { task } from "@zetta/db/schema/tasks";
import {
  WIKI_PAGE_TYPES,
  wikiPage,
  wikiRevision,
  wikiSource,
  wikiSuggestion,
  type WikiPageStatus,
  type WikiPageType,
  type WikiScope,
  type WikiSourceKind,
} from "@zetta/db/schema/wiki";
import { raiseAttention } from "../features/attention";
import { unsafeMemory } from "../features/knowledge";
import { looksSecret } from "../features/safety";
import { embedQuery, type Embedder } from "../knowledge/embed";

export type WikiCode =
  | "SECRET_REJECTED"
  | "UNSAFE"
  | "CONFLICT"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "FULL"
  | "INVALID"
  | "SLUG_TAKEN";
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
export type WikiPage = typeof wikiPage.$inferSelect;
/** own: the asker's page. shared: another active member published it; the asker reads it and can only suggest changes. */
export type WikiAccess = "own" | "shared";
export type WikiHit = {
  slug: string;
  title: string;
  type: WikiPageType;
  summary: string;
  status: WikiPageStatus;
  access: WikiAccess;
  ownerName: string | null;
};
type Content = Pick<WikiPage, "title" | "type" | "summary" | "body" | "status">;

export const WIKI_LIMITS = {
  slug: 80,
  title: 160,
  summary: 300,
  body: 20_000,
  pages: 2000,
  sources: 12,
} as const;
const BACKFILL = 16,
  EMBED_CHARS = 2000;
// Same model and cut-offs as company knowledge (see knowledge/service.ts); re-measure on a model change.
const QUERY_EMBED_MS = 2500,
  MAX_DISTANCE = 0.2,
  CANDIDATES = 20,
  RRF_K = 60;
const CHECK_EVERY_MS = 5 * 60_000,
  CHECKS_PER_TICK = 50,
  OLD_DAYS = 90;

const vec = (v: number[]) => `[${v.join(",")}]`;
/** "Acme – Billing API" -> "acme-billing-api". Empty when nothing usable is left. */
export const wikiSlug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WIKI_LIMITS.slug)
    .replace(/-+$/, "");
const same = (a: Content, b: Content) =>
  a.title === b.title &&
  a.type === b.type &&
  a.summary === b.summary &&
  a.body === b.body &&
  a.status === b.status;
const pageLink = (slug: string) => `/studio/wiki?page=${encodeURIComponent(slug)}`;
/** A shared page counts only while its owner is an active member: removing a member withdraws what they published. */
const ownerActive = sql`exists (select 1 from membership m where m.user_id = ${wikiPage.ownerUserId} and m.status = 'active')`;
const visibleTo = (reader: string) =>
  or(
    eq(wikiPage.ownerUserId, reader),
    and(eq(wikiPage.scope, "installation"), ne(wikiPage.status, "archived"), ownerActive),
  );

/**
 * The operator's wiki (see schema/wiki.ts). A page belongs to one user; the owner may publish it to every active member, who read it and
 * suggest changes but never write it. Writes are serialised per page, keep a revision of every version, and refuse secrets; a bot's text
 * is also screened for injection phrasing, because pages are replayed into prompts. Pages link to their evidence (`wiki_source`) and are
 * marked stale when it changes.
 */
export function createWiki(db: Database, deps: { embedder?: Embedder } = {}) {
  let busy = false,
    checking = false;

  function check(c: Content, author: WikiAuthor) {
    if (!c.title.trim() || !c.body.trim() || !WIKI_PAGE_TYPES.includes(c.type))
      throw new WikiError("INVALID");
    if (
      c.title.length > WIKI_LIMITS.title ||
      c.summary.length > WIKI_LIMITS.summary ||
      c.body.length > WIKI_LIMITS.body
    )
      throw new WikiError("INVALID");
    const text = `${c.title}\n${c.summary}\n${c.body}`;
    if (looksSecret(text)) throw new WikiError("SECRET_REJECTED");
    if (author.by === "bot" && unsafeMemory(text)) throw new WikiError("UNSAFE");
  }

  /**
   * The one write path: `change` gets the current page (undefined when new) inside the transaction and returns the next content.
   * `expectedVersion` makes it fail with CONFLICT when someone saved in between. An unchanged page is not saved again.
   */
  async function save(
    owner: string,
    slug: string,
    author: WikiAuthor,
    change: (cur: WikiPage | undefined) => Content,
    expectedVersion?: number,
  ) {
    const key = wikiSlug(slug);
    if (!key) throw new WikiError("INVALID");
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wiki:${owner}:${key}`}))`);
      const [cur] = await tx
        .select()
        .from(wikiPage)
        .where(and(eq(wikiPage.ownerUserId, owner), eq(wikiPage.slug, key)));
      if (expectedVersion !== undefined && (cur?.version ?? 0) !== expectedVersion)
        throw new WikiError("CONFLICT");
      const next = change(cur);
      const c: Content = {
        title: next.title.trim(),
        type: next.type,
        summary: next.summary.trim(),
        body: next.body.trim(),
        status: next.status,
      };
      check(c, author);
      if (cur && same(cur, c)) return { page: cur, created: false, changed: false };
      const botId = author.by === "bot" ? author.botId : null;
      const by = { updatedBy: author.by, updatedByBotId: botId, updatedAt: new Date() };
      let page: WikiPage;
      if (cur) {
        [page] = (await tx
          .update(wikiPage)
          .set({ ...c, ...by, version: cur.version + 1, embedding: null })
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
          .values({ ownerUserId: owner, slug: key, ...c, ...by })
          .returning()) as [WikiPage];
      }
      await tx.insert(wikiRevision).values({
        pageId: page.id,
        ownerUserId: owner,
        version: page.version,
        ...c,
        author: author.by,
        botId,
        conversationId: author.by === "bot" ? (author.conversationId ?? null) : null,
      });
      return { page, created: !cur, changed: true };
    });
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
   * Creates the page or replaces its content. Type and summary keep their old values when not given; a full save makes it current again.
   * `sources` replaces the page's evidence; without it the kept evidence is measured again. A page shared by another member is not
   * written here: the asker's own page with the same slug would hide it, so the caller suggests a change instead.
   */
  async function write(
    owner: string,
    v: {
      slug: string;
      title: string;
      body: string;
      type?: WikiPageType;
      summary?: string;
      status?: WikiPageStatus;
      expectedVersion?: number;
      sources?: readonly string[];
    },
    author: WikiAuthor,
  ) {
    const r = await save(
      owner,
      v.slug,
      author,
      (cur) => ({
        title: v.title,
        body: v.body,
        type: v.type ?? cur?.type ?? "note",
        summary: v.summary ?? cur?.summary ?? "",
        status: v.status ?? "current",
      }),
      v.expectedVersion,
    );
    const s = v.sources
      ? await linkSources(owner, r.page.id, v.sources, "replace")
      : (await rebaseline(owner, r.page.id), { linked: 0, skipped: [] as string[] });
    return { ...r, skippedSources: s.skipped };
  }

  /** Replaces one unique span of the body; a page that was marked stale stays stale until someone saves it in full. */
  function patch(owner: string, slug: string, match: string, content: string, author: WikiAuthor) {
    return save(owner, slug, author, (cur) => {
      if (!cur || cur.status === "archived") throw new WikiError("NOT_FOUND");
      const hits = cur.body.split(match).length - 1;
      if (!match || hits === 0) throw new WikiError("NOT_FOUND");
      if (hits > 1) throw new WikiError("AMBIGUOUS");
      return { ...cur, body: cur.body.replace(match, () => content) };
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
      return { ...cur, status };
    });
    if (status === "current" && r.changed && author.by !== "system")
      await rebaseline(owner, r.page.id); // a person confirmed it again
    return r;
  }

  /** Publishing is a person's choice (routes only, never a bot tool). It is not a new version: the text does not change. */
  async function setScope(owner: string, slug: string, scope: WikiScope) {
    try {
      const [page] = await db
        .update(wikiPage)
        .set({ scope })
        .where(and(eq(wikiPage.ownerUserId, owner), eq(wikiPage.slug, wikiSlug(slug))))
        .returning();
      if (!page) throw new WikiError("NOT_FOUND");
      return page;
    } catch (e) {
      if (
        (e as { code?: string; cause?: { code?: string } }).code === "23505" ||
        (e as { cause?: { code?: string } }).cause?.code === "23505"
      )
        throw new WikiError("SLUG_TAKEN");
      throw e;
    }
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
      type: old.type,
      summary: old.summary,
      body: old.body,
      status: old.status,
    }));
  }

  /** The reader's own page with that slug, else a page another active member shared. */
  async function read(reader: string, slug: string) {
    const key = wikiSlug(slug);
    if (!key) return undefined;
    const rows = await db
      .select({ page: wikiPage, ownerName: user.name })
      .from(wikiPage)
      .innerJoin(user, eq(user.id, wikiPage.ownerUserId))
      .where(and(eq(wikiPage.slug, key), visibleTo(reader)));
    const own = rows.find((r) => r.page.ownerUserId === reader);
    const hit = own ?? rows[0];
    if (!hit) return undefined;
    const access: WikiAccess = own ? "own" : "shared";
    const linkedFrom = await db
      .select({ slug: wikiPage.slug, title: wikiPage.title })
      .from(wikiPage)
      .where(
        and(
          visibleTo(reader),
          ne(wikiPage.status, "archived"),
          ne(wikiPage.id, hit.page.id),
          sql`strpos(${wikiPage.body}, ${`[[${key}]]`}) > 0`,
        ),
      )
      .orderBy(wikiPage.title)
      .limit(50);
    return {
      page: hit.page,
      access,
      ownerName: access === "own" ? null : hit.ownerName,
      linkedFrom,
    };
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

  async function list(owner: string) {
    return db
      .select({
        slug: wikiPage.slug,
        title: wikiPage.title,
        type: wikiPage.type,
        summary: wikiPage.summary,
        status: wikiPage.status,
        scope: wikiPage.scope,
        version: wikiPage.version,
        updatedBy: wikiPage.updatedBy,
        updatedAt: wikiPage.updatedAt,
      })
      .from(wikiPage)
      .where(eq(wikiPage.ownerUserId, owner))
      .orderBy(desc(wikiPage.updatedAt))
      .limit(WIKI_LIMITS.pages);
  }

  /** Pages other active members shared, newest first. */
  async function listShared(reader: string) {
    return db
      .select({
        slug: wikiPage.slug,
        title: wikiPage.title,
        type: wikiPage.type,
        summary: wikiPage.summary,
        status: wikiPage.status,
        ownerName: user.name,
        updatedAt: wikiPage.updatedAt,
      })
      .from(wikiPage)
      .innerJoin(user, eq(user.id, wikiPage.ownerUserId))
      .where(
        and(
          ne(wikiPage.ownerUserId, reader),
          eq(wikiPage.scope, "installation"),
          ne(wikiPage.status, "archived"),
          ownerActive,
        ),
      )
      .orderBy(desc(wikiPage.updatedAt))
      .limit(500);
  }

  /** The pages the reader may see (own, and shared by active members) that best fit `text`: keyword and vector rank fused, archived left out. */
  async function search(reader: string, text: string, k = 8): Promise<WikiHit[]> {
    const q = text.trim().slice(0, 500);
    if (!q) return [];
    const [any] = await db
      .select({ id: wikiPage.id })
      .from(wikiPage)
      .where(and(visibleTo(reader), ne(wikiPage.status, "archived")))
      .limit(1);
    if (!any) return [];
    let qv: number[] | undefined;
    if (deps.embedder)
      try {
        qv = await embedQuery(deps.embedder, q, QUERY_EMBED_MS);
      } catch {
        /* keyword search only */
      }
    const visible = `(p.owner_user_id = $2 or (p.scope = 'installation' and exists (select 1 from membership m where m.user_id = p.owner_user_id and m.status = 'active')))`;
    const client = await db.$client.connect();
    try {
      await client.query("begin");
      await client.query("set local hnsw.iterative_scan = strict_order"); // the visibility filter is applied after the index scan
      const { rows } = await client.query(
        `with q as (select websearch_to_tsquery('simple', f_unaccent($1)) as q),
          kw as (select p.id, row_number() over (order by ts_rank(to_tsvector('simple', f_unaccent(p.title || ' ' || p.summary || ' ' || p.body)), q.q) desc) as r
            from wiki_page p, q where ${visible} and p.status <> 'archived' and to_tsvector('simple', f_unaccent(p.title || ' ' || p.summary || ' ' || p.body)) @@ q.q limit ${CANDIDATES}),
          vc as (select p.id, row_number() over (order by p.embedding <=> $3::vector) as r
            from wiki_page p where $3::vector is not null and ${visible} and p.status <> 'archived' and p.embedding is not null and (p.embedding <=> $3::vector) <= ${MAX_DISTANCE}
            order by p.embedding <=> $3::vector limit ${CANDIDATES}),
          fused as (select id, sum(1.0 / (${RRF_K} + r)) as score from (select * from kw union all select * from vc) s group by id)
         select p.slug, p.title, p.type, p.summary, p.status, case when p.owner_user_id = $2 then 'own' else 'shared' end as access,
           case when p.owner_user_id = $2 then null else u.name end as "ownerName"
         from fused f join wiki_page p on p.id = f.id join "user" u on u.id = p.owner_user_id order by f.score desc limit $4`,
        [q, reader, qv ? vec(qv) : null, k],
      );
      await client.query("commit");
      return rows as WikiHit[];
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * A change to a page another active member shared. One open suggestion per author and page: a new one replaces it. The owner is told;
   * nothing changes until they accept it.
   */
  async function suggest(
    reader: string,
    slug: string,
    v: { body: string; title?: string; summary?: string; type?: WikiPageType; reason?: string },
    author: { by: "user" } | { by: "bot"; botId: string },
  ) {
    const r = await read(reader, slug);
    if (!r || r.access !== "shared") throw new WikiError("NOT_FOUND");
    const p = r.page;
    const c: Content = {
      title: (v.title ?? p.title).trim(),
      type: v.type ?? p.type,
      summary: (v.summary ?? p.summary).trim(),
      body: v.body.trim(),
      status: "current",
    };
    check(c, author);
    const reason = (v.reason ?? "").trim().slice(0, 500);
    if (looksSecret(reason) || (author.by === "bot" && unsafeMemory(reason)))
      throw new WikiError(looksSecret(reason) ? "SECRET_REJECTED" : "UNSAFE");
    const fields = {
      title: c.title,
      type: c.type,
      summary: c.summary,
      body: c.body,
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
      nextAction: "Accept or reject it in Studio > Wiki.",
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
        currentBody: wikiPage.body,
        pageVersion: wikiPage.version,
        title: wikiSuggestion.title,
        type: wikiSuggestion.type,
        summary: wikiSuggestion.summary,
        body: wikiSuggestion.body,
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
          type: s.s.type,
          summary: s.s.summary,
          body: s.s.body,
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
        updatedAt: wikiPage.updatedAt,
      })
      .from(wikiPage)
      .where(and(eq(wikiPage.ownerUserId, owner), ne(wikiPage.status, "archived")));
    const links = (
      await db.$client.query(
        `select p.slug, m[1] as target from wiki_page p, regexp_matches(p.body, '\\[\\[([a-z0-9-]+)\\]\\]', 'g') m where p.owner_user_id = $1 and p.status <> 'archived'`,
        [owner],
      )
    ).rows as { slug: string; target: string }[];
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
      unsourced: pages.filter((p) => !sourced.has(p.id)).map(brief),
      openSuggestions: n,
    };
  }

  /** Server tick: embeds pages saved since the last run. A page saved again meanwhile keeps its null and is embedded next time. */
  async function tick() {
    if (busy || !deps.embedder) return;
    busy = true;
    try {
      const bare = await db
        .select({
          id: wikiPage.id,
          version: wikiPage.version,
          title: wikiPage.title,
          summary: wikiPage.summary,
          body: wikiPage.body,
        })
        .from(wikiPage)
        .where(and(isNull(wikiPage.embedding), ne(wikiPage.status, "archived")))
        .orderBy(wikiPage.updatedAt)
        .limit(BACKFILL);
      if (!bare.length) return;
      const vs = await deps.embedder.embed(
        bare.map((p) => `${p.title}\n${p.summary}\n${p.body}`.slice(0, EMBED_CHARS)),
        "passage",
      );
      for (const [i, p] of bare.entries())
        if (vs[i])
          await db
            .update(wikiPage)
            .set({ embedding: vs[i]! })
            .where(and(eq(wikiPage.id, p.id), eq(wikiPage.version, p.version)));
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
    patch,
    setStatus,
    setScope,
    restore,
    read,
    history,
    sources,
    linkSources,
    list,
    listShared,
    search,
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
