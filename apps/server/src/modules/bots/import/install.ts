import type { BotOrigin } from "@zetta/db/schema/chat";

import type { BotInput } from "../../chat/service";
import { RoutineError, type RoutineInput } from "../../features/routines";
import { validTimezone } from "../../features/schedule";
import type { ActiveActor } from "../../identity/access";
import { MemoryError, type MemoryAuthor } from "../../memory/service";
import { SKILL_LIMITS, SkillError, type SkillFields } from "../../skills/service";
import { botImportDraftSchema, type BotImportDraft, type RoutineDraft } from "./draft";
import { ImportError } from "./errors";

/**
 * Creates what an approved draft describes: the bot, its skills, its notes and its routines. The draft is what the person saw and
 * edited, so nothing is decided again here and the engine is not asked anything.
 *
 * The services each write on their own (there is no one transaction across bots, skills, memory and routines), so this checks
 * what it can before the first write, and if a later step fails it undoes what it made, newest first. A failure while undoing never
 * hides the error that started it.
 */

/** The part of each service the installer uses. Narrow on purpose: tests hand in plain fakes. */
export type InstallDeps = {
  bots: {
    createBot(
      actor: ActiveActor,
      input: BotInput,
    ): Promise<{ id: string; name: string; slug: string }>;
    archiveBot(actor: ActiveActor, id: string): Promise<unknown>;
  };
  skills: {
    create(actor: ActiveActor, fields: SkillFields): Promise<{ id: string; name: string }>;
    addBots(actor: ActiveActor, id: string, botIds: string[]): Promise<unknown>;
    archive(actor: ActiveActor, id: string): Promise<unknown>;
  };
  memory: {
    remember(
      owner: string,
      v: { content: string; botId: string; target: "notes" },
      author: MemoryAuthor,
    ): Promise<{ page: { slug: string }; created: boolean }>;
    setStatus(
      owner: string,
      slug: string,
      status: "archived",
      author: MemoryAuthor,
    ): Promise<unknown>;
  };
  routines: {
    create(actor: ActiveActor, v: RoutineInput): Promise<{ id: string }>;
    setPaused(actor: ActiveActor, id: string, paused: boolean): Promise<unknown>;
    remove(actor: ActiveActor, id: string): Promise<unknown>;
  };
  /** Names of the person's active skills. */
  skillNames(owner: string): Promise<ReadonlySet<string>>;
  /** The person's Chief engine: a new bot starts on the same one. */
  chief(owner: string): Promise<{ harness: string; model: string | null } | null>;
  now?: () => Date;
};

export type InstallResult = {
  bot: { id: string; name: string; slug: string };
  skills: { id: string; name: string }[];
  notes: number;
  routines: { id: string; title: string; state: "active" | "paused"; reason: string | null }[];
  integrations: BotImportDraft["integrations"];
  warnings: string[];
};

/** A routine needs a time or an interval to exist; one whose schedule Zetta cannot run gets this and stays paused. */
const PLACEHOLDER_TIME = "09:00";

/** The person's skill library holds this many active skills (see `SKILL_LIMITS.perOwner`). */
const readable = (e: unknown, what: string): unknown => {
  if (e instanceof SkillError) {
    if (e.code === "FULL")
      return new ImportError(
        "FULL",
        "You have reached the limit of skills in your library. Archive one you don't use, then try again.",
      );
    if (e.code === "DUPLICATE")
      return new ImportError(
        "DUPLICATE",
        `You already have a skill with the name of ${what}. Rename it in the review and try again.`,
      );
    return new ImportError(
      "INVALID_DRAFT",
      `The skill "${what}" was refused (${e.code.toLowerCase().replaceAll("_", " ")}). Edit it in the review and try again.`,
    );
  }
  if (e instanceof MemoryError)
    return new ImportError(
      "INVALID_DRAFT",
      `A note was refused (${String(e.code).toLowerCase().replaceAll("_", " ")}). Edit it in the review and try again.`,
    );
  return e;
};

const scheduleInput = (
  r: RoutineDraft,
): Pick<RoutineInput, "dailyAt" | "everyMinutes" | "weekdays"> => {
  const s = r.schedule;
  if (s.kind === "interval") return { everyMinutes: s.everyMinutes };
  if (s.kind === "daily")
    return { dailyAt: s.dailyAt, ...(s.weekdays?.length ? { weekdays: s.weekdays } : {}) };
  return { dailyAt: PLACEHOLDER_TIME };
};

export function createInstaller(deps: InstallDeps) {
  const now = deps.now ?? (() => new Date());

  async function install(actor: ActiveActor, input: unknown): Promise<InstallResult> {
    const checked = botImportDraftSchema.safeParse(input);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      throw new ImportError(
        "INVALID_DRAFT",
        `The bot could not be created: ${issue ? `${issue.path.join(".") || "draft"}: ${issue.message}` : "the draft is not valid"}.`,
      );
    }
    const draft = checked.data;
    if (!validTimezone(draft.timezone))
      throw new ImportError("INVALID_DRAFT", `"${draft.timezone}" is not a timezone.`);

    // ── checked before the first write
    const taken = await deps.skillNames(actor.userId);
    const seen = new Set<string>();
    for (const s of draft.skills) {
      if (seen.has(s.name) || taken.has(s.name))
        throw new ImportError(
          "DUPLICATE",
          `There is already a skill called "${s.name}". Rename it in the review and try again.`,
        );
      seen.add(s.name);
    }
    if (taken.size + draft.skills.length > SKILL_LIMITS.perOwner)
      throw new ImportError(
        "FULL",
        `Your library has room for ${Math.max(0, SKILL_LIMITS.perOwner - taken.size)} more skills and this bot brings ${draft.skills.length}. Archive some you don't use, or remove some here.`,
      );

    const chief = await deps.chief(actor.userId);
    const engine =
      chief && chief.harness !== "fixture" && chief.harness !== "decision"
        ? { harness: chief.harness as NonNullable<BotInput["harness"]>, model: chief.model }
        : null;
    const origin: BotOrigin = {
      source: "grok_marketplace",
      url: draft.source.url,
      slug: draft.source.slug,
      creator: draft.source.creator,
      handle: draft.source.handle,
      importedAt: now().toISOString(),
      integrations: draft.integrations,
    };

    // ── writes, each with its undo
    const undo: (() => Promise<unknown>)[] = [];
    const result: InstallResult = {
      bot: { id: "", name: "", slug: "" },
      skills: [],
      notes: 0,
      routines: [],
      integrations: draft.integrations,
      warnings: [...draft.warnings],
    };
    let working = "the bot";
    try {
      const created = await deps.bots.createBot(actor, {
        name: draft.name,
        description: draft.description,
        personality: draft.personality,
        instructions: draft.instructions,
        avatar: draft.avatar,
        // A bot from outside starts private and without a code directory: the person turns those on when they trust it.
        visibility: "private",
        codeAccess: false,
        origin,
        ...(engine ? engine : {}),
      });
      undo.push(() => deps.bots.archiveBot(actor, created.id));
      result.bot = { id: created.id, name: created.name, slug: created.slug };

      for (const s of draft.skills) {
        working = s.name;
        const made = await deps.skills.create(actor, {
          name: s.name,
          description: s.description,
          body: s.body,
        });
        undo.push(() => deps.skills.archive(actor, made.id));
        await deps.skills.addBots(actor, made.id, [created.id]);
        result.skills.push({ id: made.id, name: made.name });
      }

      working = "a note";
      for (const n of draft.notes) {
        const made = await deps.memory.remember(
          actor.userId,
          { content: n.content, botId: created.id, target: "notes" },
          { by: "user" },
        );
        if (made.created)
          undo.push(() =>
            deps.memory.setStatus(actor.userId, made.page.slug, "archived", { by: "user" }),
          );
        result.notes++;
      }

      for (const r of draft.routines) {
        working = r.title;
        const made = await deps.routines.create(actor, {
          botId: created.id,
          title: r.title,
          prompt: r.prompt,
          timezone: draft.timezone,
          ...scheduleInput(r),
        });
        undo.push(() => deps.routines.remove(actor, made.id));
        let state: "active" | "paused" = "paused";
        let reason = r.note;
        if (r.state === "active" && r.schedule.kind !== "unsupported") {
          try {
            await deps.routines.setPaused(actor, made.id, false);
            state = "active";
          } catch (e) {
            // The routine exists; one that is not ready (the bot needs an account connected) stays paused and says what is missing.
            if (!(e instanceof RoutineError)) throw e;
            reason = `Paused: ${e.missing.length ? e.missing.join(", ") : e.code.toLowerCase().replaceAll("_", " ")}.`;
          }
        }
        result.routines.push({ id: made.id, title: r.title, state, reason });
      }
      return result;
    } catch (e) {
      for (const step of undo.reverse()) await step().catch(() => {});
      throw readable(e, working);
    }
  }

  return { install };
}
export type Installer = ReturnType<typeof createInstaller>;
