import type { Database } from "@zetta/db";
import type { DecisionService } from "../../decisions/service";
import { audit, auditToolDetail } from "../../features/audit";
import type { ActiveActor } from "../../identity/access";
import { assist } from "./homeassistant";
import type { PluginContext } from "./registry";

const QUESTION = "Does this message ask to control or check one smart-home device?";
const OPTIONS = ["home_control", "other"] as const;
const DESCRIPTIONS = {
  home_control:
    "A short command to switch, set or query one device or scene at home: a light, switch, fan, cover, thermostat, media player, scene or script.",
  other:
    "Anything else: a question, writing, code, automation design, analysis, or a task with several steps.",
};
const MIN_CONFIDENCE = 0.7;
/** The longest a message waits for the model. Past it, the AI answers as usual. */
const GUARD_MS = 1500;

type Plugins = {
  contextForBot(
    a: ActiveActor,
    botId: string,
    id: string,
    tool: string,
  ): Promise<PluginContext | undefined>;
};

/**
 * The no-LLM path for simple smart-home commands. Laya only decides whether the message is a home command; Home Assistant's own Assist
 * engine (local, not an LLM) finds the entities and does the work. Result is `undefined` whenever anything is off, unsure, slow or
 * unmatched, and the turn then runs exactly as it did before. Never waits for the model to load.
 */
export async function homeFastPath(
  deps: { plugins: Plugins; decisions: Pick<DecisionService, "status" | "choose">; db: Database },
  a: ActiveActor,
  botId: string,
  text: string,
  guardMs = GUARD_MS,
): Promise<{ reply: string; confidence: number } | undefined> {
  if (deps.decisions.status().state !== "ready") return undefined;
  const ctx = await deps.plugins.contextForBot(a, botId, "homeassistant", "assist");
  if (ctx?.config.fastControl !== "on") return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const slow = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("slow")), guardMs);
    });
    const r = await Promise.race([
      deps.decisions.choose(text, QUESTION, OPTIONS, {
        minConfidence: MIN_CONFIDENCE,
        descriptions: DESCRIPTIONS,
        owner: a.userId,
      }),
      slow,
    ]);
    if (r.choice !== "home_control") return undefined;
    const answer = await assist(ctx, text);
    if (answer.type === "error" || !answer.speech) return undefined;
    await audit(deps.db, a.userId, {
      kind: "tool_call",
      botId,
      outcome: "ok",
      detail: auditToolDetail("plugin", "assist"),
    });
    return { reply: answer.speech, confidence: r.confidence };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
