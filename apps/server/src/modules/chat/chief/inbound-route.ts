import { owned } from "./bot";
import { pick, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

/** Incoming messages of a channel plugin: how often a bot's route looks for new ones, and a look right now. Turning a route on or off stays with zetta:inbound. */
export async function runInboundRoute(
  ctx: ChiefCtx,
  a: ChiefArgs<"inbound_route">,
): Promise<Outcome> {
  const inbound = ctx.deps.inbound?.();
  if (!inbound) return { error: "incoming messages are not available on this server." };
  const bots = await owned(ctx);
  const botName = (id: string) => bots.find((b) => b.id === id)?.name ?? id;
  const routes = await inbound.listRoutes(ctx.actor);
  if (a.action === "list")
    return {
      read: `inbound_route.list:\n${JSON.stringify(routes.map((r) => ({ plugin: r.pluginId, bot: botName(r.botId), enabled: r.enabled, filter: r.filter, everySeconds: r.pollEverySeconds })))}`,
    };
  if (a.action === "poll_now") {
    const r = routes.find((x) => x.pluginId === a.plugin && x.enabled);
    if (!r)
      return { error: `incoming ${a.plugin} messages are not turned on. Use zetta:inbound first.` };
    return plan(
      `Look for new ${a.plugin} messages now`,
      [
        { field: "bot", from: null, to: botName(r.botId) },
        {
          field: "poll",
          from: null,
          to: "reads the channel once and delivers new messages to the bot",
        },
      ],
      { tool: "inbound_route", op: "poll", routeId: r.id },
    );
  }
  const b = pick(bots, a.bot, (x) => x.name, "bot");
  if ("error" in b) return b;
  const r = routes.find((x) => x.pluginId === a.plugin && x.botId === b.hit.id);
  if (!r?.enabled)
    return {
      error: `incoming ${a.plugin} messages are not turned on for ${b.hit.name}. Use zetta:inbound first.`,
    };
  if (r.pollEverySeconds === a.seconds)
    return { error: `it already looks every ${a.seconds} seconds.` };
  return plan(
    `Look for ${a.plugin} messages every ${a.seconds} seconds`,
    [
      { field: "bot", from: null, to: b.hit.name },
      { field: "every (seconds)", from: r.pollEverySeconds, to: a.seconds },
    ],
    {
      tool: "inbound_route",
      op: "interval",
      botId: b.hit.id,
      plugin: a.plugin,
      seconds: a.seconds,
      filter: r.filter,
    },
  );
}
export async function applyInboundRoute(
  ctx: ApplyCtx,
  p: Record<string, unknown>,
): Promise<Applied> {
  const inbound = ctx.deps.inbound?.();
  if (!inbound) throw new Error("inbound unavailable");
  const v = p as {
    op: string;
    routeId: string;
    botId: string;
    plugin: string;
    seconds: number;
    filter: never;
  };
  if (v.op === "poll") await inbound.pollNow(ctx.actor, v.routeId);
  else
    await inbound.setRoute(ctx.actor, v.botId, v.plugin, {
      enabled: true,
      filter: v.filter,
      pollEverySeconds: v.seconds,
    });
}
