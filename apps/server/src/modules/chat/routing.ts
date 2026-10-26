import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { decisionConfig } from "@zetta/db/schema/features";
import { z } from "zod";
import { AccessError, type ActiveActor } from "../identity/access";
import { DecisionError, type DecisionService } from "../decisions/service";
import type { JevDecider } from "../decisions/jev";

const option = z.strictObject({
  label: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(200),
  action: z.enum(["respond", "ask_user", "delegate", "stop"]), targetBotId: z.string().uuid().optional(), reply: z.string().max(1000).optional(),
}).refine((o) => o.action !== "delegate" || !!o.targetBotId, "delegate needs a target bot");
export const decisionConfigSchema = z.strictObject({
  enabled: z.boolean(), backend: z.enum(["laya", "jev"]).default("laya"), question: z.string().trim().min(1).max(300), options: z.array(option).min(2).max(8), minConfidencePct: z.number().int().min(0).max(100),
}).refine((c) => new Set(c.options.map((o) => o.label)).size === c.options.length, "option labels must be unique");
export type DecisionConfigInput = z.infer<typeof decisionConfigSchema>;

export type Route =
  | { action: "respond"; reason: "disabled" | "uncertain" | "unavailable" | "chosen"; choice?: string; confidence?: number }
  | { action: "ask_user" | "stop"; reply: string; choice: string; confidence: number }
  | { action: "delegate"; targetBotId: string; choice: string; confidence: number };

/** Per-bot decision routing: the builtin Laya model picks one configured option; each option maps to a bounded action. Fails open to a normal reply. */
export function createRouting(db: Database, decisions?: DecisionService, jev?: JevDecider) {
  async function get(botId: string) { const [c] = await db.select().from(decisionConfig).where(eq(decisionConfig.botId, botId)); return c; }
  async function decide(b: { id: string }, text: string, force = false, actor?: ActiveActor): Promise<Route> {
    const cfg = await get(b.id);
    if (!cfg || (!cfg.enabled && !force) || (cfg.backend === "laya" && !decisions) || (cfg.backend === "jev" && (!jev || !actor))) return { action: "respond", reason: "disabled" };
    let r;
    try { r = cfg.backend === "jev" ? await jev!.choose(actor!, text, cfg.question, cfg.options.map((o) => o.label), { minConfidence: cfg.minConfidence / 100, descriptions: Object.fromEntries(cfg.options.map((o) => [o.label, o.description])) }) : await decisions!.choose(text, cfg.question, cfg.options.map((o) => o.label), { ...(actor ? { owner: actor.userId } : {}), minConfidence: cfg.minConfidence / 100, descriptions: Object.fromEntries(cfg.options.map((o) => [o.label, o.description])) }); }
    catch (e) { return { action: "respond", reason: e instanceof DecisionError ? "unavailable" : "unavailable" }; }
    if (r.choice === null) return { action: "respond", reason: "uncertain", confidence: r.confidence };
    const o = cfg.options.find((x) => x.label === r.choice)!;
    if (o.action === "ask_user" || o.action === "stop") return { action: o.action, reply: o.reply || (o.action === "stop" ? "I can't help with that." : "Could you tell me a bit more?"), choice: o.label, confidence: r.confidence };
    if (o.action === "delegate") return { action: "delegate", targetBotId: o.targetBotId!, choice: o.label, confidence: r.confidence };
    return { action: "respond", reason: "chosen", choice: o.label, confidence: r.confidence };
  }
  return {
    decide,
    async get(a: ActiveActor, botId: string) {
      const [b] = await db.select().from(bot).where(and(eq(bot.id, botId), eq(bot.ownerUserId, a.userId)));
      if (!b) throw new AccessError("NOT_FOUND");
      const c = await get(botId);
      return c ? { enabled: c.enabled, backend: c.backend, question: c.question, options: c.options, minConfidencePct: c.minConfidence } : null;
    },
    async set(a: ActiveActor, botId: string, input: DecisionConfigInput) {
      const [b] = await db.select().from(bot).where(and(eq(bot.id, botId), eq(bot.ownerUserId, a.userId), eq(bot.archived, false)));
      if (!b) throw new AccessError("NOT_FOUND");
      for (const o of input.options) if (o.targetBotId) {
        const [t] = await db.select().from(bot).where(and(eq(bot.id, o.targetBotId), eq(bot.archived, false)));
        if (!t || (t.ownerUserId !== a.userId && t.visibility !== "team") || t.id === botId) throw new AccessError("NOT_FOUND");
      }
      await db.insert(decisionConfig).values({ botId, ownerUserId: a.userId, enabled: input.enabled, backend: input.backend, question: input.question, options: input.options, minConfidence: input.minConfidencePct })
        .onConflictDoUpdate({ target: decisionConfig.botId, set: { enabled: input.enabled, backend: input.backend, question: input.question, options: input.options, minConfidence: input.minConfidencePct, updatedAt: new Date() } });
      return this.get(a, botId);
    },
    /** Dry run: what would happen to this message, without sending it to any bot. */
    async preview(a: ActiveActor, botId: string, text: string) {
      await this.get(a, botId);
      return decide({ id: botId }, text, true, a);
    },
  };
}
export type Routing = ReturnType<typeof createRouting>;
