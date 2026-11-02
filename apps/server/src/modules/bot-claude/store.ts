import type { Database } from "@zetta/db";
import { and, asc, eq } from "@zetta/db/query";
import { botClaudeAsset, botClaudeConfig } from "@zetta/db/schema/bot-claude";
import { botSkill, skill } from "@zetta/db/schema/skills";
import { dockerConfig, type AgentProfile } from "../chat/harness";
import { hostSkills } from "./host-skills";
import {
  assetInput,
  buildProfile,
  DEFAULT_CONFIG,
  LIMITS,
  type Asset,
  type AssetInput,
  type Config,
  type ConfigInput,
  withBuiltinSkills,
} from "./profile";

export class ClaudeConfigError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "LIMIT" | "DUPLICATE",
    readonly safe: string,
  ) {
    super(code);
  }
}

const toAsset = (r: typeof botClaudeAsset.$inferSelect): Asset => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  description: r.description,
  body: r.body,
  tools: r.tools,
  model: r.model,
  enabled: r.enabled,
});
const toConfig = (r: typeof botClaudeConfig.$inferSelect): Config => ({
  preset: r.preset,
  allow: r.allow,
  deny: r.deny,
  appendPrompt: r.appendPrompt,
  effort: r.effort,
  maxBudgetCents: r.maxBudgetCents,
});

/** Per-bot Claude Code settings and the skills/agents installed for that bot. Callers check that the person owns the bot. */
export function createBotClaude(db: Database) {
  const configRow = async (botId: string) =>
    (await db.select().from(botClaudeConfig).where(eq(botClaudeConfig.botId, botId)))[0];
  const assetRows = (botId: string) =>
    db
      .select()
      .from(botClaudeAsset)
      .where(eq(botClaudeAsset.botId, botId))
      .orderBy(asc(botClaudeAsset.kind), asc(botClaudeAsset.name));
  /** The active skills of the owner's library that this bot brings to its harness, by name. */
  const libraryRows = (botId: string) =>
    db
      .select({ id: skill.id, name: skill.name, description: skill.description, body: skill.body })
      .from(botSkill)
      .innerJoin(skill, eq(skill.id, botSkill.skillId))
      .where(and(eq(botSkill.botId, botId), eq(skill.status, "active")))
      .orderBy(asc(skill.name));
  return {
    async get(botId: string) {
      const [c, a] = await Promise.all([configRow(botId), assetRows(botId)]);
      return { config: c ? toConfig(c) : DEFAULT_CONFIG, assets: a.map(toAsset) };
    },
    async save(botId: string, input: ConfigInput) {
      const values = { ...input, updatedAt: new Date() };
      await db
        .insert(botClaudeConfig)
        .values({ botId, ...values })
        .onConflictDoUpdate({ target: botClaudeConfig.botId, set: values });
      return input;
    },
    async addAsset(botId: string, input: AssetInput) {
      const same = (await assetRows(botId)).filter((r) => r.kind === input.kind);
      if (same.length >= LIMITS.assetsPerKind)
        throw new ClaudeConfigError(
          "LIMIT",
          `A bot can have at most ${LIMITS.assetsPerKind} ${input.kind}s. Remove one first.`,
        );
      if (same.some((r) => r.name === input.name))
        throw new ClaudeConfigError(
          "DUPLICATE",
          `This bot already has a ${input.kind} called ${input.name}.`,
        );
      const [row] = await db
        .insert(botClaudeAsset)
        .values({ botId, ...input })
        .returning();
      return toAsset(row!);
    },
    async updateAsset(botId: string, id: string, input: AssetInput) {
      const [cur] = await db
        .select()
        .from(botClaudeAsset)
        .where(and(eq(botClaudeAsset.id, id), eq(botClaudeAsset.botId, botId)));
      if (!cur) throw new ClaudeConfigError("NOT_FOUND", "This skill or agent no longer exists.");
      if (cur.kind !== input.kind)
        throw new ClaudeConfigError(
          "NOT_FOUND",
          "A skill cannot become an agent. Add a new one instead.",
        );
      if (
        cur.name !== input.name &&
        (await assetRows(botId)).some((r) => r.kind === input.kind && r.name === input.name)
      )
        throw new ClaudeConfigError(
          "DUPLICATE",
          `This bot already has a ${input.kind} called ${input.name}.`,
        );
      const [row] = await db
        .update(botClaudeAsset)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(botClaudeAsset.id, id))
        .returning();
      return toAsset(row!);
    },
    async removeAsset(botId: string, id: string) {
      const gone = await db
        .delete(botClaudeAsset)
        .where(and(eq(botClaudeAsset.id, id), eq(botClaudeAsset.botId, botId)))
        .returning({ id: botClaudeAsset.id });
      if (!gone.length)
        throw new ClaudeConfigError("NOT_FOUND", "This skill or agent no longer exists.");
    },
    /** What a run of this bot uses. Rows are re-validated so a row written by an older version can never reach the command line unchecked. */
    async profile(botId: string): Promise<AgentProfile | undefined> {
      const [c, a, shared] = await Promise.all([
        configRow(botId),
        assetRows(botId),
        libraryRows(botId),
      ]);
      const own = new Set(a.filter((r) => r.kind === "skill").map((r) => r.name));
      // Skills from the owner's library (modules/skills) go through the same checks. A skill written for this bot with the same name wins.
      const assets = [
        ...a.map(toAsset),
        ...shared
          .filter((r) => !own.has(r.name))
          .map((r): Asset => ({ ...r, kind: "skill", tools: [], model: null, enabled: true })),
      ].filter(({ id: _id, ...fields }) => assetInput.safeParse(fields).success);
      return buildProfile(c ? toConfig(c) : undefined, assets);
    },
  };
}
export type BotClaude = ReturnType<typeof createBotClaude>;

/**
 * The skills a person can pick for a bot. Its own (and Zetta's) exist for Claude Code and Hermes only; skills from the server user's
 * home (see host-skills.ts) are offered to every harness that runs an AI. A bot's own skill hides a host skill with the same name.
 * In a Docker run only Claude Code gets them (they are installed in its plugin dir); the other harnesses cannot see the host path.
 */
export async function skillsOf(claude: BotClaude, bot: { id: string; harness: string }) {
  const own =
    bot.harness === "claude-code" || bot.harness === "hermes"
      ? withBuiltinSkills(await claude.profile(bot.id)).skills.map(({ name, description }) => ({
          name,
          description,
          source: "bot" as const,
        }))
      : [];
  if (bot.harness === "fixture" || bot.harness === "decision") return own;
  if (bot.harness !== "claude-code" && dockerConfig()) return own;
  const taken = new Set(own.map((k) => k.name));
  const host = (await hostSkills())
    .filter((k) => !taken.has(k.name))
    .map(({ name, description }) => ({ name, description, source: "host" as const }));
  return [...own, ...host];
}
