import { owned } from "./bot";
import { pick, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

/** A bot's private database. Turning it on or off and adding a template are cards; erasing it is a form where the user types the bot's slug. */
export async function runBotDatabase(
  ctx: ChiefCtx,
  a: ChiefArgs<"bot_database">,
): Promise<Outcome> {
  if (!ctx.deps.botDatabase) return { error: "bot databases are not available on this server." };
  const b = pick(await owned(ctx), a.bot, (x) => x.name, "bot");
  if ("error" in b) return b;
  const who = { field: "bot", from: null as unknown, to: b.hit.name as unknown };
  if (a.action === "reset")
    return {
      card: {
        form: "bot_database_reset",
        botId: b.hit.id,
        botName: b.hit.name,
        prefill: { slug: b.hit.slug },
      },
      text: `A form is now shown to the user: they type "${b.hit.slug}" to erase ${b.hit.name}'s database. Nothing is erased until they do; do not say it is erased.`,
    };
  if (a.action === "access")
    return plan(
      `${a.on ? "Turn on" : "Turn off"} the database of ${b.hit.name}`,
      [who, { field: "database access", from: a.on ? "off" : "on", to: a.on ? "on" : "off" }],
      { tool: "bot_database", op: "access", botId: b.hit.id, on: a.on },
    );
  return plan(
    `Add the ${a.template} tables to ${b.hit.name}`,
    [who, { field: "template", from: null, to: a.template }],
    { tool: "bot_database", op: "template", botId: b.hit.id, template: a.template },
  );
}

export async function applyBotDatabase(
  ctx: ApplyCtx,
  p: Record<string, unknown>,
): Promise<Applied> {
  const db = ctx.deps.botDatabase;
  if (!db) throw new Error("bot database unavailable");
  const v = p as { op: string; botId: string; on: boolean; template: string };
  if (v.op === "access") await db.setAccess(v.botId, v.on);
  else await db.applyTemplate(v.botId, v.template);
}
