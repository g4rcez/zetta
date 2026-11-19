import {
  USEFULNESS_LABELS,
  USEFULNESS_WINDOW_DAYS,
  usefulnessVerdict,
  type UsefulnessLabel,
} from "@zetta/core/learning";
import type { Database } from "@zetta/db";
import { and, eq, inArray } from "@zetta/db/query";
import { memoryItem } from "@zetta/db/schema/memory";
import { skill } from "@zetta/db/schema/skills";
import { z } from "zod";
import type { ActiveActor } from "../identity/access";
import { MemoryError, type Memory } from "../memory/service";
import { SkillError, type createSkills } from "../skills/service";
import { baselineBadRate } from "./stats";

/**
 * Which memory items and skills are worth keeping, from what happened after the replies that used them (docs/decisions/lessons.md). One
 * row per item of the person, whether or not anything used it: an item nothing uses is exactly what the page must show.
 */

export class LearningError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID",
    readonly safe: string,
  ) {
    super(code);
  }
}

const MAX_ROWS = 500;
const MAX_BULK = 100;
export const USEFULNESS_SORTS = ["worst", "best", "uses", "recent", "name"] as const;

export const usefulnessQuery = z.strictObject({
  bot: z.string().uuid().optional(),
  kind: z.enum(["memory", "skill"]).optional(),
  label: z.enum(USEFULNESS_LABELS).optional(),
  sort: z.enum(USEFULNESS_SORTS).default("worst"),
  find: z.string().trim().max(100).optional(),
  view: z.enum(["active", "archived"]).default("active"),
});
export type UsefulnessQuery = z.infer<typeof usefulnessQuery>;

export const bulkItems = z.strictObject({
  items: z
    .array(z.strictObject({ kind: z.enum(["memory", "skill"]), id: z.string().uuid() }))
    .min(1)
    .max(MAX_BULK),
});

export type UsefulnessRow = {
  kind: "memory" | "skill";
  id: string;
  /** The slug of a memory item, the name of a skill: how the rest of the app addresses it. */
  slug: string;
  title: string;
  howto: string;
  tags: string[];
  /** A memory item's type (who reads it) or a skill's source (manual, github, learned). */
  source: string;
  status: string;
  uses: number;
  good: number;
  bad: number;
  ambient: number;
  lastUsedAt: string | null;
  label: UsefulnessLabel;
  reason: string;
};

type Skills = Pick<ReturnType<typeof createSkills>, "archive" | "restore">;

const RANK: Record<UsefulnessLabel, number> = { hurts: 0, unused: 1, unclear: 2, helps: 3 };

export function createUsefulness(db: Database, deps: { memory: Memory; skills: Skills }) {
  return {
    async list(actor: ActiveActor, q: UsefulnessQuery) {
      const owner = actor.userId;
      const now = Date.now();
      const since = new Date(now - USEFULNESS_WINDOW_DAYS * 86_400_000);
      const usual = await baselineBadRate(db, owner, q.bot, since);
      const { rows } = await db.$client.query<{
        kind: "memory" | "skill";
        id: string;
        slug: string;
        title: string;
        howto: string;
        tags: string[];
        source: string;
        status: string;
        created_at: Date;
        counted: number;
        good: number;
        bad: number;
        ambient: number;
        last_counted_at: Date | null;
      }>(
        `with u as (
           select iu.ref_kind, iu.ref_id,
                  count(*) filter (where iu.exposure in ('relevant', 'loaded'))::int as counted,
                  count(*) filter (where iu.exposure in ('relevant', 'loaded') and ro.outcome = 'good')::int as good,
                  count(*) filter (where iu.exposure in ('relevant', 'loaded') and ro.outcome = 'bad')::int as bad,
                  count(*) filter (where iu.exposure in ('always', 'shown'))::int as ambient,
                  max(iu.created_at) filter (where iu.exposure in ('relevant', 'loaded')) as last_counted_at
             from item_use iu
             left join reply_outcome ro on ro.message_id = iu.message_id
            where iu.owner_user_id = $1 and iu.created_at > $2 and ($3::uuid is null or iu.bot_id = $3)
            group by 1, 2
         ), items as (
           select 'memory'::text as kind, m.id, m.slug, m.title, m.howto, m.tags, m.type as source, m.status, m.created_at
             from memory_item m
            where m.owner_user_id = $1 and (m.status = 'archived') = ($4 = 'archived')
           union all
           select 'skill', s.id, s.name, s.name, s.description, '{}'::text[], s.source, s.status, s.created_at
             from skill s
            where s.owner_user_id = $1 and (s.status = 'archived') = ($4 = 'archived')
         )
         select i.*, coalesce(u.counted, 0) as counted, coalesce(u.good, 0) as good, coalesce(u.bad, 0) as bad,
                coalesce(u.ambient, 0) as ambient, u.last_counted_at
           from items i
           left join u on u.ref_kind = i.kind and u.ref_id = i.id
          where ($5::text is null or i.kind = $5)
            and ($3::uuid is null
                 or u.ref_id is not null
                 or (i.kind = 'skill' and exists (select 1 from bot_skill bs where bs.bot_id = $3 and bs.skill_id = i.id))
                 or (i.kind = 'memory' and exists (select 1 from memory_item mm where mm.id = i.id and mm.type = 'solo' and mm.author_bot_id = $3)))`,
        [owner, since, q.bot ?? null, q.view, q.kind ?? null],
      );
      const find = q.find?.toLowerCase();
      const all: UsefulnessRow[] = rows
        .filter(
          (r) =>
            !find ||
            `${r.slug} ${r.title} ${r.howto} ${r.tags.join(" ")}`.toLowerCase().includes(find),
        )
        .map((r) => {
          const lastUsedDaysAgo = r.last_counted_at
            ? Math.floor((now - new Date(r.last_counted_at).getTime()) / 86_400_000)
            : null;
          const verdict = usefulnessVerdict({
            uses: r.counted,
            good: r.good,
            bad: r.bad,
            ambient: r.ambient,
            lastUsedDaysAgo,
            baselineBadRate: usual,
            ageDays: (now - new Date(r.created_at).getTime()) / 86_400_000,
          });
          return {
            kind: r.kind,
            id: r.id,
            slug: r.slug,
            title: r.title,
            howto: r.howto,
            tags: r.tags,
            source: r.source,
            status: r.status,
            uses: r.counted,
            good: r.good,
            bad: r.bad,
            ambient: r.ambient,
            lastUsedAt: r.last_counted_at ? new Date(r.last_counted_at).toISOString() : null,
            ...verdict,
          };
        });
      const counts = Object.fromEntries(USEFULNESS_LABELS.map((l) => [l, 0])) as Record<
        UsefulnessLabel,
        number
      >;
      for (const r of all) counts[r.label]++;
      const shown = all.filter((r) => !q.label || r.label === q.label);
      const bySort: Record<
        (typeof USEFULNESS_SORTS)[number],
        (a: UsefulnessRow, b: UsefulnessRow) => number
      > = {
        worst: (a, b) =>
          RANK[a.label] - RANK[b.label] || b.uses - a.uses || a.slug.localeCompare(b.slug),
        best: (a, b) =>
          RANK[b.label] - RANK[a.label] || b.uses - a.uses || a.slug.localeCompare(b.slug),
        uses: (a, b) => b.uses - a.uses || a.slug.localeCompare(b.slug),
        recent: (a, b) =>
          (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") || a.slug.localeCompare(b.slug),
        name: (a, b) => a.slug.localeCompare(b.slug),
      };
      shown.sort(bySort[q.sort]);
      return {
        windowDays: USEFULNESS_WINDOW_DAYS,
        baselineBadRate: usual,
        counts,
        total: shown.length,
        rows: shown.slice(0, MAX_ROWS),
      };
    },

    /** Archives memory items and skills of the person: nothing is deleted, and restore brings them back. */
    async archive(actor: ActiveActor, input: z.infer<typeof bulkItems>) {
      return change(actor, input, "archived");
    },
    async restore(actor: ActiveActor, input: z.infer<typeof bulkItems>) {
      return change(actor, input, "current");
    },
  };

  async function change(
    actor: ActiveActor,
    input: z.infer<typeof bulkItems>,
    to: "archived" | "current",
  ) {
    const owner = actor.userId;
    const memoryIds = input.items.filter((i) => i.kind === "memory").map((i) => i.id);
    const skillIds = input.items.filter((i) => i.kind === "skill").map((i) => i.id);
    const memories = memoryIds.length
      ? await db
          .select({ id: memoryItem.id, slug: memoryItem.slug })
          .from(memoryItem)
          .where(and(eq(memoryItem.ownerUserId, owner), inArray(memoryItem.id, memoryIds)))
      : [];
    const mine = skillIds.length
      ? await db
          .select({ id: skill.id })
          .from(skill)
          .where(and(eq(skill.ownerUserId, owner), inArray(skill.id, skillIds)))
      : [];
    // Everything must be the person's, or nothing happens.
    if (memories.length !== new Set(memoryIds).size || mine.length !== new Set(skillIds).size)
      throw new LearningError("NOT_FOUND", "One of those items is not yours.");
    const failed: { id: string; reason: string }[] = [];
    let done = 0;
    for (const m of memories)
      try {
        await deps.memory.setStatus(owner, m.slug, to, { by: "user" });
        done++;
      } catch (e) {
        failed.push({
          id: m.id,
          reason:
            e instanceof MemoryError && e.code === "MANAGED"
              ? "It comes from Drive and is kept there."
              : "It could not be changed.",
        });
      }
    for (const s of mine)
      try {
        await (to === "archived"
          ? deps.skills.archive(actor, s.id)
          : deps.skills.restore(actor, s.id));
        done++;
      } catch (e) {
        failed.push({
          id: s.id,
          reason:
            e instanceof SkillError && e.code === "NOT_FOUND"
              ? "It is already in that state."
              : e instanceof SkillError && e.code === "FULL"
                ? "The library is full."
                : "It could not be changed.",
        });
      }
    return { done, failed };
  }
}
export type Usefulness = ReturnType<typeof createUsefulness>;
