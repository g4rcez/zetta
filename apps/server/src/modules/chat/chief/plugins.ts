import { owned } from "./bot";
import { pick, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

/** Switch a plugin on or off for a bot, disconnect or remove it. Installing, configuring and signing in stay with zetta:setup: the user types the keys. */
export async function runPlugins(ctx: ChiefCtx, a: ChiefArgs<"plugins">): Promise<Outcome> {
  const plugins = ctx.deps.mcp?.plugins;
  if (!plugins) return { error: "plugins are not available on this server." };
  const installed = await plugins.list(ctx.actor);
  const catalog = plugins.catalog();
  if (a.action === "list") {
    const bots = await owned(ctx);
    const bound = await Promise.all(
      bots.map(async (b) => ({ bot: b.name, plugins: await plugins.bindings(ctx.actor, b.id) })),
    );
    return {
      read: `plugins.list:\n${JSON.stringify({ available: catalog.map((p) => ({ id: p.id, name: p.name })), installed: [...new Set(installed.map((i) => i.id))], onForBot: bound })}\nInstall or sign in with zetta:setup; this tool only switches installed plugins on or off.`,
    };
  }
  const found = pick(
    catalog.map((p) => ({ ...p, id: p.id })),
    a.plugin,
    (p) => p.name,
    "plugin",
  );
  if ("error" in found) return found;
  const id = found.hit.id;
  if (!installed.some((i) => i.id === id))
    return {
      error: `${found.hit.name} is not installed. Open a setup card with zetta:setup first.`,
    };
  if (a.action === "test") {
    const r = await plugins.test(ctx.actor, id);
    return {
      read: `plugins.test ${found.hit.name}: ${JSON.stringify({ status: r.status, tools: r.tools.map((t) => t.name) })}`,
    };
  }
  if (a.action === "bind" || a.action === "unbind") {
    const b = pick(await owned(ctx), a.bot, (x) => x.name, "bot");
    if ("error" in b) return b;
    const on = a.action === "bind";
    if ((await plugins.bindings(ctx.actor, b.hit.id)).includes(id) === on)
      return { error: `${found.hit.name} is already ${on ? "on" : "off"} for ${b.hit.name}.` };
    return plan(
      `${on ? "Turn on" : "Turn off"} ${found.hit.name} for ${b.hit.name}`,
      [
        { field: "bot", from: null, to: b.hit.name },
        { field: "plugin", from: on ? "off" : "on", to: on ? "on" : "off" },
        { field: "plugin name", from: null, to: found.hit.name },
      ],
      { tool: "plugins", op: "bind", botId: b.hit.id, plugin: id, on },
    );
  }
  const remove = a.action === "uninstall";
  return plan(
    `${remove ? "Uninstall" : "Disconnect"} ${found.hit.name}`,
    [
      {
        field: remove ? "uninstall" : "disconnect",
        from: found.hit.name,
        to: remove ? "removed with its saved keys" : "signed out; the install stays",
      },
    ],
    { tool: "plugins", op: remove ? "uninstall" : "disconnect", plugin: id },
  );
}

export async function applyPlugins(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const plugins = ctx.deps.mcp?.plugins;
  if (!plugins) throw new Error("plugins unavailable");
  const v = p as { op: string; botId: string; plugin: string; on: boolean };
  if (v.op === "bind") await plugins.setBinding(ctx.actor, v.botId, v.plugin, v.on);
  else if (v.op === "uninstall") await plugins.uninstall(ctx.actor, v.plugin);
  else await plugins.disconnect(ctx.actor, v.plugin);
}
