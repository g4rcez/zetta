import { isAvatarValue, type AvatarValue } from "@zetta/core/avatar";
import { z } from "zod";

import { instructions, LIMITS, skillName } from "../../bot-claude/profile";
import { MEMORY_LIMITS } from "../../memory/service";
import { SKILL_LIMITS } from "../../skills/service";
import { parseGrokUrl } from "./grok-source";

/**
 * What an import is going to create, written out so a person can read and edit it before anything exists. `analyze` produces one,
 * the review screen (or Chief's card) shows it, and `install` accepts exactly one of these back. Because the client sends it back,
 * the schema is the gate: every limit the real services enforce is repeated here, so a bad edit fails early with a clear message.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const line = (max: number) => z.string().trim().min(1).max(max);

export const scheduleDraft = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("daily"),
    dailyAt: hhmm,
    /** 0 = Sunday … 6 = Saturday; null = every day. */
    weekdays: z.array(z.number().int().min(0).max(6)).max(6).nullable(),
  }),
  z.strictObject({ kind: z.literal("interval"), everyMinutes: z.number().int().min(5).max(10080) }),
  /** A schedule Zetta cannot run (several times a day, a day of the month...). The routine is kept, paused, for the person to set a time. */
  z.strictObject({ kind: z.literal("unsupported"), expression: z.string().max(100).nullable() }),
]);

export const skillDraft = z.strictObject({
  /** The id the skill had on the marketplace, to tell two drafts of the same import apart. */
  sourceId: z.string().max(80),
  name: skillName,
  description: z.string().trim().min(1).max(LIMITS.description),
  body: instructions(LIMITS.librarySkillBody),
  /** Things the screening found (`looks_secret`, `shell_injection`...). Shown on the review; an install refuses a skill the service refuses. */
  warnings: z.array(z.string().max(60)).max(10),
});

export const noteDraft = z.strictObject({
  sourceId: z.string().max(80),
  content: line(MEMORY_LIMITS.content),
  warnings: z.array(z.string().max(60)).max(10),
});

export const routineDraft = z
  .strictObject({
    sourceId: z.string().max(80),
    title: line(120),
    prompt: line(LIMITS.prompt),
    schedule: scheduleDraft,
    /** `active`: switched on when installed. `paused`: created but off. */
    state: z.enum(["active", "paused"]),
    /** Why a routine is paused when the importer decided it, shown on the review and kept as the routine's reason. */
    note: z.string().max(300).nullable(),
  })
  .refine((r) => r.schedule.kind !== "unsupported" || r.state === "paused", {
    message: "A routine whose schedule Zetta cannot run stays paused.",
    path: ["state"],
  });

export const integrationDraft = z.strictObject({
  name: line(200),
  description: z.string().max(2000),
  /** The Zetta plugin that does the same job, or null when there is none. */
  pluginId: z
    .string()
    .regex(/^[a-z0-9_-]{1,32}$/)
    .nullable(),
});

export const botImportDraftSchema = z.strictObject({
  source: z
    .strictObject({
      url: z.string().max(300),
      slug: z.string().max(81),
      creator: z.string().max(200),
      handle: z.string().max(100).nullable(),
    })
    .refine(
      (s) => {
        try {
          return parseGrokUrl(s.url) === s.slug;
        } catch {
          return false;
        }
      },
      { message: "The source must be the bot's page on x.ai.", path: ["url"] },
    ),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2048),
  avatar: z.custom<AvatarValue>((v) => isAvatarValue(v), "Not a valid avatar."),
  personality: z.string().max(4096),
  instructions: z.string().max(16_384),
  /** The timezone the routines' times are read in (the person's own). */
  timezone: z.string().min(1).max(64),
  skills: z.array(skillDraft).max(SKILL_LIMITS.perBot),
  notes: z.array(noteDraft).max(100),
  routines: z.array(routineDraft).max(20),
  integrations: z.array(integrationDraft).max(50),
  /** Things the person should know before creating (a schedule that could not be kept, a skill that was cut). */
  warnings: z.array(z.string().max(300)).max(50),
});
export type BotImportDraft = z.infer<typeof botImportDraftSchema>;
export type RoutineDraft = z.infer<typeof routineDraft>;
export type SkillDraft = z.infer<typeof skillDraft>;
