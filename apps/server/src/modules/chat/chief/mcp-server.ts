import { owned } from "./bot";
import { pick, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

/**
 * MCP servers: add (a public http address, no keys: a server that needs a key is added from its page), bind to a bot, narrow the tools a
 * bot may call. A bot that gets a server can send it data, so every action is a card.
 */
export async function runMcpServer(ctx: ChiefCtx, a: ChiefArgs<"mcp_server">): Promise<Outcome> {
  const mcp = ctx.deps.mcp;
  if (!mcp) return { error: "MCP servers are not available on this server." };
  const servers = await mcp.listServers(ctx.actor);
  if (a.action === "list") {
    const bots = await owned(ctx);
    const bound = await Promise.all(
      bots.map(async (b) => ({
        bot: b.name,
        servers: (await mcp.bound(ctx.actor, b.id)).map((s) => s.name),
      })),
    );
    return { read: `mcp_server.list:\n${JSON.stringify({ servers, onForBot: bound })}` };
  }
  if (a.action === "add") {
    if (servers.some((s) => s.name === a.name))
      return { error: `a server called "${a.name}" already exists.` };
    return plan(
      `Add MCP server ${a.name}`,
      [
        { field: "name", from: null, to: a.name },
        { field: "address", from: null, to: a.url },
        {
          field: "note",
          from: null,
          to: "Bots can send data to this address once you connect it to them.",
        },
      ],
      { tool: "mcp_server", op: "add", name: a.name, url: a.url },
    );
  }
  const s = pick(servers, a.server, (x) => x.name, "MCP server");
  if ("error" in s) return s;
  if (a.action === "remove")
    return plan(
      `Remove MCP server ${s.hit.name}`,
      [{ field: "remove server", from: s.hit.name, to: "removed; bots lose it" }],
      { tool: "mcp_server", op: "remove", id: s.hit.id },
    );
  const b = pick(await owned(ctx), a.bot, (x) => x.name, "bot");
  if ("error" in b) return b;
  const base = [
    { field: "bot", from: null, to: b.hit.name },
    { field: "server", from: null, to: s.hit.name },
  ];
  const bound = (await mcp.bound(ctx.actor, b.hit.id)).some((x) => x.id === s.hit.id);
  if (a.action === "bind" || a.action === "unbind") {
    const on = a.action === "bind";
    if (bound === on)
      return {
        error: `${s.hit.name} is already ${on ? "connected to" : "off for"} ${b.hit.name}.`,
      };
    return plan(
      `${on ? "Connect" : "Disconnect"} ${s.hit.name} ${on ? "to" : "from"} ${b.hit.name}`,
      [...base, { field: "access", from: on ? "off" : "on", to: on ? "on" : "off" }],
      { tool: "mcp_server", op: on ? "bind" : "unbind", botId: b.hit.id, serverId: s.hit.id },
    );
  }
  if (!bound)
    return { error: `${s.hit.name} is not connected to ${b.hit.name}. Connect it first.` };
  if (a.mode === "selected" && !a.allow.length)
    return { error: 'mode "selected" needs the tool names in "allow".' };
  return plan(
    `Limit the tools ${b.hit.name} may use on ${s.hit.name}`,
    [
      ...base,
      { field: "tools", from: null, to: a.mode === "all" ? "all tools" : a.allow.join(", ") },
    ],
    {
      tool: "mcp_server",
      op: "tools",
      botId: b.hit.id,
      serverId: s.hit.id,
      mode: a.mode,
      allow: a.allow,
    },
  );
}

export async function applyMcpServer(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const mcp = ctx.deps.mcp;
  if (!mcp) throw new Error("mcp unavailable");
  const v = p as {
    op: string;
    id: string;
    name: string;
    url: string;
    botId: string;
    serverId: string;
    mode: "all" | "selected";
    allow: string[];
  };
  if (v.op === "add")
    await mcp.addServer(ctx.actor, { name: v.name, transport: "http", url: v.url });
  else if (v.op === "remove") await mcp.removeServer(ctx.actor, v.id);
  else if (v.op === "bind") await mcp.bind(ctx.actor, v.botId, v.serverId);
  else if (v.op === "unbind") await mcp.unbind(ctx.actor, v.botId, v.serverId);
  else
    await mcp.setToolAccess(ctx.actor, v.botId, v.serverId, {
      toolsMode: v.mode,
      allowedTools: v.allow,
    });
}
