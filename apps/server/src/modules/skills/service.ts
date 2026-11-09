import { hasKeyFormat } from "@zetta/core/secrets";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, inArray, isNotNull, lt, or, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import {
  botSkill,
  skill,
  skillFile,
  skillRevision,
  skillUse,
  type SkillSource,
  type SkillUseSource,
} from "@zetta/db/schema/skills";
import { z } from "zod";
import { FILE_LIMITS, instructions, LIMITS, skillName } from "../bot-claude/profile";
import { looksSecret } from "../features/safety";
import type { ActiveActor } from "../identity/access";
import {
  FILE_WARNINGS,
  MarketError,
  parseSource,
  type Market,
  type SkillFileUpload,
} from "./market";

export const SKILL_LIMITS = { perOwner: 200, perBot: 25 } as const;
/** Saves kept per skill; older ones are dropped. */
export const SKILL_REVISIONS_KEPT = 50;
/** Usage older than this is dropped; "used" and "unused" are about the last 30 days. */
export const SKILL_USE = { keepDays: 90, recentDays: 30 } as const;
export const SKILL_SORTS = ["updated", "name", "used", "size"] as const;
export type SkillSort = (typeof SKILL_SORTS)[number];
export type SkillListOptions = {
  /** Name or description contains this (case-insensitive). */
  q?: string;
  source?: SkillSource;
  /** Only skills attached to this bot. */
  botId?: string;
  /** `archived` lists what was removed, to restore it. */
  status?: "active" | "archived";
  /** Only skills no bot used in the last 30 days. */
  unused?: boolean;
  sort?: SkillSort;
};
export type SkillBulk = {
  action: "attach" | "detach" | "archive";
  skillIds: string[];
  botIds?: string[];
};
const DAY = 86_400_000;
/** Words too common to say two skills are about the same thing. */
const STOP = new Set([
  "the",
  "and",
  "for",
  "use",
  "when",
  "with",
  "this",
  "that",
  "from",
  "user",
  "asks",
  "ask",
  "skill",
  "your",
  "you",
  "are",
  "any",
  "all",
]);
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
export type SkillCheck = {
  /** What would stop the save. */
  problems: string[];
  /** Worth knowing, does not stop the save. */
  warnings: string[];
  bodyBytes: number;
  /** What the skill adds to a Hermes prompt (its budget is 48 KB for all skills of a bot). */
  hermesBytes: number;
  /** Skills the person already has that look like this one. */
  similar: { id: string; name: string; description: string; why: "name" | "topic" }[];
};

export class SkillError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "CONFLICT"
      | "DUPLICATE"
      | "SECRET_REJECTED"
      | "EDITED"
      | "INVALID"
      | "TOO_LARGE"
      | "FULL",
    /** A sentence for the person, when the code alone does not say enough (which file, which limit). */
    readonly detail?: string,
  ) {
    super(code);
  }
}

/** One segment of a file path in a skill folder (the same rule as a folder read from GitHub). */
const PATH_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._ -]{1,100}$/;
export const skillFilePath = (path: string) =>
  path.length <= 300 && path !== "SKILL.md" && path.split("/").every((p) => PATH_SEGMENT.test(p));
export type SkillFileEdit = { path: string; content: Uint8Array; mode: SkillFileUpload["mode"] };

/** The text of a skill: the checks of a skill written for one bot (see bot-claude/profile.ts), with the larger body limit of the library. */
export const skillFields = z.strictObject({
  name: skillName,
  description: z.string().trim().min(1, "Say when this should be used.").max(LIMITS.description),
  body: instructions(LIMITS.librarySkillBody),
});
export type SkillFields = z.infer<typeof skillFields>;
/** Where a skill came from: a commit of a GitHub repository. */
export type SkillOrigin = { repo: string; path: string; ref: string };

const fileRows = (skillId: string, files: readonly SkillFileUpload[]) =>
  files.map((f) => ({
    skillId,
    path: f.path,
    content: Buffer.from(f.content),
    mode: f.mode,
    size: f.content.length,
  }));

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
  status: skill.status,
  bodyBytes: sql<number>`octet_length(${skill.body})::int`,
  filesStatus: skill.filesStatus,
  createdAt: skill.createdAt,
  updatedAt: skill.updatedAt,
};

/**
 * A person's skill library. The owner reads, edits, attaches and archives a skill; an admin reads and archives any skill.
 * Archive, never delete: the row stays and the name is free again. Bots keep a live reference (`bot_skill`), so an edit reaches them all.
 */
export function createSkills(db: Database) {
  /**
   * A skill written here is refused when it looks like it holds any secret (a pasted password). A skill from GitHub is someone else's
   * public text, full of hashes and `token = ...` in examples: only credential formats refuse it, on install and on later edits.
   */
  const screen = (
    v: { name?: string; description?: string; body?: string },
    source: "manual" | "github" = "manual",
  ) => {
    const text = `${v.name ?? ""}\n${v.description ?? ""}\n${v.body ?? ""}`;
    if (source === "github" ? hasKeyFormat(text) : looksSecret(text))
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
  /** How many files each skill keeps next to its SKILL.md. */
  const fileCountsOf = async (ids: string[]) => {
    const rows = ids.length
      ? await db
          .select({ skillId: skillFile.skillId, n: sql<number>`count(*)::int` })
          .from(skillFile)
          .where(inArray(skillFile.skillId, ids))
          .groupBy(skillFile.skillId)
      : [];
    return (id: string) => rows.find((r) => r.skillId === id)?.n ?? 0;
  };
  /** A fingerprint of the skill folder (names, sizes, modes), so a revision says whether the files changed without keeping them. */
  const filesHashOf = async (d: Pick<Database, "select">, skillId: string) => {
    const [row] = await d
      .select({
        h: sql<string>`md5(coalesce(string_agg(${skillFile.path} || ':' || ${skillFile.size} || ':' || ${skillFile.mode}, ',' order by ${skillFile.path}), ''))`,
      })
      .from(skillFile)
      .where(eq(skillFile.skillId, skillId));
    return row?.h ?? "";
  };
  /** Keeps what the skill looks like after a save. Call it in the same transaction as the save. */
  const recordRevision = async (
    d: Pick<Database, "select" | "insert" | "delete">,
    userId: string,
    row: { id: string; version: number; name: string; description: string; body: string },
  ) => {
    await d
      .insert(skillRevision)
      .values({
        skillId: row.id,
        version: row.version,
        name: row.name,
        description: row.description,
        body: row.body,
        filesHash: await filesHashOf(d, row.id),
        savedByUserId: userId,
      })
      .onConflictDoNothing();
    const old = await d
      .select({ id: skillRevision.id })
      .from(skillRevision)
      .where(eq(skillRevision.skillId, row.id))
      .orderBy(desc(skillRevision.version))
      .offset(SKILL_REVISIONS_KEPT);
    if (old.length)
      await d.delete(skillRevision).where(
        inArray(
          skillRevision.id,
          old.map((o) => o.id),
        ),
      );
  };
  /** When each skill was last used and how many times in the last 30 days. */
  const usageOf = async (ids: string[]) => {
    const since = new Date(Date.now() - SKILL_USE.recentDays * DAY);
    const rows = ids.length
      ? await db
          .select({
            skillId: skillUse.skillId,
            last: sql<Date>`max(${skillUse.usedAt})`,
            recent: sql<number>`count(*) filter (where ${skillUse.usedAt} >= ${since})::int`,
          })
          .from(skillUse)
          .where(inArray(skillUse.skillId, ids))
          .groupBy(skillUse.skillId)
      : [];
    return (id: string) => {
      const r = rows.find((x) => x.skillId === id);
      return { lastUsedAt: r?.last ? new Date(r.last) : null, uses30d: r?.recent ?? 0 };
    };
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
    // Names, sizes and modes only: the content of a file is read when a bot runs.
    const files = await db
      .select({ path: skillFile.path, size: skillFile.size, mode: skillFile.mode })
      .from(skillFile)
      .where(eq(skillFile.skillId, id))
      .orderBy(asc(skillFile.path));
    return { ...row, files, botIds: (await botIdsOf([id]))(id) };
  }

  const service = {
    /**
     * `mine`: the caller's skills. `all`: every person's, admin only. The text is left out of the list; `get` has it.
     * Each row says how big the text is and how much it was used (last use, uses in the last 30 days).
     */
    async list(actor: ActiveActor, scope: "mine" | "all" = "mine", opts: SkillListOptions = {}) {
      if (scope === "all" && !actor.isAdmin) throw new SkillError("FORBIDDEN");
      const like = opts.q?.trim()
        ? `%${opts.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
        : undefined;
      const rows = await db
        .select(columns)
        .from(skill)
        .innerJoin(user, eq(user.id, skill.ownerUserId))
        .where(
          and(
            eq(skill.status, opts.status ?? "active"),
            scope === "all" ? undefined : eq(skill.ownerUserId, actor.userId),
            opts.source ? eq(skill.source, opts.source) : undefined,
            like
              ? or(sql`${skill.name} ilike ${like}`, sql`${skill.description} ilike ${like}`)
              : undefined,
            opts.botId
              ? inArray(
                  skill.id,
                  db
                    .select({ id: botSkill.skillId })
                    .from(botSkill)
                    .where(eq(botSkill.botId, opts.botId)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(skill.updatedAt))
        .limit(500);
      const ids = rows.map((r) => r.id);
      const [botsOf, countOf, usedOf] = await Promise.all([
        botIdsOf(ids),
        fileCountsOf(ids),
        usageOf(ids),
      ]);
      const out = rows
        .map((r) => ({ ...r, fileCount: countOf(r.id), botIds: botsOf(r.id), ...usedOf(r.id) }))
        .filter((r) => !opts.unused || r.uses30d === 0);
      const by = opts.sort ?? "updated";
      if (by === "name") out.sort((x, y) => x.name.localeCompare(y.name));
      else if (by === "size") out.sort((x, y) => y.bodyBytes - x.bodyBytes);
      else if (by === "used")
        out.sort(
          (x, y) =>
            (y.lastUsedAt?.getTime() ?? 0) - (x.lastUsedAt?.getTime() ?? 0) ||
            y.uses30d - x.uses30d,
        );
      return out;
    },

    get,
    recordRevision,
    filesHashOf,

    /** The caller's skills installed from GitHub (one repository, or all), to mark them in the marketplace. */
    async installedFrom(actor: ActiveActor, repo?: string) {
      return db
        .select({
          id: skill.id,
          name: skill.name,
          repo: skill.sourceRepo,
          path: skill.sourcePath,
          ref: skill.sourceRef,
          sourceState: skill.sourceState,
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

    /** `files` are the other files of the skill folder; they are saved with the skill or not at all. */
    async create(
      actor: ActiveActor,
      fields: SkillFields,
      origin?: SkillOrigin,
      files: readonly SkillFileUpload[] = [],
    ) {
      screen(fields, origin ? "github" : "manual");
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(skill)
        .where(and(eq(skill.ownerUserId, actor.userId), eq(skill.status, "active")));
      if (n >= SKILL_LIMITS.perOwner) throw new SkillError("FULL");
      try {
        const row = await db.transaction(async (tx) => {
          const [created] = await tx
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
          if (files.length) await tx.insert(skillFile).values(fileRows(created!.id, files));
          await recordRevision(tx, actor.userId, {
            id: created!.id,
            version: 1,
            name: fields.name,
            description: fields.description,
            body: fields.body,
          });
          return created!;
        });
        return get(actor, row.id);
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
      const [current] = await db
        .select({ source: skill.source })
        .from(skill)
        .where(and(active(id), eq(skill.ownerUserId, actor.userId)));
      if (!current) throw new SkillError("NOT_FOUND");
      screen(patch, current.source);
      try {
        const done = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(skill)
            .set({
              ...patch,
              // An installed skill the owner changed is theirs now: an update from GitHub asks before overwriting it.
              ...(current.source === "github" ? { sourceState: "edited" as const } : {}),
              version: sql`${skill.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                active(id),
                eq(skill.ownerUserId, actor.userId),
                eq(skill.version, expectedVersion),
              ),
            )
            .returning({
              id: skill.id,
              version: skill.version,
              name: skill.name,
              description: skill.description,
              body: skill.body,
            });
          if (row) await recordRevision(tx, actor.userId, row);
          return row;
        });
        if (!done) {
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

    /**
     * Skills installed from GitHub before their folder was kept (`files_status = pending`) get their files from the commit they were
     * installed at, one skill at a time. The SKILL.md text is not touched (the owner may have edited it). A skill whose files cannot be
     * kept (gone from GitHub, over the limits, a credential in a file) is closed without files and the reason is logged. A GitHub
     * outage or rate limit stops the run; the skills stay pending for the next start.
     */
    async backfillFiles(market: Pick<Market, "preview">) {
      const pending = await db
        .select({
          id: skill.id,
          repo: skill.sourceRepo,
          path: skill.sourcePath,
          ref: skill.sourceRef,
        })
        .from(skill)
        .where(and(eq(skill.filesStatus, "pending"), eq(skill.status, "active")))
        .orderBy(asc(skill.createdAt));
      const result = { kept: 0, closed: 0, stopped: false };
      const close = async (id: string, files: readonly SkillFileUpload[] = []) => {
        await db.transaction(async (tx) => {
          if (files.length)
            await tx.insert(skillFile).values(fileRows(id, files)).onConflictDoNothing();
          await tx.update(skill).set({ filesStatus: "complete" }).where(eq(skill.id, id));
        });
      };
      for (const row of pending) {
        const src = row.repo && parseSource(row.repo);
        if (!src || !row.path || !row.ref) {
          console.error(`skills: backfill closed id=${row.id} reason=NO_ORIGIN`);
          await close(row.id);
          result.closed++;
          continue;
        }
        try {
          const p = await market.preview(src, row.path, row.ref);
          const blocked = p.warnings.find((w) => FILE_WARNINGS.includes(w));
          if (blocked) {
            console.error(`skills: backfill closed id=${row.id} reason=${blocked}`);
            await close(row.id);
            result.closed++;
          } else {
            await close(row.id, p.files);
            result.kept++;
          }
        } catch (e) {
          if (e instanceof MarketError && (e.code === "NOT_FOUND" || e.code === "INVALID_SOURCE")) {
            console.error(`skills: backfill closed id=${row.id} reason=${e.code}`);
            await close(row.id);
            result.closed++;
            continue;
          }
          console.error(
            `skills: backfill stopped reason=${e instanceof MarketError ? e.code : "ERROR"}`,
          );
          result.stopped = true;
          break;
        }
      }
      return result;
    },

    /** The saves of a skill, newest first. The owner or an admin reads them. */
    async history(actor: ActiveActor, id: string) {
      const [mine] = await db
        .select({ id: skill.id, version: skill.version })
        .from(skill)
        .where(and(eq(skill.id, id), readable(actor)));
      if (!mine) throw new SkillError("NOT_FOUND");
      const rows = await db
        .select({
          id: skillRevision.id,
          version: skillRevision.version,
          name: skillRevision.name,
          description: skillRevision.description,
          bodyBytes: sql<number>`octet_length(${skillRevision.body})::int`,
          filesHash: skillRevision.filesHash,
          savedBy: user.name,
          createdAt: skillRevision.createdAt,
        })
        .from(skillRevision)
        .innerJoin(user, eq(user.id, skillRevision.savedByUserId))
        .where(eq(skillRevision.skillId, id))
        .orderBy(desc(skillRevision.version));
      return { currentVersion: mine.version, revisions: rows };
    },

    /** One save with its text, to show a diff against the skill now or against another save. */
    async revision(actor: ActiveActor, id: string, revisionId: string) {
      const [row] = await db
        .select({
          id: skillRevision.id,
          version: skillRevision.version,
          name: skillRevision.name,
          description: skillRevision.description,
          body: skillRevision.body,
          filesHash: skillRevision.filesHash,
          createdAt: skillRevision.createdAt,
        })
        .from(skillRevision)
        .innerJoin(skill, eq(skill.id, skillRevision.skillId))
        .where(and(eq(skillRevision.id, revisionId), eq(skill.id, id), readable(actor)));
      if (!row) throw new SkillError("NOT_FOUND");
      return row;
    },

    /** Puts a save's text back as a new save (the history keeps both). The owner only; the folder is not touched. */
    async revert(actor: ActiveActor, id: string, revisionId: string, expectedVersion: number) {
      const rev = await service.revision(actor, id, revisionId);
      return service.update(actor, id, expectedVersion, {
        name: rev.name,
        description: rev.description,
        body: rev.body,
      });
    },

    /**
     * Replaces a GitHub skill's text and folder with what the repository has at commit `ref`. The name stays (bots and picks refer to it).
     * A skill the owner changed after installing it is not overwritten unless they say so; the text it had stays in the history either way.
     */
    async replaceFromSource(
      actor: ActiveActor,
      id: string,
      next: {
        description: string;
        body: string;
        ref: string;
        files: readonly SkillFileUpload[];
      },
      opts: { overwriteEdited?: boolean } = {},
    ) {
      const [cur] = await db
        .select({ source: skill.source, state: skill.sourceState, version: skill.version })
        .from(skill)
        .where(and(active(id), eq(skill.ownerUserId, actor.userId)));
      if (!cur || cur.source !== "github") throw new SkillError("NOT_FOUND");
      if (cur.state === "edited" && !opts.overwriteEdited) throw new SkillError("EDITED");
      screen({ description: next.description, body: next.body }, "github");
      await db.transaction(async (tx) => {
        const [row] = await tx
          .update(skill)
          .set({
            description: next.description,
            body: next.body,
            sourceRef: next.ref,
            sourceState: "pristine",
            filesStatus: "complete",
            version: sql`${skill.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(active(id), eq(skill.version, cur.version)))
          .returning({
            id: skill.id,
            version: skill.version,
            name: skill.name,
            description: skill.description,
            body: skill.body,
          });
        if (!row) throw new SkillError("CONFLICT");
        await tx.delete(skillFile).where(eq(skillFile.skillId, id));
        if (next.files.length) await tx.insert(skillFile).values(fileRows(id, next.files));
        await recordRevision(tx, actor.userId, row);
      });
      return get(actor, id);
    },

    /** The skill's text and folder as stored, to compare with what the repository has now. */
    async storedForCompare(actor: ActiveActor, id: string) {
      const [row] = await db
        .select({ description: skill.description, body: skill.body })
        .from(skill)
        .where(and(active(id), eq(skill.ownerUserId, actor.userId)));
      if (!row) throw new SkillError("NOT_FOUND");
      const files = await db
        .select({ path: skillFile.path, content: skillFile.content })
        .from(skillFile)
        .where(eq(skillFile.skillId, id))
        .orderBy(asc(skillFile.path));
      return { ...row, files };
    },

    /**
     * What saving this draft would say, without saving: the same checks as a save, plus a size count, a warning about the Hermes budget,
     * and the person's own skills that look like it. Any part of the draft may be missing while it is being typed.
     */
    async check(
      actor: ActiveActor,
      draft: { name?: string; description?: string; body?: string },
      excludeId?: string,
    ): Promise<SkillCheck> {
      const problems: string[] = [];
      const warnings: string[] = [];
      const parsed = skillFields.partial().safeParse(draft);
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          if (!problems.includes(issue.message)) problems.push(issue.message);
      const text = `${draft.name ?? ""}\n${draft.description ?? ""}\n${draft.body ?? ""}`;
      if (parsed.success && looksSecret(text))
        problems.push("It looks like it holds a key or a password.");
      const mine = await db
        .select({ id: skill.id, name: skill.name, description: skill.description })
        .from(skill)
        .where(and(eq(skill.ownerUserId, actor.userId), eq(skill.status, "active")));
      const others = mine.filter((m) => m.id !== excludeId);
      if (draft.name && others.some((m) => m.name === draft.name))
        problems.push("You already have a skill with this name.");
      if (!excludeId && mine.length >= SKILL_LIMITS.perOwner)
        problems.push(`You reached the limit of ${SKILL_LIMITS.perOwner} skills.`);
      const bodyBytes = Buffer.byteLength(draft.body ?? "");
      const hermesBytes =
        Buffer.byteLength(
          `## Skill: ${draft.name ?? ""}\nUse when: ${draft.description ?? ""}\n${draft.body ?? ""}`,
        ) + 32;
      if (hermesBytes > 24_000)
        warnings.push(
          `On Hermes it takes ${Math.round(hermesBytes / 1000)} KB of the 48 KB shared by all of a bot's skills, so other skills may be left out.`,
        );
      if (
        draft.description !== undefined &&
        draft.description.trim().length > 0 &&
        draft.description.trim().length < 15
      )
        warnings.push(
          "A short description is hard for a bot to match. Say when it should be used.",
        );
      const mineWords = words(`${draft.name ?? ""} ${draft.description ?? ""}`);
      const similar = others
        .map((m) => {
          const theirs = words(`${m.name} ${m.description}`);
          const shared = [...mineWords].filter((w) => theirs.has(w)).length;
          const jaccard =
            mineWords.size + theirs.size - shared
              ? shared / (mineWords.size + theirs.size - shared)
              : 0;
          const sameName =
            Boolean(draft.name) &&
            (m.name.startsWith(draft.name!) || draft.name!.startsWith(m.name)) &&
            m.name !== draft.name;
          return { m, jaccard, sameName };
        })
        .filter((x) => x.sameName || x.jaccard >= 0.4)
        .sort((x, y) => y.jaccard - x.jaccard)
        .slice(0, 3)
        .map((x) => ({
          id: x.m.id,
          name: x.m.name,
          description: x.m.description,
          why: x.sameName ? ("name" as const) : ("topic" as const),
        }));
      return { problems, warnings, bodyBytes, hermesBytes, similar };
    },

    /** One file of the skill folder with its content, for the editor and for an export. Text comes back as text, anything else as base64. */
    async readFile(actor: ActiveActor, id: string, path: string) {
      const [row] = await db
        .select({
          path: skillFile.path,
          content: skillFile.content,
          mode: skillFile.mode,
          size: skillFile.size,
        })
        .from(skillFile)
        .innerJoin(skill, eq(skill.id, skillFile.skillId))
        .where(and(eq(skillFile.skillId, id), eq(skillFile.path, path), readable(actor)));
      if (!row) throw new SkillError("NOT_FOUND");
      const bytes = Buffer.from(row.content);
      const text = new TextDecoder("utf-8", { fatal: true });
      try {
        return {
          path: row.path,
          mode: row.mode,
          size: row.size,
          encoding: "utf8" as const,
          content: text.decode(bytes),
        };
      } catch {
        return {
          path: row.path,
          mode: row.mode,
          size: row.size,
          encoding: "base64" as const,
          content: bytes.toString("base64"),
        };
      }
    },

    /**
     * Adds, replaces and removes files of the skill folder. The owner only. The same limits as an install apply (1 MB a file, 200 files,
     * 4 MB in all) and a file that looks like it holds a credential is refused. It is a save: it goes in the history, and a skill installed
     * from GitHub becomes `edited`.
     */
    async saveFiles(
      actor: ActiveActor,
      id: string,
      put: readonly SkillFileEdit[],
      remove: readonly string[] = [],
    ) {
      for (const f of put) {
        if (!skillFilePath(f.path))
          throw new SkillError(
            "INVALID",
            `"${f.path}" is not a valid file path (letters, digits, . _ - and spaces, folders with /; SKILL.md is the skill itself).`,
          );
        if (f.content.length > FILE_LIMITS.file)
          throw new SkillError(
            "TOO_LARGE",
            `${f.path} is larger than ${FILE_LIMITS.file / 1_000_000} MB.`,
          );
        if (hasKeyFormat(Buffer.from(f.content).toString("utf8")))
          throw new SkillError("SECRET_REJECTED");
      }
      await db.transaction(async (tx) => {
        const [cur] = await tx
          .select({ source: skill.source, version: skill.version })
          .from(skill)
          .where(and(active(id), eq(skill.ownerUserId, actor.userId)))
          .for("update");
        if (!cur) throw new SkillError("NOT_FOUND");
        const have = await tx
          .select({ path: skillFile.path, size: skillFile.size })
          .from(skillFile)
          .where(eq(skillFile.skillId, id));
        const after = new Map(have.map((h) => [h.path, h.size]));
        for (const path of remove) after.delete(path);
        for (const f of put) after.set(f.path, f.content.length);
        const total = [...after.values()].reduce((n, x) => n + x, 0);
        if (after.size > FILE_LIMITS.count)
          throw new SkillError(
            "TOO_LARGE",
            `A skill folder has at most ${FILE_LIMITS.count} files.`,
          );
        if (total > FILE_LIMITS.total)
          throw new SkillError(
            "TOO_LARGE",
            `A skill folder is at most ${FILE_LIMITS.total / 1_000_000} MB in all.`,
          );
        if (remove.length)
          await tx
            .delete(skillFile)
            .where(and(eq(skillFile.skillId, id), inArray(skillFile.path, [...remove])));
        for (const f of put)
          await tx
            .insert(skillFile)
            .values(fileRows(id, [{ ...f, size: f.content.length }])[0]!)
            .onConflictDoUpdate({
              target: [skillFile.skillId, skillFile.path],
              set: { content: Buffer.from(f.content), mode: f.mode, size: f.content.length },
            });
        const [row] = await tx
          .update(skill)
          .set({
            ...(cur.source === "github" ? { sourceState: "edited" as const } : {}),
            version: sql`${skill.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(skill.id, id))
          .returning({
            id: skill.id,
            version: skill.version,
            name: skill.name,
            description: skill.description,
            body: skill.body,
          });
        await recordRevision(tx, actor.userId, row!);
      });
      return (await get(actor, id)).files;
    },

    /** Brings back an archived skill. Its bots come back with it (the links were kept). A name another skill took since is refused. */
    async restore(actor: ActiveActor, id: string) {
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(skill)
        .where(and(eq(skill.ownerUserId, actor.userId), eq(skill.status, "active")));
      if (n >= SKILL_LIMITS.perOwner) throw new SkillError("FULL");
      try {
        const [row] = await db
          .update(skill)
          .set({ status: "active", version: sql`${skill.version} + 1`, updatedAt: new Date() })
          .where(
            and(
              eq(skill.id, id),
              eq(skill.status, "archived"),
              eq(skill.ownerUserId, actor.userId),
            ),
          )
          .returning({ id: skill.id });
        if (!row) throw new SkillError("NOT_FOUND");
        return get(actor, row.id);
      } catch (e) {
        if (uniqueViolation(e)) throw new SkillError("DUPLICATE");
        throw e;
      }
    },

    /**
     * One change for several skills (and bots). Every skill and bot must be the caller's, or nothing happens. Attaching skips a bot that
     * would pass the per-bot limit and says which; detaching and archiving never fail for size.
     */
    async bulk(actor: ActiveActor, o: SkillBulk) {
      const skillIds = [...new Set(o.skillIds)];
      const botIds = [...new Set(o.botIds ?? [])];
      if (!skillIds.length) throw new SkillError("NOT_FOUND");
      const mine = await db
        .select({ id: skill.id })
        .from(skill)
        .where(
          and(
            inArray(skill.id, skillIds),
            eq(skill.status, "active"),
            eq(skill.ownerUserId, actor.userId),
          ),
        );
      if (mine.length !== skillIds.length) throw new SkillError("NOT_FOUND");
      if (o.action === "archive") {
        await db
          .update(skill)
          .set({ status: "archived", version: sql`${skill.version} + 1`, updatedAt: new Date() })
          .where(inArray(skill.id, skillIds));
        return { changed: skillIds.length, skippedBots: [] as string[] };
      }
      if (!botIds.length) throw new SkillError("NOT_FOUND");
      const owned = await db
        .select({ id: bot.id })
        .from(bot)
        .where(
          and(inArray(bot.id, botIds), eq(bot.ownerUserId, actor.userId), eq(bot.archived, false)),
        );
      if (owned.length !== botIds.length) throw new SkillError("NOT_FOUND");
      if (o.action === "detach") {
        await db
          .delete(botSkill)
          .where(and(inArray(botSkill.skillId, skillIds), inArray(botSkill.botId, botIds)));
        return { changed: skillIds.length, skippedBots: [] as string[] };
      }
      // Attach: a bot gets the skills it does not have yet, unless that passes its limit.
      const links = await db
        .select({ botId: botSkill.botId, skillId: botSkill.skillId })
        .from(botSkill)
        .innerJoin(skill, eq(skill.id, botSkill.skillId))
        .where(and(inArray(botSkill.botId, botIds), eq(skill.status, "active")));
      const skippedBots: string[] = [];
      const add: { botId: string; skillId: string }[] = [];
      for (const botId of botIds) {
        const have = new Set(links.filter((l) => l.botId === botId).map((l) => l.skillId));
        const missing = skillIds.filter((id) => !have.has(id));
        if (have.size + missing.length > SKILL_LIMITS.perBot) skippedBots.push(botId);
        else add.push(...missing.map((skillId) => ({ botId, skillId })));
      }
      if (add.length) await db.insert(botSkill).values(add).onConflictDoNothing();
      return { changed: add.length, skippedBots };
    },

    /**
     * A bot used these skills (picked with `/`, or loaded by a Claude Code run). Only the owner's library skills attached to the bot count;
     * other names (the bot's own, built-in, host) are ignored. Usage older than 90 days is dropped for the skills touched.
     */
    async recordUse(botId: string, names: readonly string[], source: SkillUseSource) {
      const wanted = [...new Set(names)];
      if (!wanted.length) return 0;
      const found = await db
        .select({ id: skill.id })
        .from(botSkill)
        .innerJoin(skill, eq(skill.id, botSkill.skillId))
        .where(
          and(eq(botSkill.botId, botId), eq(skill.status, "active"), inArray(skill.name, wanted)),
        );
      if (!found.length) return 0;
      await db.insert(skillUse).values(found.map((f) => ({ skillId: f.id, botId, source })));
      await db.delete(skillUse).where(
        and(
          inArray(
            skillUse.skillId,
            found.map((f) => f.id),
          ),
          lt(skillUse.usedAt, new Date(Date.now() - SKILL_USE.keepDays * DAY)),
        ),
      );
      return found.length;
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
