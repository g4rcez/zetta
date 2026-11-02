import type { Database } from "@zetta/db";
import { and, desc, eq, inArray, isNotNull, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { botSkill, skill } from "@zetta/db/schema/skills";
import { z } from "zod";
import { LIMITS, noInjection, skillName } from "../bot-claude/profile";
import { looksSecret } from "../features/safety";
import type { ActiveActor } from "../identity/access";

export const SKILL_LIMITS = { perOwner: 200, perBot: 25 } as const;

export class SkillError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "CONFLICT"
      | "DUPLICATE"
      | "SECRET_REJECTED"
      | "FULL",
  ) {
    super(code);
  }
}

/** The text of a skill: the same limits as a skill written for one bot (see bot-claude/profile.ts). */
export const skillFields = z.strictObject({
  name: skillName,
  description: z.string().trim().min(1, "Say when this should be used.").max(LIMITS.description),
  body: z
    .string()
    .trim()
    .min(1, "The instructions are empty.")
    .max(LIMITS.body)
    .refine(noInjection, "Shell commands inside the instructions (!`...`) are not allowed."),
});
export type SkillFields = z.infer<typeof skillFields>;
/** Where a skill came from: a commit of a GitHub repository. */
export type SkillOrigin = { repo: string; path: string; ref: string };

const uniqueViolation = (e: unknown) =>
  [e, (e as { cause?: unknown } | null)?.cause].some(
    (x) => (x as { code?: string } | null)?.code === "23505",
  );

const columns = {
  id: skill.id,
  ownerUserId: skill.ownerUserId,
  ownerName: user.name,
  name: skill.name,
  description: skill.description,
  source: skill.source,
  sourceRepo: skill.sourceRepo,
  sourcePath: skill.sourcePath,
  sourceRef: skill.sourceRef,
  version: skill.version,
  createdAt: skill.createdAt,
  updatedAt: skill.updatedAt,
};

/**
 * A person's skill library. The owner reads, edits, attaches and archives a skill; an admin reads and archives any skill.
 * Archive, never delete: the row stays and the name is free again. Bots keep a live reference (`bot_skill`), so an edit reaches them all.
 */
export function createSkills(db: Database) {
  const screen = (v: { name?: string; description?: string; body?: string }) => {
    if (looksSecret(`${v.name ?? ""}\n${v.description ?? ""}\n${v.body ?? ""}`))
      throw new SkillError("SECRET_REJECTED");
  };
  const botIdsOf = async (ids: string[]) => {
    const links = ids.length
      ? await db
          .select({ skillId: botSkill.skillId, botId: botSkill.botId })
          .from(botSkill)
          .where(inArray(botSkill.skillId, ids))
      : [];
    return (id: string) => links.filter((l) => l.skillId === id).map((l) => l.botId);
  };
  const active = (id: string) => and(eq(skill.id, id), eq(skill.status, "active"));
  const readable = (actor: ActiveActor) =>
    actor.isAdmin ? undefined : eq(skill.ownerUserId, actor.userId);

  async function get(actor: ActiveActor, id: string) {
    const [row] = await db
      .select({ ...columns, body: skill.body })
      .from(skill)
      .innerJoin(user, eq(user.id, skill.ownerUserId))
      .where(and(active(id), readable(actor)));
    if (!row) throw new SkillError("NOT_FOUND");
    return { ...row, botIds: (await botIdsOf([id]))(id) };
  }

  const service = {
    /** `mine`: the caller's skills. `all`: every person's, admin only. The text is left out of the list; `get` has it. */
    async list(actor: ActiveActor, scope: "mine" | "all" = "mine") {
      if (scope === "all" && !actor.isAdmin) throw new SkillError("FORBIDDEN");
      const rows = await db
        .select(columns)
        .from(skill)
        .innerJoin(user, eq(user.id, skill.ownerUserId))
        .where(
          and(
            eq(skill.status, "active"),
            scope === "all" ? undefined : eq(skill.ownerUserId, actor.userId),
          ),
        )
        .orderBy(desc(skill.updatedAt))
        .limit(500);
      const botsOf = await botIdsOf(rows.map((r) => r.id));
      return rows.map((r) => ({ ...r, botIds: botsOf(r.id) }));
    },

    get,

    /** The caller's skills installed from GitHub (one repository, or all), to mark them in the marketplace. */
    async installedFrom(actor: ActiveActor, repo?: string) {
      return db
        .select({
          id: skill.id,
          name: skill.name,
          repo: skill.sourceRepo,
          path: skill.sourcePath,
          ref: skill.sourceRef,
        })
        .from(skill)
        .where(
          and(
            eq(skill.ownerUserId, actor.userId),
            eq(skill.status, "active"),
            repo ? eq(skill.sourceRepo, repo) : isNotNull(skill.sourceRepo),
          ),
        );
    },

    async create(actor: ActiveActor, fields: SkillFields, origin?: SkillOrigin) {
      screen(fields);
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(skill)
        .where(and(eq(skill.ownerUserId, actor.userId), eq(skill.status, "active")));
      if (n >= SKILL_LIMITS.perOwner) throw new SkillError("FULL");
      try {
        const [row] = await db
          .insert(skill)
          .values({
            ownerUserId: actor.userId,
            ...fields,
            ...(origin
              ? {
                  source: "github" as const,
                  sourceRepo: origin.repo,
                  sourcePath: origin.path,
                  sourceRef: origin.ref,
                }
              : {}),
          })
          .returning({ id: skill.id });
        return get(actor, row!.id);
      } catch (e) {
        if (uniqueViolation(e)) throw new SkillError("DUPLICATE");
        throw e;
      }
    },

    /** Only the owner edits. An edit to a skill installed from GitHub keeps its origin, so the page can still say where it came from. */
    async update(
      actor: ActiveActor,
      id: string,
      expectedVersion: number,
      patch: Partial<SkillFields>,
    ) {
      screen(patch);
      try {
        const [row] = await db
          .update(skill)
          .set({ ...patch, version: sql`${skill.version} + 1`, updatedAt: new Date() })
          .where(
            and(
              active(id),
              eq(skill.ownerUserId, actor.userId),
              eq(skill.version, expectedVersion),
            ),
          )
          .returning({ id: skill.id });
        if (!row) {
          const [exists] = await db
            .select({ id: skill.id })
            .from(skill)
            .where(and(active(id), eq(skill.ownerUserId, actor.userId)));
          throw new SkillError(exists ? "CONFLICT" : "NOT_FOUND");
        }
      } catch (e) {
        if (uniqueViolation(e)) throw new SkillError("DUPLICATE");
        throw e;
      }
      return get(actor, id);
    },

    /** The owner or an admin. Bots that used it stop loading it at their next run. */
    async archive(actor: ActiveActor, id: string) {
      const [row] = await db
        .update(skill)
        .set({ status: "archived", version: sql`${skill.version} + 1`, updatedAt: new Date() })
        .where(and(active(id), readable(actor)))
        .returning({ id: skill.id });
      if (!row) throw new SkillError("NOT_FOUND");
      return { id: row.id };
    },

    /** The bots that can take `adding` more skills without going over the per-bot limit. */
    async withRoom(botIds: string[], adding: number) {
      if (!botIds.length) return [];
      const counts = await db
        .select({ botId: botSkill.botId, n: sql<number>`count(*)::int` })
        .from(botSkill)
        .innerJoin(skill, eq(skill.id, botSkill.skillId))
        .where(and(inArray(botSkill.botId, botIds), eq(skill.status, "active")))
        .groupBy(botSkill.botId);
      const full = new Set(
        counts.filter((c) => c.n + adding > SKILL_LIMITS.perBot).map((c) => c.botId),
      );
      return botIds.filter((id) => !full.has(id));
    },

    /** Sets which of the caller's bots bring this skill to their harness. Both the skill and every bot must be the caller's. */
    async setBots(actor: ActiveActor, id: string, botIds: string[]) {
      const wanted = [...new Set(botIds)];
      const [mine] = await db
        .select({ id: skill.id })
        .from(skill)
        .where(and(active(id), eq(skill.ownerUserId, actor.userId)));
      if (!mine) throw new SkillError("NOT_FOUND");
      if (wanted.length) {
        const owned = await db
          .select({ id: bot.id })
          .from(bot)
          .where(
            and(
              inArray(bot.id, wanted),
              eq(bot.ownerUserId, actor.userId),
              eq(bot.archived, false),
            ),
          );
        if (owned.length !== wanted.length) throw new SkillError("NOT_FOUND");
        const counts = await db
          .select({ botId: botSkill.botId, n: sql<number>`count(*)::int` })
          .from(botSkill)
          .innerJoin(skill, eq(skill.id, botSkill.skillId))
          .where(
            and(
              inArray(botSkill.botId, wanted),
              eq(skill.status, "active"),
              sql`${skill.id} <> ${id}`,
            ),
          )
          .groupBy(botSkill.botId);
        if (counts.some((c) => c.n >= SKILL_LIMITS.perBot)) throw new SkillError("FULL");
      }
      await db.transaction(async (tx) => {
        await tx.delete(botSkill).where(eq(botSkill.skillId, id));
        if (wanted.length)
          await tx.insert(botSkill).values(wanted.map((botId) => ({ botId, skillId: id })));
      });
      return { botIds: wanted };
    },

    /** Gives the skill to more of the caller's bots and keeps the bots that already have it (setBots would replace them). */
    async addBots(actor: ActiveActor, id: string, botIds: string[]) {
      const current = (await botIdsOf([id]))(id);
      return service.setBots(actor, id, [...new Set([...current, ...botIds])]);
    },
  };
  return service;
}
export type Skills = ReturnType<typeof createSkills>;
