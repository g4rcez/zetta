import type { Database } from "@zetta/db";
import { and, asc, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { skill } from "@zetta/db/schema/skills";

import type { BotInput } from "../../chat/service";
import type { Routines } from "../../features/routines";
import type { ActiveActor } from "../../identity/access";
import { listPlugins } from "../../integrations/plugins/registry";
import type { Memory } from "../../memory/service";
import type { Skills } from "../../skills/service";
import { createAnalyzerFor, type Analyzer } from "./analyze";
import { presetFor } from "./avatar";
import type { BotImportDraft } from "./draft";
import { createGrokSource, type GrokListItem, type GrokSource } from "./grok-source";
import { matchIntegrations } from "./integrations-match";
import { createInstaller, type InstallResult } from "./install";
import { describeGrokSchedule, scheduleFromRoutine } from "./schedule-from-cron";

/**
 * Importing a bot from the Grok Bot marketplace, as one service: browse, preview, analyze (the person's Chief writes the missing
 * playbooks into a draft) and install (create what the approved draft says). The web wizard and Chief both use it.
 */

/** What a person sees of a marketplace bot before deciding to import it. */
export type BotPreview = {
  id: string;
  url: string;
  name: string;
  creatorName: string;
  handle: string | null;
  description: string;
  categories: string[];
  /** A preset picture in the bot's marketplace color and shape (the creator's own image is only fetched when installing). */
  avatar: ReturnType<typeof presetFor>;
  memories: string[];
  skills: { name: string; description: string }[];
  routines: { name: string; text: string; schedule: string }[];
  integrations: { name: string; description: string; pluginId: string | null }[];
};

export type BotImport = {
  list(): Promise<GrokListItem[]>;
  preview(idOrUrl: string): Promise<BotPreview>;
  analyze(owner: string, idOrUrl: string, opts: { timezone: string }): Promise<BotImportDraft>;
  install(actor: ActiveActor, draft: unknown): Promise<InstallResult>;
};

export type BotImportDeps = {
  db: Database;
  /** The chat service, narrowed to what an import needs. */
  chat: {
    createBot(
      actor: ActiveActor,
      input: BotInput,
    ): Promise<{ id: string; name: string; slug: string } | undefined>;
    archiveBot(actor: ActiveActor, id: string): Promise<unknown>;
  };
  skills: Pick<Skills, "create" | "addBots" | "archive">;
  memory: Pick<Memory, "remember" | "setStatus">;
  routines: Pick<Routines, "create" | "setPaused" | "remove">;
  /** Replaceable in tests; the real marketplace reader and analyzer by default. */
  source?: GrokSource;
  analyzer?: Analyzer;
};

export function createBotImport(deps: BotImportDeps): BotImport {
  const { db, chat, skills, memory, routines } = deps;
  const source = deps.source ?? createGrokSource();
  const analyzer = deps.analyzer ?? createAnalyzerFor(db);

  const chiefOf = async (owner: string) => {
    const [chief] = await db
      .select({ harness: bot.harness, model: bot.model })
      .from(bot)
      .where(and(eq(bot.ownerUserId, owner), eq(bot.kind, "chief"), eq(bot.archived, false)))
      .orderBy(asc(bot.createdAt))
      .limit(1);
    return chief ?? null;
  };

  const installer = createInstaller({
    bots: {
      createBot: async (actor, input) => {
        const row = await chat.createBot(actor, input);
        if (!row) throw new Error("The bot could not be created.");
        return { id: row.id, name: row.name, slug: row.slug };
      },
      archiveBot: (actor, id) => chat.archiveBot(actor, id),
    },
    skills: {
      create: async (actor, fields) => {
        const made = await skills.create(actor, fields);
        return { id: made.id, name: made.name };
      },
      addBots: (actor, id, botIds) => skills.addBots(actor, id, botIds),
      archive: (actor, id) => skills.archive(actor, id),
    },
    memory: {
      remember: async (owner, v, author) => {
        const made = await memory.remember(owner, v, author);
        return { page: { slug: made.page.slug }, created: made.created };
      },
      setStatus: (owner, slug, status, author) => memory.setStatus(owner, slug, status, author),
    },
    routines: {
      create: async (actor, v) => {
        const made = (await routines.create(actor, v)) as { id: string };
        return { id: made.id };
      },
      setPaused: (actor, id, paused) => routines.setPaused(actor, id, paused),
      remove: (actor, id) => routines.remove(actor, id),
    },
    skillNames: async (owner) =>
      new Set(
        (
          await db
            .select({ name: skill.name })
            .from(skill)
            .where(and(eq(skill.ownerUserId, owner), eq(skill.status, "active")))
        ).map((r) => r.name),
      ),
    chief: chiefOf,
  });

  return {
    list: () => source.list(),
    async preview(idOrUrl) {
      const g = await source.get(idOrUrl);
      const plugins = listPlugins().map((p) => ({ id: p.id, name: p.name }));
      return {
        id: g.id,
        url: `https://x.ai/bot/marketplace/bots/${g.id}`,
        name: g.name,
        creatorName: g.creatorName,
        handle: g.handle,
        description: g.description || g.summary,
        categories: g.categories,
        avatar: presetFor(g),
        memories: g.memories.map((m) => m.description).filter(Boolean),
        skills: g.skills.map((s) => ({ name: s.name, description: s.description || s.content })),
        routines: g.routines.map((r) => ({
          name: r.name,
          text: r.summary,
          schedule: describeGrokSchedule(scheduleFromRoutine(r.summary)),
        })),
        integrations: matchIntegrations(
          g.integrations.map((i) => ({ name: i.name, description: i.description })),
          plugins,
        ),
      };
    },
    async analyze(owner, idOrUrl, opts) {
      return analyzer.analyze(owner, await source.get(idOrUrl), opts);
    },
    install: (actor, draft) => installer.install(actor, draft),
  };
}
