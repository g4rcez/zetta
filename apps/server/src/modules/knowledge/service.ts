import type { Database } from "@zetta/db";
import { and, eq, inArray, lte, ne, sql } from "@zetta/db/query";
import { message } from "@zetta/db/schema/chat";
import { knowledgeChunk, knowledgeDoc, knowledgeSource } from "@zetta/db/schema/knowledge";
import { raiseAttention } from "../features/attention";
import { issueBackgroundActor, type ActiveActor, type MembershipLookup } from "../identity/access";
import * as realDrive from "../integrations/plugins/google/drive-index";
import { PluginError, type PluginContext } from "../integrations/plugins/registry";
import { chunkText } from "./chunk";
import { embedQuery, type Embedder } from "./embed";

export type KnowledgePlugins = {
  contextFor: (a: ActiveActor, id: string) => Promise<PluginContext>;
};
/** The slice of Drive the indexer uses. Production uses the Google plugin's own authenticated calls; tests pass a fake. */
export type Drive = typeof realDrive;

const PROVIDER = "google_drive" as const;
const SYNC_EVERY_MS = 10 * 60_000,
  RETRY_MS = 30 * 60_000,
  SOON_MS = 5_000,
  SOURCES_PER_TICK = 2;
const MAX_FILES_FULL = 5000,
  DOCS_PER_RUN = 20,
  RUN_MS = 60_000,
  READ_CAP = 400_000,
  MAX_CHUNKS = 200,
  BACKFILL = 64;
// Cosine distance cut-off for a vector match. Measured with multilingual-e5-small (q8): related text scores 0.82-0.84 similarity and
// unrelated 0.73-0.82, so 0.80 only removes clear misses; keyword rank and the bot's own judgement do the rest. Re-measure on a model change.
const QUERY_EMBED_MS = 2500,
  MAX_DISTANCE = 0.2,
  CANDIDATES = 20,
  RRF_K = 60;

export type KnowledgeHit = {
  chunkId: string;
  docId: string;
  name: string;
  link: string | null;
  text: string;
};
export type KnowledgeStatus = {
  enabled: boolean;
  status: "idle" | "syncing" | "error" | "needs_auth";
  docs: number;
  pending: number;
  chunks: number;
  lastSyncedAt: string | null;
  lastError: string | null;
};

const count = () => sql<number>`count(*)::int`;
const vec = (v: number[]) => `[${v.join(",")}]`;
const codeOf = (e: unknown) => (e instanceof PluginError ? e.code : "SYNC_FAILED");
const AUTH_CODES = new Set(["NEEDS_AUTH", "NOT_CONNECTED", "SCOPE_MISSING"]);

/**
 * Company knowledge: the user's Drive documents, chunked and embedded into Postgres so a bot can answer from them and cite them.
 *
 * Access is per user. The index is built with that user's own Google token and every read filters on the same `owner_user_id`, so a turn
 * never sees a document its asker's own account could not open. A citation is re-checked against Drive when it is shown.
 */
export function createKnowledge(
  db: Database,
  deps: { plugins: KnowledgePlugins; lookup: MembershipLookup; embedder: Embedder; drive?: Drive },
) {
  const drive = deps.drive ?? realDrive;
  let busy = false;

  const googleCtx = async (a: ActiveActor) => {
    const ctx = await deps.plugins.contextFor(a, "google").catch((e) => {
      throw e instanceof PluginError
        ? e
        : new PluginError(
            "NOT_CONNECTED",
            "Google is not connected. Connect it in Studio > Plugins.",
          );
    });
    drive.needIndexScope(ctx);
    return ctx;
  };

  async function status(a: ActiveActor): Promise<KnowledgeStatus> {
    const [s] = await db
      .select()
      .from(knowledgeSource)
      .where(
        and(eq(knowledgeSource.ownerUserId, a.userId), eq(knowledgeSource.provider, PROVIDER)),
      );
    if (!s)
      return {
        enabled: false,
        status: "idle",
        docs: 0,
        pending: 0,
        chunks: 0,
        lastSyncedAt: null,
        lastError: null,
      };
    const byState = await db
      .select({ state: knowledgeDoc.state, n: count() })
      .from(knowledgeDoc)
      .where(eq(knowledgeDoc.sourceId, s.id))
      .groupBy(knowledgeDoc.state);
    const n = (st: string) => byState.find((r) => r.state === st)?.n ?? 0;
    const [counted] = await db
      .select({ chunks: count() })
      .from(knowledgeChunk)
      .where(eq(knowledgeChunk.ownerUserId, a.userId));
    return {
      enabled: true,
      status: s.status,
      docs: n("indexed"),
      pending: n("pending"),
      chunks: counted?.chunks ?? 0,
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
      lastError: s.lastError,
    };
  }

  /** Turns indexing on for the user's Drive. Fails early (with the plugin's own safe words) when Google is not connected with Drive read access. */
  async function enable(a: ActiveActor) {
    await googleCtx(a);
    await db
      .insert(knowledgeSource)
      .values({ ownerUserId: a.userId, provider: PROVIDER })
      .onConflictDoUpdate({
        target: [knowledgeSource.ownerUserId, knowledgeSource.provider],
        set: { status: "idle", lastError: null, nextSyncAt: new Date() },
      });
    return status(a);
  }

  /** Turns indexing off and deletes every copy of the user's documents (docs and chunks go with the source). */
  async function disable(a: ActiveActor) {
    await db
      .delete(knowledgeSource)
      .where(
        and(eq(knowledgeSource.ownerUserId, a.userId), eq(knowledgeSource.provider, PROVIDER)),
      );
    return status(a);
  }

  const dropChunks = (docIds: string[]) =>
    docIds.length
      ? db.delete(knowledgeChunk).where(inArray(knowledgeChunk.docId, docIds))
      : Promise.resolve();
  async function markRemoved(sourceId: string, externalIds: string[]) {
    if (!externalIds.length) return;
    const gone = await db
      .update(knowledgeDoc)
      .set({ state: "removed", updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeDoc.sourceId, sourceId),
          inArray(knowledgeDoc.externalId, externalIds),
          ne(knowledgeDoc.state, "removed"),
        ),
      )
      .returning({ id: knowledgeDoc.id });
    await dropChunks(gone.map((g) => g.id));
  }

  /** Records what Drive says about these files. A new or changed readable file becomes `pending`; an unchanged one is left alone. */
  async function noteFiles(
    sourceId: string,
    owner: string,
    files: Awaited<ReturnType<Drive["listFiles"]>>["files"],
  ) {
    const readable = files.filter(drive.indexable);
    if (!readable.length) return;
    const have = new Map(
      (
        await db
          .select()
          .from(knowledgeDoc)
          .where(
            and(
              eq(knowledgeDoc.sourceId, sourceId),
              inArray(
                knowledgeDoc.externalId,
                readable.map((f) => f.id),
              ),
            ),
          )
      ).map((d) => [d.externalId, d]),
    );
    for (const f of readable) {
      const old = have.get(f.id);
      const same =
        old && old.version === f.version && (old.state === "indexed" || old.state === "skipped");
      const fields = {
        name: f.name,
        mimeType: f.mimeType,
        webViewLink: f.webViewLink,
        modifiedAt: f.modifiedAt,
        version: f.version,
        updatedAt: new Date(),
      };
      if (same) {
        if (old.name !== f.name || old.webViewLink !== f.webViewLink)
          await db.update(knowledgeDoc).set(fields).where(eq(knowledgeDoc.id, old.id));
        continue;
      }
      await db
        .insert(knowledgeDoc)
        .values({ sourceId, ownerUserId: owner, externalId: f.id, ...fields, state: "pending" })
        .onConflictDoUpdate({
          target: [knowledgeDoc.sourceId, knowledgeDoc.externalId],
          set: { ...fields, state: "pending" },
        });
    }
  }

  /** Phase 1 (cheap): bring the document list up to date, either the whole listing or the change feed since the last run. */
  async function syncMetadata(ctx: PluginContext, s: typeof knowledgeSource.$inferSelect) {
    if (s.pageToken) {
      try {
        for (let token: string | null = s.pageToken, pages = 0; token && pages < 50; pages++) {
          const r = await drive.listChanges(ctx, token);
          await markRemoved(
            s.id,
            r.changes
              .filter((c) => c.removed || (c.file && !drive.indexable(c.file)))
              .map((c) => c.fileId),
          );
          await noteFiles(
            s.id,
            s.ownerUserId,
            r.changes.flatMap((c) => (!c.removed && c.file ? [c.file] : [])),
          );
          if (r.newStart) {
            await db
              .update(knowledgeSource)
              .set({ pageToken: r.newStart })
              .where(eq(knowledgeSource.id, s.id));
            return;
          }
          token = r.next;
          if (token)
            await db
              .update(knowledgeSource)
              .set({ pageToken: token })
              .where(eq(knowledgeSource.id, s.id));
        }
        return;
      } catch (e) {
        if (!(e instanceof PluginError) || e.code !== "GONE") throw e; // the change position expired: list everything again
        await db
          .update(knowledgeSource)
          .set({ pageToken: null })
          .where(eq(knowledgeSource.id, s.id));
      }
    }
    // The cursor is taken BEFORE listing, so a file changed during the listing shows up in the next change feed.
    const start = await drive.startPageToken(ctx);
    const seen = new Set<string>();
    let complete = true;
    for (let token: string | undefined, pages = 0; ; pages++) {
      const r = await drive.listFiles(ctx, token);
      for (const f of r.files) seen.add(f.id);
      await noteFiles(s.id, s.ownerUserId, r.files);
      if (!r.next) break;
      if (seen.size >= MAX_FILES_FULL || pages >= 100) {
        complete = false;
        break;
      }
      token = r.next;
    }
    if (complete) {
      const known = await db
        .select({ externalId: knowledgeDoc.externalId })
        .from(knowledgeDoc)
        .where(and(eq(knowledgeDoc.sourceId, s.id), ne(knowledgeDoc.state, "removed")));
      await markRemoved(
        s.id,
        known.map((k) => k.externalId).filter((id) => !seen.has(id)),
      );
    }
    await db.update(knowledgeSource).set({ pageToken: start }).where(eq(knowledgeSource.id, s.id));
  }

  async function embedAll(texts: string[]): Promise<(number[] | null)[]> {
    try {
      return await deps.embedder.embed(texts, "passage");
    } catch {
      return texts.map(() => null);
    } // keywords still find the chunk; it is embedded later
  }

  /** Phase 2 (costly): read, chunk and embed pending documents, a bounded number per run. Returns how many are still waiting. */
  async function indexPending(ctx: PluginContext, s: typeof knowledgeSource.$inferSelect) {
    const deadline = Date.now() + RUN_MS;
    const pending = await db
      .select()
      .from(knowledgeDoc)
      .where(and(eq(knowledgeDoc.sourceId, s.id), eq(knowledgeDoc.state, "pending")))
      .orderBy(knowledgeDoc.updatedAt)
      .limit(DOCS_PER_RUN);
    for (const d of pending) {
      if (Date.now() > deadline) break;
      let state: "indexed" | "skipped" | "removed" = "indexed";
      let chunks: string[] = [];
      try {
        chunks = chunkText(
          await drive.readText(
            ctx,
            {
              id: d.externalId,
              name: d.name,
              mimeType: d.mimeType,
              version: d.version,
              modifiedAt: d.modifiedAt,
              webViewLink: d.webViewLink,
              size: 0,
            },
            READ_CAP,
          ),
        ).slice(0, MAX_CHUNKS);
        if (!chunks.length) state = "skipped";
      } catch (e) {
        const code = codeOf(e);
        if (AUTH_CODES.has(code)) throw e;
        if (code === "TOO_LARGE" || code === "UNSUPPORTED") state = "skipped";
        else if (code === "NOT_FOUND" || code === "FORBIDDEN" || code === "GONE") state = "removed";
        else continue; // a transient failure: the document stays pending for the next run
      }
      const vectors = chunks.length ? await embedAll(chunks) : [];
      await db.transaction(async (tx) => {
        await tx.delete(knowledgeChunk).where(eq(knowledgeChunk.docId, d.id));
        if (chunks.length && state === "indexed")
          await tx.insert(knowledgeChunk).values(
            chunks.map((text, ord) => ({
              docId: d.id,
              ownerUserId: s.ownerUserId,
              ord,
              text,
              embedding: vectors[ord] ?? null,
            })),
          );
        await tx
          .update(knowledgeDoc)
          .set({ state, updatedAt: new Date() })
          .where(eq(knowledgeDoc.id, d.id));
      });
    }
    // Chunks stored while the model was unavailable.
    const bare = await db
      .select({ id: knowledgeChunk.id, text: knowledgeChunk.text })
      .from(knowledgeChunk)
      .where(
        and(
          eq(knowledgeChunk.ownerUserId, s.ownerUserId),
          sql`${knowledgeChunk.embedding} is null`,
        ),
      )
      .limit(BACKFILL);
    if (bare.length) {
      const vs = await embedAll(bare.map((b) => b.text));
      for (const [i, b] of bare.entries())
        if (vs[i])
          await db
            .update(knowledgeChunk)
            .set({ embedding: vs[i]! })
            .where(eq(knowledgeChunk.id, b.id));
    }
    const [left] = await db
      .select({ n: count() })
      .from(knowledgeDoc)
      .where(and(eq(knowledgeDoc.sourceId, s.id), eq(knowledgeDoc.state, "pending")));
    return left?.n ?? 0;
  }

  /** One sync of one user's source. Errors are recorded as closed codes; a lost sign-in also raises a notification. */
  async function syncUser(a: ActiveActor, now = new Date()) {
    const [s] = await db
      .select()
      .from(knowledgeSource)
      .where(
        and(eq(knowledgeSource.ownerUserId, a.userId), eq(knowledgeSource.provider, PROVIDER)),
      );
    if (!s) throw new PluginError("NOT_ENABLED", "Company knowledge is not turned on.");
    await db.update(knowledgeSource).set({ status: "syncing" }).where(eq(knowledgeSource.id, s.id));
    try {
      const ctx = await googleCtx(a);
      await syncMetadata(ctx, s);
      const left = await indexPending(ctx, s);
      await db
        .update(knowledgeSource)
        .set({
          status: "idle",
          lastError: null,
          lastSyncedAt: now,
          nextSyncAt: new Date(Date.now() + (left ? SOON_MS : SYNC_EVERY_MS)),
        })
        .where(eq(knowledgeSource.id, s.id));
    } catch (e) {
      const code = codeOf(e);
      const auth = AUTH_CODES.has(code);
      await db
        .update(knowledgeSource)
        .set({
          status: auth ? "needs_auth" : "error",
          lastError: code,
          nextSyncAt: new Date(Date.now() + RETRY_MS),
        })
        .where(eq(knowledgeSource.id, s.id));
      if (auth)
        await raiseAttention(db, a.userId, {
          title: "Company knowledge cannot read your Drive",
          detail: e instanceof PluginError ? e.safe : "Google access is missing.",
          nextAction: "Reconnect Google in Studio > Plugins with Drive read access.",
          resultLink: "/studio/plugins?plugin=google",
          source: "manual",
          sourceKey: "knowledge-sync:auth",
        }).catch(() => {});
    }
    return status(a);
  }

  /** Server tick: sources that are due are claimed by moving `next_sync_at` first, a few per tick. */
  async function tick(now = new Date()) {
    if (busy) return;
    busy = true;
    try {
      const due = await db
        .update(knowledgeSource)
        .set({ nextSyncAt: new Date(now.getTime() + RETRY_MS) })
        .where(
          and(
            lte(knowledgeSource.nextSyncAt, now),
            ne(knowledgeSource.status, "syncing"),
            ne(knowledgeSource.status, "needs_auth"),
          ),
        )
        .returning({ ownerUserId: knowledgeSource.ownerUserId });
      for (const { ownerUserId } of due.slice(0, SOURCES_PER_TICK)) {
        const a = await issueBackgroundActor(deps.lookup, ownerUserId);
        if (a) await syncUser(a, now).catch(() => {});
      }
      for (const { ownerUserId } of due.slice(SOURCES_PER_TICK))
        await db
          .update(knowledgeSource)
          .set({ nextSyncAt: now })
          .where(eq(knowledgeSource.ownerUserId, ownerUserId));
    } finally {
      busy = false;
    }
  }

  /**
   * The chunks of the asker's own documents that best answer `text`: keyword rank and vector rank fused (reciprocal rank). A vector match
   * must also be close enough to drop clear misses. Every branch filters on `owner_user_id = userId`.
   */
  async function retrieve(userId: string, text: string, k = 5): Promise<KnowledgeHit[]> {
    const q = text.trim().slice(0, 500);
    if (!q) return [];
    const [any] = await db
      .select({ id: knowledgeChunk.id })
      .from(knowledgeChunk)
      .where(eq(knowledgeChunk.ownerUserId, userId))
      .limit(1);
    if (!any) return [];
    let qv: number[] | undefined;
    try {
      qv = await embedQuery(deps.embedder, q, QUERY_EMBED_MS);
    } catch {
      /* keyword search only */
    }
    const client = await db.$client.connect();
    try {
      await client.query("begin");
      await client.query("set local hnsw.iterative_scan = strict_order"); // the owner filter is applied after the index scan; keep scanning until enough rows pass
      const { rows } = await client.query(
        `with q as (select websearch_to_tsquery('simple', f_unaccent($1)) as q),
          kw as (select c.id, row_number() over (order by ts_rank(to_tsvector('simple', f_unaccent(c.text)), q.q) desc) as r
            from knowledge_chunk c join knowledge_doc d on d.id = c.doc_id, q
            where c.owner_user_id = $2 and d.owner_user_id = $2 and d.state = 'indexed' and to_tsvector('simple', f_unaccent(c.text)) @@ q.q limit ${CANDIDATES}),
          vc as (select c.id, row_number() over (order by c.embedding <=> $3::vector) as r
            from knowledge_chunk c join knowledge_doc d on d.id = c.doc_id
            where $3::vector is not null and c.owner_user_id = $2 and d.owner_user_id = $2 and d.state = 'indexed' and c.embedding is not null and (c.embedding <=> $3::vector) <= ${MAX_DISTANCE}
            order by c.embedding <=> $3::vector limit ${CANDIDATES}),
          fused as (select id, sum(1.0 / (${RRF_K} + r)) as score from (select * from kw union all select * from vc) s group by id)
         select c.id as chunk_id, c.doc_id, c.text, d.name, d.web_view_link from fused f join knowledge_chunk c on c.id = f.id join knowledge_doc d on d.id = c.doc_id order by f.score desc limit $4`,
        [q, userId, qv ? vec(qv) : null, k],
      );
      await client.query("commit");
      return rows.map((r: Record<string, string | null>) => ({
        chunkId: r.chunk_id!,
        docId: r.doc_id!,
        name: r.name!,
        link: r.web_view_link ?? null,
        text: r.text!,
      }));
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Which of the cited documents the signed-in user can still open right now. Each is asked of Drive with the user's own token; a document
   * Drive no longer lets them open is dropped from the index. With no usable Google connection nothing is returned (fail closed).
   */
  async function stillAccessible(a: ActiveActor, docIds: string[]) {
    const docs = await db
      .select()
      .from(knowledgeDoc)
      .where(
        and(
          eq(knowledgeDoc.ownerUserId, a.userId),
          inArray(knowledgeDoc.id, docIds.slice(0, 12)),
          eq(knowledgeDoc.state, "indexed"),
        ),
      );
    if (!docs.length) return [];
    let ctx: PluginContext;
    try {
      ctx = await googleCtx(a);
    } catch {
      return [];
    }
    const open = await Promise.all(
      docs.map(async (d) => ((await drive.canOpen(ctx, d.externalId)) ? d : null)),
    );
    const lost = docs.filter((_, i) => !open[i]);
    if (lost.length) {
      await db
        .update(knowledgeDoc)
        .set({ state: "removed", updatedAt: new Date() })
        .where(
          inArray(
            knowledgeDoc.id,
            lost.map((d) => d.id),
          ),
        );
      await dropChunks(lost.map((d) => d.id));
    }
    return open.filter((d): d is NonNullable<typeof d> => d !== null);
  }

  /**
   * The sources an answer used, as `[n]` citations in the order the bot saw them. Only documents the signed-in user can open right now are
   * returned, and only from their own message: a revoked file simply drops out of the list.
   */
  async function cited(
    a: ActiveActor,
    messageId: string,
  ): Promise<{ n: number; docId: string; name: string; link: string | null; snippet: string }[]> {
    const [m] = await db
      .select({ meta: message.meta })
      .from(message)
      .where(and(eq(message.id, messageId), eq(message.ownerUserId, a.userId)));
    const used =
      ((m?.meta ?? {}) as { used?: { docs?: { docId: string; chunkId: string }[] } }).used?.docs ??
      [];
    if (!used.length) return [];
    const open = new Set(
      (
        await stillAccessible(
          a,
          used.map((d) => d.docId),
        )
      ).map((d) => d.id),
    );
    const chunks = await db
      .select({ id: knowledgeChunk.id, text: knowledgeChunk.text })
      .from(knowledgeChunk)
      .where(
        and(
          eq(knowledgeChunk.ownerUserId, a.userId),
          inArray(
            knowledgeChunk.id,
            used.map((d) => d.chunkId),
          ),
        ),
      );
    const docs = await db
      .select()
      .from(knowledgeDoc)
      .where(
        and(
          eq(knowledgeDoc.ownerUserId, a.userId),
          inArray(
            knowledgeDoc.id,
            used.map((d) => d.docId),
          ),
        ),
      );
    return used.flatMap((u, i) => {
      const d = docs.find((x) => x.id === u.docId);
      if (!d || !open.has(d.id)) return [];
      return [
        {
          n: i + 1,
          docId: d.id,
          name: d.name,
          link: d.webViewLink,
          snippet: (chunks.find((c) => c.id === u.chunkId)?.text ?? "").slice(0, 240),
        },
      ];
    });
  }

  return { status, enable, disable, syncUser, tick, retrieve, stillAccessible, cited };
}
export type Knowledge = ReturnType<typeof createKnowledge>;
