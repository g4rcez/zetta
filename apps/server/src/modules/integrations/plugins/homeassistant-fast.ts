import type { Database } from "@zetta/db";
import type { DecisionService } from "../../decisions/service";
import { audit, auditToolDetail } from "../../features/audit";
import type { ActiveActor } from "../../identity/access";
import { assist, haFetch } from "./homeassistant";
import { QUERY, reply, say, stateReply } from "./homeassistant-actions";
import { homeCatalog } from "./homeassistant-catalog";
import { parseHomeCommand, type HomeCommand } from "./homeassistant-nlp";
import { PluginError, type PluginContext } from "./registry";

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
/** The longest the first load of the home waits. Past it, Assist answers (the load goes on and is cached for the next message). */
const CATALOG_MS = 3000;

type Plugins = {
  contextForBot(
    a: ActiveActor,
    botId: string,
    id: string,
    tool: string,
  ): Promise<PluginContext | undefined>;
};
type Deps = {
  plugins: Plugins;
  decisions: Pick<DecisionService, "status" | "choose">;
  db: Database;
  /** The clock of the catalog cache. Tests move it. */
  now?: () => number;
};
type Done = { reply: string; confidence: number };

function within<T>(ms: number, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("slow")), ms);
  });
  return Promise.race([p, slow]).finally(() => clearTimeout(timer));
}

/**
 * Does what the parser understood: calls the service (or reads the state) and words the reply. Returns `undefined` only when Home Assistant
 * refused, so Assist may try. A timeout or a lost connection may have done the action, so it is answered, never retried.
 */
async function execute(
  deps: Deps,
  ctx: PluginContext,
  a: ActiveActor,
  botId: string,
  { entity, action, data, shown, lang }: HomeCommand,
): Promise<Done | undefined> {
  try {
    let spoken: string;
    if (action === QUERY) {
      const s = (await haFetch(ctx, `/api/states/${entity.id}`)) as {
        state?: unknown;
        attributes?: { unit_of_measurement?: unknown };
      };
      const unit = s.attributes?.unit_of_measurement;
      spoken = stateReply(
        lang,
        entity.name,
        String(s.state ?? ""),
        typeof unit === "string" ? unit : undefined,
      );
    } else {
      await haFetch(ctx, `/api/services/${entity.domain}/${action.service}`, {
        method: "POST",
        body: { ...data, entity_id: entity.id },
      });
      spoken = reply(lang, entity.name, action, shown);
    }
    await audit(deps.db, a.userId, {
      kind: "tool_call",
      botId,
      outcome: "ok",
      detail: auditToolDetail("plugin", action === QUERY ? "states" : "call_service"),
    });
    return { reply: spoken, confidence: 1 };
  } catch (e) {
    if (e instanceof PluginError && e.code === "UNREACHABLE" && action !== QUERY)
      return { reply: `${say(lang, "failed")}.`, confidence: 1 };
    return undefined;
  }
}

/** Home Assistant's own Assist engine (local, not an LLM) finds the entities and does the work. */
async function assistPath(
  deps: Deps,
  ctx: PluginContext,
  a: ActiveActor,
  botId: string,
  text: string,
  confidence: number,
): Promise<Done | undefined> {
  const answer = await assist(ctx, text);
  if (answer.type === "error" || !answer.speech) return undefined;
  await audit(deps.db, a.userId, {
    kind: "tool_call",
    botId,
    outcome: "ok",
    detail: auditToolDetail("plugin", "assist"),
  });
  return { reply: answer.speech, confidence };
}

/**
 * The no-LLM path for simple smart-home commands. In order:
 * 1. The parser (homeassistant-nlp.ts): English and Brazilian Portuguese rules and an fzf-style device match on the cached catalog of
 *    the home. No model, so it works with Laya off. It calls the service itself.
 * 2. Laya says whether the message is a home command, and then Home Assistant's own Assist engine tries it.
 * Result is `undefined` whenever anything is off, unsure, slow or unmatched, and the turn then runs exactly as it did before.
 * Never waits for the Laya model to load.
 */
export async function homeFastPath(
  deps: Deps,
  a: ActiveActor,
  botId: string,
  text: string,
  guardMs = GUARD_MS,
): Promise<Done | undefined> {
  const [direct, assisted] = await Promise.all([
    deps.plugins.contextForBot(a, botId, "homeassistant", "call_service"),
    deps.plugins.contextForBot(a, botId, "homeassistant", "assist"),
  ]);
  if ((direct ?? assisted)?.config.fastControl !== "on") return undefined;
  if (direct) {
    const command = await within(CATALOG_MS, homeCatalog(direct, deps.now))
      .then((catalog) => parseHomeCommand(text, catalog, deps.decisions.status().languages))
      .catch(() => undefined);
    const done = command && (await execute(deps, direct, a, botId, command));
    if (done) return done;
  }
  if (!assisted || deps.decisions.status().state !== "ready") return undefined;
  try {
    const r = await within(
      guardMs,
      deps.decisions.choose(text, QUESTION, OPTIONS, {
        minConfidence: MIN_CONFIDENCE,
        descriptions: DESCRIPTIONS,
        owner: a.userId,
      }),
    );
    return r.choice === "home_control"
      ? await assistPath(deps, assisted, a, botId, text, r.confidence)
      : undefined;
  } catch {
    return undefined;
  }
}
