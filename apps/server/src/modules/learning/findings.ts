import { TIDY, type FindingKind, type FindingRef, type FindingStatus } from "@zetta/core/learning";
import type { Database } from "@zetta/db";
import { and, desc, eq, inArray, sql } from "@zetta/db/query";
import { botLesson, learningFinding } from "@zetta/db/schema/learning";
import { memoryItem } from "@zetta/db/schema/memory";
import { z } from "zod";
import { LessonError, type Lessons } from "./lessons";
import { refHash } from "./tidy-rules";
import type { Memory } from "../memory/service";

/**
 * The suggestions of the tidy-up and the forgetting job (docs/decisions/lessons.md). None is applied by itself: a person accepts one
 * (which does the change, through the same steps a person would take by hand) or dismisses it (which is remembered, so it does not
 * come back).
 */

export const findingsQuery = z.strictObject({
  status: z.enum(["open", "accepted", "dismissed", "all"]).default("open"),
});
export const findingAccept = z.strictObject({
  /** For a pair that may conflict: which of the two lessons to drop. */
  drop: z.string().uuid().optional(),
});

export type FindingView = {
  id: string;
  kind: FindingKind;
  botId: string | null;
  summary: string;
  status: FindingStatus;
  createdAt: string;
  refs: { kind: "lesson" | "memory"; id: string; label: string; slug: string | null }[];
};

export function createFindings(db: Database, deps: { lessons: Lessons; memory: Memory }) {
  /** A suggestion, once: the same things never come up twice, and one the person dismissed stays dismissed. At most `TIDY.openPerOwner` wait at a time. */
  async function create(
    owner: string,
    f: { botId?: string | null; kind: FindingKind; refs: FindingRef[]; summary: string },
  ) {
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(learningFinding)
      .where(and(eq(learningFinding.ownerUserId, owner), eq(learningFinding.status, "open")));
    if (n >= TIDY.openPerOwner) return undefined;
    const [row] = await db
      .insert(learningFinding)
      .values({
        ownerUserId: owner,
        botId: f.botId ?? null,
        kind: f.kind,
        refs: f.refs,
        refHash: refHash(f.refs),
        summary: f.summary.slice(0, 1000),
      })
      .onConflictDoNothing()
      .returning();
    return row;
  }

  async function labels(refs: FindingRef[]) {
    const lessonIds = refs.filter((r) => r.kind === "lesson").map((r) => r.id);
    const itemIds = refs.filter((r) => r.kind === "memory").map((r) => r.id);
    const lessons = lessonIds.length
      ? await db
          .select({ id: botLesson.id, text: botLesson.text, status: botLesson.status })
          .from(botLesson)
          .where(inArray(botLesson.id, lessonIds))
      : [];
    const items = itemIds.length
      ? await db
          .select({
            id: memoryItem.id,
            title: memoryItem.title,
            slug: memoryItem.slug,
            status: memoryItem.status,
          })
          .from(memoryItem)
          .where(inArray(memoryItem.id, itemIds))
      : [];
    return {
      lessons: new Map(lessons.map((l) => [l.id, l])),
      items: new Map(items.map((i) => [i.id, i])),
    };
  }

  /** A suggestion about things that are gone, archived or already dealt with is closed as outdated. */
  async function closeOutdated(owner: string) {
    const open = await db
      .select()
      .from(learningFinding)
      .where(and(eq(learningFinding.ownerUserId, owner), eq(learningFinding.status, "open")));
    if (!open.length) return;
    const known = await labels(open.flatMap((f) => f.refs));
    for (const f of open) {
      const alive = f.refs.every((r) =>
        r.kind === "lesson"
          ? ["candidate", "trial", "kept"].includes(known.lessons.get(r.id)?.status ?? "")
          : known.items.get(r.id)?.status === "current",
      );
      if (!alive)
        await db
          .update(learningFinding)
          .set({ status: "outdated", decidedAt: new Date() })
          .where(eq(learningFinding.id, f.id));
    }
  }

  async function load(owner: string, id: string) {
    const [f] = await db
      .select()
      .from(learningFinding)
      .where(and(eq(learningFinding.id, id), eq(learningFinding.ownerUserId, owner)));
    if (!f) throw new LessonError("NOT_FOUND", "That suggestion was not found.");
    return f;
  }

  const decided = (id: string, status: "accepted" | "dismissed") =>
    db
      .update(learningFinding)
      .set({ status, decidedAt: new Date() })
      .where(eq(learningFinding.id, id));

  return {
    create,

    async list(owner: string, q: z.infer<typeof findingsQuery>): Promise<FindingView[]> {
      const f = findingsQuery.parse(q);
      await closeOutdated(owner);
      const rows = await db
        .select()
        .from(learningFinding)
        .where(
          and(
            eq(learningFinding.ownerUserId, owner),
            f.status === "all" ? undefined : eq(learningFinding.status, f.status),
          ),
        )
        .orderBy(desc(learningFinding.createdAt))
        .limit(100);
      const known = await labels(rows.flatMap((r) => r.refs));
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        botId: r.botId,
        summary: r.summary,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        refs: r.refs.map((ref) =>
          ref.kind === "lesson"
            ? { ...ref, label: known.lessons.get(ref.id)?.text ?? "(gone)", slug: null }
            : {
                ...ref,
                label: known.items.get(ref.id)?.title ?? "(gone)",
                slug: known.items.get(ref.id)?.slug ?? null,
              },
        ),
      }));
    },

    /** Does what the suggestion says, as the person: archives the extra copy, drops the lesson, links the newer item. */
    async accept(owner: string, id: string, input: z.infer<typeof findingAccept> = {}) {
      const { drop } = findingAccept.parse(input);
      const f = await load(owner, id);
      if (f.status !== "open")
        throw new LessonError("INVALID", "That suggestion was already dealt with.");
      const [first, second] = f.refs;
      const slugOf = async (itemId: string) =>
        (
          await db
            .select({ slug: memoryItem.slug })
            .from(memoryItem)
            .where(eq(memoryItem.id, itemId))
        )[0]?.slug;
      switch (f.kind) {
        case "duplicate":
          if (first?.kind === "lesson" && second)
            await deps.lessons.drop(
              owner,
              second.id,
              "duplicate",
              "person",
              "it repeated an older lesson",
            );
          else if (first && second) {
            const [keep, extra] = [await slugOf(first.id), await slugOf(second.id)];
            if (!keep || !extra) throw new LessonError("NOT_FOUND", "One of those items is gone.");
            await deps.memory.addLink(owner, keep, extra, "supersedes", { by: "user" });
            await deps.memory.setStatus(owner, extra, "archived", { by: "user" });
          }
          break;
        case "check_pair":
          if (!drop || !f.refs.some((r) => r.id === drop))
            throw new LessonError("INVALID", "Choose which of the two lessons to drop.");
          await deps.lessons.drop(
            owner,
            drop,
            "superseded",
            "person",
            "it pulled against another lesson",
          );
          break;
        case "superseded_current":
        case "unused": {
          const slug = first ? await slugOf(first.id) : undefined;
          if (!slug) throw new LessonError("NOT_FOUND", "That item is gone.");
          await deps.memory.setStatus(owner, slug, "archived", { by: "user" });
          break;
        }
        case "drop_kept":
          if (first) await deps.lessons.drop(owner, first.id, "bad_results", "person");
          break;
      }
      await decided(f.id, "accepted");
      return { id: f.id, status: "accepted" as const };
    },

    async dismiss(owner: string, id: string) {
      const f = await load(owner, id);
      if (f.status !== "open") return { id: f.id, status: f.status };
      await decided(f.id, "dismissed");
      return { id: f.id, status: "dismissed" as const };
    },
  };
}
export type Findings = ReturnType<typeof createFindings>;
