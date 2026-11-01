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
    }
  | { action: "ask_user" | "stop"; reply: string; choice: string; confidence: number }
  | { action: "delegate"; targetBotId: string; choice: string; confidence: number };

const MENTION_QUESTION =
  "Several assistants are @mentioned in one message. Does a later assistant need the result of an earlier one?";
const MENTION_OPTIONS = [
  {
    label: "parallel",
    description:
      "Each assistant gets its own independent task and none needs another's result: compare, give separate opinions, or split the work.",
  },
  {
    label: "chain",
    description:
      "A later assistant needs the output of an earlier one, or the message asks for an order: draft then review, then, after that, based on the previous result.",
  },
];
const MENTION_MIN_CONFIDENCE = 0.6;
/** The longest a message waits for the model before the bots simply answer one after another. */
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
   * How the bots @mentioned together in one message should work. `parallel` only when the model is sure they are independent; every other
   * outcome (unavailable, still loading, error, unsure, slow) is `chain`, because a wrong `parallel` silently loses a chain such as
   * "@A draft it, then @B review it", while a wrong `chain` only costs time. Uses the bot's own decision backend, else Laya.
   * A mixed message ("@A @B compare, then @C summarize") comes out as `chain`, and a chain runs in the order the bots are mentioned.
   */
  async function mentionMode(
    b: { id: string },
    text: string,
    actor?: ActiveActor,
    guardMs = MENTION_GUARD_MS,
  ): Promise<"parallel" | "chain"> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const backend = (await get(b.id))?.backend ?? "laya";
      if ((backend === "laya" && !decisions) || (backend === "jev" && (!jev || !actor)))
        return "chain";
      const slow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("slow")), guardMs);
      });
      const r = await Promise.race([
        choose(backend, actor, text, MENTION_QUESTION, MENTION_OPTIONS, MENTION_MIN_CONFIDENCE),
        slow,
      ]);
      return r.choice === "parallel" ? "parallel" : "chain";
    } catch {
      return "chain";
    } finally {
      clearTimeout(timer);
    }
  }
  async function decide(
    b: { id: string },
    text: string,
    force = false,
    actor?: ActiveActor,
  ): Promise<Route> {
    const cfg = await get(b.id);
    if (
      !cfg ||
      (!cfg.enabled && !force) ||
      (cfg.backend === "laya" && !decisions) ||
      (cfg.backend === "jev" && (!jev || !actor))
    )
      return { action: "respond", reason: "disabled" };
    let r;
    try {
      r = await choose(
        cfg.backend,
        actor,
        text,
        cfg.question,
        cfg.options,
        cfg.minConfidence / 100,
      );
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
    return { action: "respond", reason: "chosen", choice: o.label, confidence: r.confidence };
  }
  return {
    decide,
    mentionMode,
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
