import { rm } from "node:fs/promises";
import { basename } from "node:path";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, ne, sql } from "@zetta/db/query";
import { artifact, type ArtifactKind } from "@zetta/db/schema/artifacts";
import { routineRun } from "@zetta/db/schema/features";
import { AccessError, type ActiveActor } from "../identity/access";
import {
  ArtifactFileError,
  artifactPath,
  artifactsQuota,
  classify,
  saveContent,
  savePath,
} from "./storage";

export type Artifact = typeof artifact.$inferSelect;
export type ArtifactSource = { path: string; workspace: string } | { content: string };
export type PublishInput = {
  title: string;
  description?: string | undefined;
  fileName?: string | undefined;
  mimeType?: string | undefined;
  source: ArtifactSource;
};
/** Trusted server values for where an artifact came from (never request input). */
export const ARTIFACT_SORTS = ["recent", "oldest", "largest"] as const;
export type ArtifactSort = (typeof ARTIFACT_SORTS)[number];
export type ArtifactOrigin = { botId?: string | null; conversationId?: string | null };

const fileNameOf = (v: string) =>
  basename(v)
    // oxlint-disable-next-line no-control-regex -- strips control characters on purpose
    .replace(/[\u0000-\u001f"\\/]/g, "_")
    .slice(0, 200);

export function createArtifactStore(db: Database, root?: string) {
  const mine = (a: ActiveActor, id: string) =>
    and(eq(artifact.id, id), eq(artifact.ownerUserId, a.userId));
  return {
    /** Metadata only: the list never reads file content. */
    list: (
      a: ActiveActor,
      f: {
        botId?: string | undefined;
        kind?: ArtifactKind | undefined;
        q?: string | undefined;
        sort?: ArtifactSort | undefined;
      } = {},
    ) =>
      db
        .select()
        .from(artifact)
        .where(
          and(
            eq(artifact.ownerUserId, a.userId),
            f.botId ? eq(artifact.botId, f.botId) : undefined,
            f.kind ? eq(artifact.kind, f.kind) : undefined,
            f.q ? sql`${artifact.title} ilike ${`%${f.q.replace(/[\\%_]/g, "\\$&")}%`}` : undefined,
          ),
        )
        .orderBy(
          // Pinned first, then the chosen order.
          sql`${artifact.pinnedAt} desc nulls last`,
          ...(f.sort === "oldest"
            ? [asc(artifact.createdAt)]
            : f.sort === "largest"
              ? [desc(artifact.size), desc(artifact.createdAt)]
              : [desc(artifact.createdAt)]),
        )
        .limit(200),
    /** Bytes this user keeps. The same bytes published twice count once, like on disk. */
    async usage(a: ActiveActor) {
      const [r] = await db
        .select({ used: sql<number>`coalesce(sum(size), 0)::float8` })
        .from(
          db
            .selectDistinctOn([artifact.sha256], { size: artifact.size })
            .from(artifact)
            .where(eq(artifact.ownerUserId, a.userId))
            .as("kept"),
        );
      return { used: r?.used ?? 0, quota: artifactsQuota() };
    },
    async setPinned(a: ActiveActor, id: string, pinned: boolean) {
      const [row] = await db
        .update(artifact)
        .set({ pinnedAt: pinned ? new Date() : null })
        .where(mine(a, id))
        .returning();
      if (!row) throw new AccessError("NOT_FOUND");
      return row;
    },
    async get(a: ActiveActor, id: string) {
      const [row] = await db.select().from(artifact).where(mine(a, id));
      if (!row) throw new AccessError("NOT_FOUND");
      return row;
    },
    /** The row plus where its bytes are on disk. */
    async file(a: ActiveActor, id: string) {
      const row = await this.get(a, id);
      return { row, path: artifactPath(a.userId, row.sha256, root) };
    },
    /** Stores the bytes, then the row. Throws `ArtifactFileError` when the source is missing, empty or too large. */
    async publish(a: ActiveActor, v: PublishInput, origin: ArtifactOrigin = {}) {
      const saved =
        "path" in v.source
          ? await savePath(a.userId, v.source.path, v.source.workspace, root)
          : { ...(await saveContent(a.userId, v.source.content, root)), fileName: "" };
      const unlink = async () => {
        const [other] = await db
          .select({ id: artifact.id })
          .from(artifact)
          .where(and(eq(artifact.ownerUserId, a.userId), eq(artifact.sha256, saved.sha256)))
          .limit(1);
        if (!other) await rm(artifactPath(a.userId, saved.sha256, root), { force: true });
      };
      const { used, quota } = await this.usage(a);
      const [same] = await db
        .select({ id: artifact.id })
        .from(artifact)
        .where(and(eq(artifact.ownerUserId, a.userId), eq(artifact.sha256, saved.sha256)))
        .limit(1);
      if (!same && used + saved.size > quota) {
        await unlink();
        throw new ArtifactFileError("QUOTA");
      }
      const fileName = fileNameOf(
        v.fileName ||
          saved.fileName ||
          `${v.title}.${/^\s*<(!doctype|html)/i.test((v.source as { content?: string }).content ?? "") ? "html" : "md"}`,
      );
      const { mimeType, kind } = classify(fileName, v.mimeType);
      // A routine's chat is reused between runs, so the run still marked running is the one that made this file.
      const [run] = origin.conversationId
        ? await db
            .select({ id: routineRun.id })
            .from(routineRun)
            .where(
              and(
                eq(routineRun.conversationId, origin.conversationId),
                eq(routineRun.status, "running"),
              ),
            )
            .orderBy(desc(routineRun.startedAt))
            .limit(1)
        : [];
      const [row] = await db
        .insert(artifact)
        .values({
          ownerUserId: a.userId,
          botId: origin.botId ?? null,
          conversationId: origin.conversationId ?? null,
          routineRunId: run?.id ?? null,
          title: v.title,
          description: v.description ?? "",
          fileName,
          mimeType,
          kind,
          size: saved.size,
          sha256: saved.sha256,
        })
        .returning();
      return row!;
    },
    async remove(a: ActiveActor, id: string) {
      const [row] = await db.delete(artifact).where(mine(a, id)).returning();
      if (!row) throw new AccessError("NOT_FOUND");
      // Content-addressed: keep the bytes while another row of this user still points at them.
      const [other] = await db
        .select({ id: artifact.id })
        .from(artifact)
        .where(
          and(
            eq(artifact.ownerUserId, a.userId),
            eq(artifact.sha256, row.sha256),
            ne(artifact.id, row.id),
          ),
        )
        .limit(1);
      if (!other) await rm(artifactPath(a.userId, row.sha256, root), { force: true });
      return row;
    },
  };
}
export type ArtifactStore = ReturnType<typeof createArtifactStore>;
export { ArtifactFileError };
