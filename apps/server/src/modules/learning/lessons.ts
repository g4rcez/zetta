import {
  LESSON_MAX_CHARS,
  USEFULNESS_WINDOW_DAYS,
  usefulnessVerdict,
  type LearningStrictness,
  type LessonActor,
  type LessonBasis,
  type LessonDropReason,
  type LessonEventKind,
  type LessonKind,
  type LessonScope,
  type LessonStatus,
  type UsefulnessLabel,
} from "@zetta/core/learning";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, inArray, sql } from "@zetta/db/query";
import {
  botLesson,
  botLessonEvent,
  botLessonEvidence,
  learningPolicy,
  type BotLessonRow,
} from "@zetta/db/schema/learning";
import { memoryItem } from "@zetta/db/schema/memory";
import { skill } from "@zetta/db/schema/skills";
import { z } from "zod";
import { unsafeMemory } from "../features/knowledge";
import { MemoryError, type Memory } from "../memory/service";
import { baselineBadRate, useTotals } from "./stats";
import { topicTag } from "./text";

/**
 * The life of a lesson (docs/decisions/lessons.md): a candidate the daily pass proposed, a trial in use, a kept lesson, a dropped one.
 * Every step is written to `bot_lesson_event`, so a wrong drop can be traced and brought back. A lesson in use is a small memory item
 * (tag `lesson`, type `solo`, written by the system, bots may only suggest changes to it): every engine reads it, and dropping one is
 * archiving that item. Nothing is ever deleted.
 */

export class LessonError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID" | "CONFLICT",
    readonly safe: string,
  ) {
    super(code);
  }
}

export const lessonText = z.string().trim().min(1).max(LESSON_MAX_CHARS);
export const lessonEdit = z.strictObject({ text: lessonText });
export const lessonsQuery = z.strictObject({
  bot: z.string().uuid().optional(),
  status: z.enum(["waiting", "trial", "kept", "dropped", "all"]).default("all"),
});
export const policyInput = z.strictObject({
  batch: z.enum(["daily", "off"]).optional(),
  forget: z.enum(["on", "off"]).optional(),
  tidy: z.enum(["weekly", "off"]).optional(),
  strictness: z.enum(["strict", "normal", "loose"]).optional(),
});
export type PolicyInput = z.infer<typeof policyInput>;

export type LessonView = {
  id: string;
  botId: string;
  text: string;
  topic: string;
  kind: LessonKind;
  scope: LessonScope;
  status: LessonStatus;
  basis: LessonBasis | null;
  origin: string;
  dropReason: LessonDropReason | null;
  /** The memory item that carries it, or the old skill it stands for. */
  memorySlug: string | null;
  skillName: string | null;
  createdAt: string;
  updatedAt: string;
  /** The person's own words that taught it (newest first, at most three). */
  evidence: { quote: string; day: string; conversationId: string | null }[];
  /** How many chats and days they come from: "seen twice" counts these. */
  seen: { chats: number; days: number };
  events: { kind: LessonEventKind; by: LessonActor; detail: string; at: string }[];
  /** What happened after the replies that used it: only for a lesson that was in use. */
  results: {
    uses: number;
    good: number;
    bad: number;
    label: UsefulnessLabel;
    reason: string;
    lastUsedAt: string | null;
  } | null;
};

export type Proposal = {
  ownerUserId: string;
  botId: string;
  text: string;
  topic: string;
  kind: LessonKind;
  scope: LessonScope;
};

const WAITING: LessonStatus[] = ["candidate"];
const RANK: Record<LessonStatus, number> = {
  candidate: 0,
  trial: 1,
  kept: 2,
  dropped: 3,
  rejected: 4,
  expired: 5,
};

export function createLessons(db: Database, deps: { memory: Memory }) {
  async function event(lessonId: string, kind: LessonEventKind, by: LessonActor, detail = "") {
    await db.insert(botLessonEvent).values({ lessonId, kind, by, detail: detail.slice(0, 1000) });
  }

  async function load(owner: string, id: string) {
    const [l] = await db
      .select()
      .from(botLesson)
      .where(and(eq(botLesson.id, id), eq(botLesson.ownerUserId, owner)));
    if (!l) throw new LessonError("NOT_FOUND", "That lesson was not found.");
    return l;
  }

  const touch = (id: string, set: Partial<typeof botLesson.$inferInsert>) =>
    db
      .update(botLesson)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(botLesson.id, id))
      .returning();

  async function slugOf(itemId: string | null) {
    if (!itemId) return undefined;
    const [m] = await db
      .select({ slug: memoryItem.slug })
      .from(memoryItem)
      .where(eq(memoryItem.id, itemId));
    return m?.slug;
  }

  /** Archives what carries a lesson (its memory item, or the old skill). Never deletes. */
  async function archiveCarrier(l: BotLessonRow) {
    const slug = await slugOf(l.memoryItemId);
    if (slug) await deps.memory.setStatus(l.ownerUserId, slug, "archived", { by: "system" });
    if (l.skillId)
      await db
        .update(skill)
        .set({ status: "archived", version: sql`${skill.version} + 1`, updatedAt: new Date() })
        .where(and(eq(skill.id, l.skillId), eq(skill.status, "active")));
  }

  async function restoreCarrier(l: BotLessonRow) {
    const slug = await slugOf(l.memoryItemId);
    if (slug) await deps.memory.setStatus(l.ownerUserId, slug, "current", { by: "system" });
    if (l.skillId)
      try {
        await db
          .update(skill)
          .set({ status: "active", version: sql`${skill.version} + 1`, updatedAt: new Date() })
          .where(and(eq(skill.id, l.skillId), eq(skill.status, "archived")));
      } catch {
        throw new LessonError("CONFLICT", "Another skill took its name. Rename that one first.");
      }
  }

  const itemFor = (l: BotLessonRow) => ({
    slug: `lesson-${l.id.slice(-12)}`,
    title: l.text.length > 80 ? `${l.text.slice(0, 77)}...` : l.text,
    howto: l.topic ? `A lesson about ${l.topic}.` : "A lesson your bot learned from you.",
    content: l.text,
    tags: ["lesson", ...(topicTag(l.topic) ? [topicTag(l.topic)] : [])],
  });

  return {
    event,

    /** A new candidate: what the daily pass found, before any check. */
    async propose(p: Proposal) {
      const [row] = await db
        .insert(botLesson)
        .values({
          ownerUserId: p.ownerUserId,
          botId: p.botId,
          text: p.text,
          topic: p.topic.slice(0, 60),
          kind: p.kind,
          scope: p.scope,
        })
        .returning();
      await event(row!.id, "proposed", "system");
      return row!;
    },

    async addEvidence(
      lessonId: string,
      items: { conversationId: string; messageId: string; quote: string; day: string }[],
    ) {
      if (!items.length) return 0;
      const r = await db
        .insert(botLessonEvidence)
        .values(items.map((i) => ({ lessonId, ...i, quote: i.quote.slice(0, 500) })))
        .onConflictDoNothing()
        .returning({ id: botLessonEvidence.id });
      return r.length;
    },

    /** In how many chats and on how many days the person said it: "seen twice" is two of either. */
    async spread(lessonId: string) {
      const { rows } = await db.$client.query<{ chats: number; days: number }>(
        `select count(distinct conversation_id)::int as chats, count(distinct day)::int as days
           from bot_lesson_evidence where lesson_id = $1`,
        [lessonId],
      );
      return rows[0] ?? { chats: 0, days: 0 };
    },

    /** Every lesson of a bot that is still worth matching a new sighting with, and the ones the person said no to. */
    known(botId: string) {
      return db
        .select()
        .from(botLesson)
        .where(eq(botLesson.botId, botId))
        .orderBy(desc(botLesson.updatedAt))
        .limit(200);
    },

    /** A candidate passed the checks (`basis` says how). Nothing is used yet: it starts, or waits for the person, depending on the bot's setting. */
    async validate(owner: string, id: string, basis: LessonBasis) {
      const l = await load(owner, id);
      if (l.status !== "candidate" || l.basis === basis) return l;
      const [row] = await touch(l.id, { basis });
      await event(
        l.id,
        "validated",
        "system",
        basis === "said" ? "the person said it outright" : "seen in two chats or on two days",
      );
      return row!;
    },

    /** The same lesson was seen again, with new words of the person: the candidate stays alive, and an expired one is open again. */
    async seenAgain(owner: string, id: string, detail: string) {
      const l = await load(owner, id);
      const [row] = await touch(l.id, l.status === "expired" ? { status: "candidate" } : {});
      await event(l.id, "seen_again", "system", detail);
      return row ?? l;
    },

    /** The candidate becomes a lesson in use, on trial: a small memory item the bot reads from now on. */
    async promote(owner: string, id: string, basis: LessonBasis, by: LessonActor) {
      const l = await load(owner, id);
      if (l.status === "trial" || l.status === "kept") return l;
      if (l.status !== "candidate")
        throw new LessonError("INVALID", "Only a lesson that is waiting can start.");
      if (l.kind !== "rule" || l.text.length > LESSON_MAX_CHARS)
        throw new LessonError(
          "INVALID",
          "That is a procedure, not a short rule. Save it as a memory item instead.",
        );
      // Defence in depth: the daily pass already refuses text that reads as an instruction aimed at an AI, and a lesson is replayed into
      // every prompt of the bot.
      if (unsafeMemory(l.text)) {
        await touch(l.id, { status: "rejected" });
        await event(l.id, "refused", "system", "it looked like an instruction aimed at an AI");
        throw new LessonError(
          "INVALID",
          "The lesson was not saved: it looked like an instruction aimed at an AI.",
        );
      }
      let itemId: string;
      try {
        const item = itemFor(l);
        const r = await deps.memory.write(
          owner,
          {
            ...item,
            type: "solo",
            authorBotId: l.botId,
            botAccess: "suggest",
            score: 50,
          },
          { by: "system" },
        );
        itemId = r.page.id;
      } catch (e) {
        const why =
          e instanceof MemoryError && e.code === "SECRET_REJECTED"
            ? "it looked like a secret"
            : "the memory refused it";
        await touch(l.id, { status: "rejected" });
        await event(l.id, "refused", "system", why);
        throw new LessonError("INVALID", `The lesson was not saved: ${why}.`);
      }
      const [row] = await touch(l.id, { status: "trial", basis, memoryItemId: itemId });
      await event(
        l.id,
        "promoted",
        by,
        `on trial, because ${basis === "said" ? "the person said it outright" : basis === "repeated" ? "it was seen twice" : basis === "person" ? "the person accepted it" : "it was an old skill"}`,
      );
      return row!;
    },

    /** It passed its trial. */
    async keep(owner: string, id: string, by: LessonActor) {
      const l = await load(owner, id);
      if (l.status === "kept") return l;
      if (l.status !== "trial")
        throw new LessonError("INVALID", "Only a lesson on trial can be kept.");
      const [row] = await touch(l.id, { status: "kept" });
      await event(l.id, "kept", by);
      return row!;
    },

    /** A lesson in use is archived (its item, or the old skill) and its reason written down. A candidate is rejected instead. */
    async drop(owner: string, id: string, reason: LessonDropReason, by: LessonActor, detail = "") {
      const l = await load(owner, id);
      if (l.status === "dropped") return l;
      if (l.status === "candidate") return this.reject(owner, id, by, detail);
      if (l.status !== "trial" && l.status !== "kept")
        throw new LessonError("INVALID", "That lesson is not in use.");
      await archiveCarrier(l);
      const [row] = await touch(l.id, { status: "dropped", dropReason: reason });
      await event(l.id, "dropped", by, detail || reason.replace("_", " "));
      return row!;
    },

    /** The person accepts a candidate: it starts on trial, for the reason it had (or, if it had none yet, because they said yes). */
    async accept(owner: string, id: string) {
      const l = await load(owner, id);
      return this.promote(owner, id, l.basis ?? "person", "person");
    },

    /** A dropped lesson comes back, on trial again. */
    async restore(owner: string, id: string, by: LessonActor = "person") {
      const l = await load(owner, id);
      if (l.status !== "dropped")
        throw new LessonError("INVALID", "Only a dropped lesson can be brought back.");
      await restoreCarrier(l);
      const [row] = await touch(l.id, { status: l.skillId ? "kept" : "trial", dropReason: null });
      await event(l.id, "restored", by);
      return row!;
    },

    /** The person says no to a candidate. */
    async reject(owner: string, id: string, by: LessonActor, detail = "") {
      const l = await load(owner, id);
      if (l.status === "rejected") return l;
      if (l.status !== "candidate")
        throw new LessonError("INVALID", "Only a lesson that is waiting can be turned down.");
      const [row] = await touch(l.id, { status: "rejected" });
      await event(l.id, "rejected", by, detail);
      return row!;
    },

    /** Candidates nobody saw a second time are closed. Returns how many. */
    async expireCandidates(olderThan: Date) {
      const rows = await db
        .update(botLesson)
        .set({ status: "expired", updatedAt: new Date() })
        .where(and(eq(botLesson.status, "candidate"), sql`${botLesson.updatedAt} < ${olderThan}`))
        .returning({ id: botLesson.id });
      for (const r of rows) await event(r.id, "expired", "system");
      return rows.length;
    },

    /** The person changes the words of a lesson. A lesson in use changes its memory item too. */
    async edit(owner: string, id: string, input: z.infer<typeof lessonEdit>) {
      const { text } = lessonEdit.parse(input);
      const l = await load(owner, id);
      if (l.status === "dropped" || l.status === "rejected" || l.status === "expired")
        throw new LessonError("INVALID", "Bring the lesson back before changing it.");
      if (l.skillId)
        throw new LessonError("INVALID", "Edit this one from the Skills page: it is a skill.");
      if (l.memoryItemId) {
        const slug = await slugOf(l.memoryItemId);
        if (slug)
          await deps.memory.write(
            owner,
            {
              ...itemFor({ ...l, text }),
              type: "solo",
              authorBotId: l.botId,
              botAccess: "suggest",
            },
            { by: "user" },
          );
      }
      const [row] = await touch(l.id, { text });
      await event(l.id, "edited", "person");
      return row!;
    },

    /**
     * A skill a bot learned before lessons existed gets a lesson row (kept, origin `backfill`), so the page shows everything the bot has
     * learned in one place and the person can drop it from there. Safe to run again. Returns how many were added.
     */
    async backfillSkills() {
      const { rows } = await db.$client.query<{
        id: string;
        owner_user_id: string;
        bot_id: string;
        name: string;
        description: string;
      }>(
        `select s.id, s.owner_user_id, s.learned_by_bot_id as bot_id, s.name, s.description
           from skill s
          where s.source = 'learned' and s.status = 'active' and s.learned_by_bot_id is not null
            and exists (select 1 from bot b where b.id = s.learned_by_bot_id)
            and not exists (select 1 from bot_lesson l where l.skill_id = s.id)
          limit 500`,
      );
      for (const r of rows) {
        const [l] = await db
          .insert(botLesson)
          .values({
            ownerUserId: r.owner_user_id,
            botId: r.bot_id,
            skillId: r.id,
            text: r.description.slice(0, 2000),
            topic: r.name.slice(0, 60),
            kind: "procedure",
            status: "kept",
            basis: "old",
            origin: "backfill",
          })
          .returning({ id: botLesson.id });
        await event(l!.id, "promoted", "system", "a skill the bot learned before lessons existed");
      }
      return rows.length;
    },

    /** What the person lets the learning jobs do. No row means the defaults. */
    async policy(owner: string) {
      const [p] = await db
        .select()
        .from(learningPolicy)
        .where(eq(learningPolicy.ownerUserId, owner));
      return {
        batch: p?.batch ?? ("daily" as const),
        forget: p?.forget ?? ("on" as const),
        tidy: p?.tidy ?? ("weekly" as const),
        strictness: (p?.strictness ?? "normal") as LearningStrictness,
      };
    },
    async setPolicy(owner: string, input: PolicyInput) {
      const patch = policyInput.parse(input);
      await db
        .insert(learningPolicy)
        .values({ ownerUserId: owner, ...patch })
        .onConflictDoUpdate({
          target: learningPolicy.ownerUserId,
          set: { ...patch, updatedAt: new Date() },
        });
      return this.policy(owner);
    },

    /** The lessons of a person (or one of their bots) for the page, with their evidence, their steps and how they did. */
    async list(owner: string, q: z.infer<typeof lessonsQuery>): Promise<LessonView[]> {
      const f = lessonsQuery.parse(q);
      const status =
        f.status === "waiting"
          ? WAITING
          : f.status === "trial"
            ? (["trial"] as LessonStatus[])
            : f.status === "kept"
              ? (["kept"] as LessonStatus[])
              : f.status === "dropped"
                ? (["dropped", "rejected", "expired"] as LessonStatus[])
                : undefined;
      const rows = await db
        .select()
        .from(botLesson)
        .where(
          and(
            eq(botLesson.ownerUserId, owner),
            f.bot ? eq(botLesson.botId, f.bot) : undefined,
            status ? inArray(botLesson.status, status) : undefined,
          ),
        )
        .orderBy(desc(botLesson.updatedAt))
        .limit(300);
      rows.sort(
        (a, b) => RANK[a.status] - RANK[b.status] || b.updatedAt.getTime() - a.updatedAt.getTime(),
      );
      if (!rows.length) return [];
      const ids = rows.map((r) => r.id);
      const evidence = await db
        .select()
        .from(botLessonEvidence)
        .where(inArray(botLessonEvidence.lessonId, ids))
        .orderBy(desc(botLessonEvidence.day), desc(botLessonEvidence.createdAt));
      const events = await db
        .select()
        .from(botLessonEvent)
        .where(inArray(botLessonEvent.lessonId, ids))
        .orderBy(asc(botLessonEvent.at));
      const since = new Date(Date.now() - USEFULNESS_WINDOW_DAYS * 86_400_000);
      const itemIds = rows.flatMap((r) => (r.memoryItemId ? [r.memoryItemId] : []));
      const skillIds = rows.flatMap((r) => (r.skillId ? [r.skillId] : []));
      const [memTotals, skillTotals] = await Promise.all([
        useTotals(db, "memory", itemIds, since),
        useTotals(db, "skill", skillIds, since),
      ]);
      const baselines = new Map<string, number | null>();
      for (const botId of new Set(rows.map((r) => r.botId)))
        baselines.set(botId, await baselineBadRate(db, owner, botId, since));
      const slugs = new Map<string, string>();
      if (itemIds.length)
        for (const m of await db
          .select({ id: memoryItem.id, slug: memoryItem.slug })
          .from(memoryItem)
          .where(inArray(memoryItem.id, itemIds)))
          slugs.set(m.id, m.slug);
      const skillNames = new Map<string, string>();
      if (skillIds.length)
        for (const s of await db
          .select({ id: skill.id, name: skill.name })
          .from(skill)
          .where(inArray(skill.id, skillIds)))
          skillNames.set(s.id, s.name);
      return rows.map((r): LessonView => {
        const mine = evidence.filter((e) => e.lessonId === r.id);
        const t = r.memoryItemId
          ? memTotals.get(r.memoryItemId)
          : r.skillId
            ? skillTotals.get(r.skillId)
            : undefined;
        const inUse = r.memoryItemId !== null || r.skillId !== null;
        const results = inUse
          ? (() => {
              const totals = t ?? { uses: 0, good: 0, bad: 0, ambient: 0, lastUsedAt: null };
              const verdict = usefulnessVerdict({
                uses: totals.uses,
                good: totals.good,
                bad: totals.bad,
                ambient: totals.ambient,
                lastUsedDaysAgo: totals.lastUsedAt
                  ? Math.floor((Date.now() - totals.lastUsedAt.getTime()) / 86_400_000)
                  : null,
                baselineBadRate: baselines.get(r.botId) ?? null,
                ageDays: (Date.now() - r.createdAt.getTime()) / 86_400_000,
              });
              return {
                uses: totals.uses,
                good: totals.good,
                bad: totals.bad,
                ...verdict,
                lastUsedAt: totals.lastUsedAt?.toISOString() ?? null,
              };
            })()
          : null;
        return {
          id: r.id,
          botId: r.botId,
          text: r.text,
          topic: r.topic,
          kind: r.kind,
          scope: r.scope,
          status: r.status,
          basis: r.basis,
          origin: r.origin,
          dropReason: r.dropReason,
          memorySlug: r.memoryItemId ? (slugs.get(r.memoryItemId) ?? null) : null,
          skillName: r.skillId ? (skillNames.get(r.skillId) ?? null) : null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          evidence: mine
            .slice(0, 3)
            .map((e) => ({ quote: e.quote, day: e.day, conversationId: e.conversationId })),
          seen: {
            chats: new Set(mine.map((e) => e.conversationId).filter(Boolean)).size,
            days: new Set(mine.map((e) => e.day)).size,
          },
          events: events
            .filter((e) => e.lessonId === r.id)
            .slice(-6)
            .map((e) => ({ kind: e.kind, by: e.by, detail: e.detail, at: e.at.toISOString() })),
          results,
        };
      });
    },
  };
}
export type Lessons = ReturnType<typeof createLessons>;
