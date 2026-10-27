import type { Database } from "@zetta/db";
import { and, asc, eq } from "@zetta/db/query";
import { botClaudeAsset, botClaudeConfig } from "@zetta/db/schema/bot-claude";
import type { AgentProfile } from "../chat/harness";
import {
  assetInput,
  buildProfile,
  DEFAULT_CONFIG,
  LIMITS,
  type Asset,
  type AssetInput,
  type Config,
  type ConfigInput,
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
      const [c, a] = await Promise.all([configRow(botId), assetRows(botId)]);
      const assets = a
        .map(toAsset)
        .filter(({ id: _id, ...fields }) => assetInput.safeParse(fields).success);
      return buildProfile(c ? toConfig(c) : undefined, assets);
    },
  };
}
export type BotClaude = ReturnType<typeof createBotClaude>;
