import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { decisionConfig } from "@zetta/db/schema/features";
import { z } from "zod";
import { AccessError, type ActiveActor } from "../identity/access";
import { DecisionError, type DecisionService } from "../decisions/service";
import type { JevDecider } from "../decisions/jev";

const option = z
  .strictObject({
    label: z.string().trim().min(1).max(60),
    description: z.string().trim().min(1).max(200),
    action: z.enum(["respond", "ask_user", "delegate", "stop"]),
    targetBotId: z.string().uuid().optional(),
    reply: z.string().max(1000).optional(),
  })
  .refine((o) => o.action !== "delegate" || !!o.targetBotId, "delegate needs a target bot");
export const decisionConfigSchema = z
  .strictObject({
    enabled: z.boolean(),
    backend: z.enum(["laya", "jev"]).default("laya"),
    question: z.string().trim().min(1).max(300),
    options: z.array(option).min(2).max(8),
    minConfidencePct: z.number().int().min(0).max(100),
  })
  .refine(
    (c) => new Set(c.options.map((o) => o.label)).size === c.options.length,
    "option labels must be unique",
  );
export type DecisionConfigInput = z.infer<typeof decisionConfigSchema>;

export type Route =
  | {
      action: "respond";
      reason: "disabled" | "uncertain" | "unavailable" | "chosen";
      choice?: string;
      confidence?: number;
      /** The chosen option's fixed text; a decision-only bot sends it instead of calling an AI. */
      reply?: string;
    }
  | { action: "ask_user" | "stop"; reply: string; choice: string; confidence: number }
  | { action: "delegate"; targetBotId: string; choice: string; confidence: number };

/** What a decision-only bot (harness `decision`) sends when the model is unsure, unavailable or off, or the option has no reply. */
export const DECISION_FALLBACK = "I'm not sure how to help with that. Could you rephrase it?";
/** The part of a bot the routing needs. A `decision` bot uses its own model (laya or jev) and routes every message. */
type RoutedBot = { id: string; harness?: string; model?: string | null };
const backendOf = (b: RoutedBot, configured: "laya" | "jev"): "laya" | "jev" =>
  b.harness === "decision" ? (b.model === "jev" ? "jev" : "laya") : configured;

const MENTION_MIN_CONFIDENCE = 0.6;
const PICK_QUESTION =
  "A person wrote in a team room and mentioned nobody. Which member is best placed to answer this message?";
/** The longest a room post waits for the model before the Chief answers instead. */
const MENTION_GUARD_MS = 5000;

/** Per-bot decision routing: the builtin Laya model picks one configured option; each option maps to a bounded action. Fails open to a normal reply. */
export function createRouting(db: Database, decisions?: DecisionService, jev?: JevDecider) {
  async function get(botId: string) {
    const [c] = await db.select().from(decisionConfig).where(eq(decisionConfig.botId, botId));
    return c;
  }
  /** One classification by the chosen backend (jev needs the actor's own connection). Throws `DecisionError` like both services do. */
  function choose(
    backend: "laya" | "jev",
    actor: ActiveActor | undefined,
    text: string,
    question: string,
    options: { label: string; description: string }[],
    minConfidence: number,
  ) {
    const labels = options.map((o) => o.label);
    const opts = {
      minConfidence,
      descriptions: Object.fromEntries(options.map((o) => [o.label, o.description])),
    };
    return backend === "jev"
      ? jev!.choose(actor!, text, question, labels, opts)
      : decisions!.choose(text, question, labels, {
          ...(actor ? { owner: actor.userId } : {}),
          ...opts,
        });
  }
  /**
   * Which room member answers a message that mentions nobody: the model picks one member by name. Returns its bot id, or null when the
   * model is unavailable, slow, unsure or fails (the caller then falls back to the Chief). Uses the Chief's decision backend, else Laya.
   */
  async function pickBot(
    chief: RoutedBot | undefined,
    text: string,
    candidates: readonly { botId: string; name: string; description: string }[],
    actor?: ActiveActor,
    guardMs = MENTION_GUARD_MS,
  ): Promise<string | null> {
    if (candidates.length < 2) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const backend = chief ? backendOf(chief, (await get(chief.id))?.backend ?? "laya") : "laya";
      if ((backend === "laya" && !decisions) || (backend === "jev" && (!jev || !actor)))
        return null;
      const slow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("slow")), guardMs);
      });
      const r = await Promise.race([
        choose(
          backend,
          actor,
          text,
          PICK_QUESTION,
          candidates.map((c) => ({ label: c.name, description: c.description || c.name })),
          MENTION_MIN_CONFIDENCE,
        ),
        slow,
      ]);
      return candidates.find((c) => c.name === r.choice)?.botId ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  async function decide(
    b: RoutedBot,
    text: string,
    force = false,
    actor?: ActiveActor,
  ): Promise<Route> {
    const cfg = await get(b.id);
    const backend = cfg && backendOf(b, cfg.backend);
    if (
      !cfg ||
      (!cfg.enabled && !force && b.harness !== "decision") ||
      (backend === "laya" && !decisions) ||
      (backend === "jev" && (!jev || !actor))
    )
      return { action: "respond", reason: "disabled" };
    let r;
    try {
      r = await choose(backend!, actor, text, cfg.question, cfg.options, cfg.minConfidence / 100);
    } catch (e) {
      return {
        action: "respond",
        reason: e instanceof DecisionError ? "unavailable" : "unavailable",
      };
    }
    if (r.choice === null)
      return { action: "respond", reason: "uncertain", confidence: r.confidence };
    const o = cfg.options.find((x) => x.label === r.choice)!;
    if (o.action === "ask_user" || o.action === "stop")
      return {
        action: o.action,
        reply:
          o.reply ||
          (o.action === "stop" ? "I can't help with that." : "Could you tell me a bit more?"),
        choice: o.label,
        confidence: r.confidence,
      };
    if (o.action === "delegate")
      return {
        action: "delegate",
        targetBotId: o.targetBotId!,
        choice: o.label,
        confidence: r.confidence,
      };
    return {
      action: "respond",
      reason: "chosen",
      choice: o.label,
      confidence: r.confidence,
      ...(o.reply ? { reply: o.reply } : {}),
    };
  }
  /** The whole answer of a decision-only bot: the chosen option's reply, or the fallback text. Never throws, never calls an AI. */
  async function reply(b: RoutedBot, text: string, actor?: ActiveActor) {
    const r = await decide(b, text, true, actor).catch(() => undefined);
    return (r && "reply" in r && r.reply) || DECISION_FALLBACK;
  }
  return {
    decide,
    reply,
    pickBot,
    async get(a: ActiveActor, botId: string) {
      const [b] = await db
        .select()
        .from(bot)
        .where(and(eq(bot.id, botId), eq(bot.ownerUserId, a.userId)));
      if (!b) throw new AccessError("NOT_FOUND");
      const c = await get(botId);
      return c
        ? {
            enabled: c.enabled,
            backend: c.backend,
            question: c.question,
            options: c.options,
            minConfidencePct: c.minConfidence,
          }
        : null;
    },
    async set(a: ActiveActor, botId: string, input: DecisionConfigInput) {
      const [b] = await db
        .select()
        .from(bot)
        .where(and(eq(bot.id, botId), eq(bot.ownerUserId, a.userId), eq(bot.archived, false)));
      if (!b) throw new AccessError("NOT_FOUND");
      // A decision-only bot has no AI to write an answer, so every option except a hand-over must carry its own text.
      if (
        b.harness === "decision" &&
        input.options.some((o) => o.action !== "delegate" && !o.reply?.trim())
      )
        throw new z.ZodError([
          { code: "custom", path: ["options"], message: "every option needs a reply" },
        ]);
      for (const o of input.options)
        if (o.targetBotId) {
          const [t] = await db
            .select()
            .from(bot)
            .where(and(eq(bot.id, o.targetBotId), eq(bot.archived, false)));
          if (!t || (t.ownerUserId !== a.userId && t.visibility !== "team") || t.id === botId)
            throw new AccessError("NOT_FOUND");
        }
      await db
        .insert(decisionConfig)
        .values({
          botId,
          ownerUserId: a.userId,
          enabled: input.enabled,
          backend: input.backend,
          question: input.question,
          options: input.options,
          minConfidence: input.minConfidencePct,
        })
        .onConflictDoUpdate({
          target: decisionConfig.botId,
          set: {
            enabled: input.enabled,
            backend: input.backend,
            question: input.question,
            options: input.options,
            minConfidence: input.minConfidencePct,
            updatedAt: new Date(),
          },
        });
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
