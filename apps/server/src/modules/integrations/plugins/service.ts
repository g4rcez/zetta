import type { Database } from "@zetta/db";
import { audit } from "../../features/audit";
import { AccessError, type ActiveActor } from "../../identity/access";
import type { ConnectionsService } from "../../connections/service";
import { getPlugin, listPlugins, PluginError, pluginMeta, type PluginContext, type PluginDef, type PluginStatus } from "./registry";

/** Native plugins are stored as a user-owned server row with this url scheme; it is never reachable as an MCP session. */
export const NATIVE_URL_PREFIX = "zetta-plugin://";
const CALL_MS = 20_000, MAX_TEXT = 8000, PROVIDER = "plugin";

type ServerRow = { id: string; name: string; url: string | null; connectionId: string | null };
/** The slice of the MCP service the plugin layer needs. */
export type McpCore = {
  addServer(a: ActiveActor, v: { name: string; transport: "http" | "stdio"; url?: string; command?: string; args?: string[]; connectionId?: string }): Promise<{ id: string }>;
  addNative(a: ActiveActor, id: string, connectionId?: string): Promise<{ id: string }>;
  serverByName(a: ActiveActor, name: string): Promise<ServerRow | undefined>;
  setConnection(a: ActiveActor, id: string, connectionId: string | null): Promise<void>;
  removeServer(a: ActiveActor, id: string): Promise<unknown>;
  bind(a: ActiveActor, botId: string, serverId: string): Promise<unknown>;
  unbind(a: ActiveActor, botId: string, serverId: string): Promise<unknown>;
  bound(a: ActiveActor, botId: string): Promise<{ id: string; name: string }[]>;
  tools(a: ActiveActor, serverId: string): Promise<{ name: string; description: string }[]>;
};

/**
 * Plugin lifecycle and execution for one user at a time. Every method takes the acting user and only ever touches that user's
 * rows, bindings and sealed secret.
 */
export function createPlugins(db: Database, connections: ConnectionsService | undefined, mcp: () => McpCore) {
  const toolNames = new Map<string, string[]>(); // serverId -> tool names seen by the last test (MCP servers only; a hint for the prompt)
  const need = () => { if (!connections?.configured()) throw new PluginError("CONNECTIONS_NOT_CONFIGURED", "Secrets storage is not configured on this server (ZETTA_CONNECTION_KEY)."); return connections; };
  const def = (id: string) => { const d = getPlugin(id); if (!d) throw new AccessError("NOT_FOUND"); return d; };
  const isNative = (d: PluginDef, s: ServerRow) => d.kind === "native" ? Boolean(s.url?.startsWith(NATIVE_URL_PREFIX)) : !s.url?.startsWith(NATIVE_URL_PREFIX);
  async function installed(a: ActiveActor, id: string) {
    const d = def(id); const s = await mcp().serverByName(a, id);
    if (!s || !isNative(d, s)) throw new AccessError("NOT_FOUND");
    return { d, s };
  }
  const seal = (d: PluginDef, config: Record<string, string>) => {
    if (d.kind === "mcp") { const key = d.mcp?.transport === "http" ? d.mcp.secretField : undefined; return key && config[key] ? config[key] : undefined; }
    const filled = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ""));
    return Object.keys(filled).length ? JSON.stringify(filled) : undefined;
  };
  async function load(a: ActiveActor, d: PluginDef, s: ServerRow): Promise<Record<string, string>> {
    if (!s.connectionId) return {};
    const buf = await need().secretFor(a, s.connectionId).catch(() => undefined);
    if (!buf) throw new PluginError("SECRET_UNAVAILABLE", "The saved credentials are no longer available. Reinstall the plugin.");
    const raw = buf.toString("utf8"); buf.fill(0);
    if (d.kind === "mcp") { const key = d.mcp?.transport === "http" ? d.mcp.secretField : undefined; return key ? { [key]: raw } : {}; }
    try { const v = JSON.parse(raw); return v && typeof v === "object" ? v as Record<string, string> : {}; } catch { return {}; }
  }
  const revokeQuietly = async (a: ActiveActor, id: string) => { try { const c = (await need().list(a)).find((x) => x.id === id); if (c) await need().revoke(a, id, c.revision); } catch { /* an already revoked secret is fine */ } };
  async function ctxFor(a: ActiveActor, d: PluginDef, s: ServerRow, preset?: Record<string, string>): Promise<PluginContext> {
    let config = preset ?? await load(a, d, s); let connectionId = s.connectionId;
    return {
      userId: a.userId, get config() { return config; },
      async setConfig(next) {
        const sealed = seal(d, next); const prev = connectionId;
        const created = sealed ? await need().create(a, { provider: PROVIDER, label: `plugin:${d.id}`, secret: sealed }) : undefined;
        await mcp().setConnection(a, s.id, created?.id ?? null); connectionId = created?.id ?? null; config = { ...next };
        if (prev) await revokeQuietly(a, prev);
      },
    } as PluginContext;
  }
  const withDeadline = async <T>(work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new PluginError("TIMEOUT", "The plugin took too long.")), CALL_MS); })]); } finally { if (timer) clearTimeout(timer); }
  };
  const render = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v) ?? "").slice(0, MAX_TEXT);

  return {
    /** Everything installable (browser-safe: no handlers). */
    catalog: () => listPlugins().map(pluginMeta),
    /** The user's installed plugins. Probing is separate (`test`). */
    async list(a: ActiveActor) {
      const out: { id: string; serverId: string; hasSecret: boolean }[] = [];
      for (const d of listPlugins()) { const s = await mcp().serverByName(a, d.id); if (s && isNative(d, s)) out.push({ id: d.id, serverId: s.id, hasSecret: Boolean(s.connectionId) }); }
      return out;
    },
    async install(a: ActiveActor, id: string, config: Record<string, string>, botIds: string[] = []) {
      const d = def(id);
      if (await mcp().serverByName(a, id)) throw new PluginError("ALREADY_INSTALLED", "That plugin is already installed.");
      const allowed = new Set(d.fields.map((f) => f.key));
      for (const k of Object.keys(config)) if (!allowed.has(k)) throw new PluginError("INVALID_FIELD", "Unknown setting.");
      const clean: Record<string, string> = {};
      for (const f of d.fields) {
        const v = (config[f.key] ?? "").trim();
        if (!v && !f.optional) throw new PluginError("MISSING_FIELD", `${f.label} is required.`);
        if (v && f.kind === "url") { try { if (!/^https?:$/.test(new URL(v).protocol)) throw 0; } catch { throw new PluginError("INVALID_FIELD", `${f.label} must be an http(s) address.`); } }
        if (v.length > 4000) throw new PluginError("INVALID_FIELD", `${f.label} is too long.`);
        if (v) clean[f.key] = v;
      }
      const sealed = seal(d, clean);
      const conn = sealed ? await need().create(a, { provider: PROVIDER, label: `plugin:${d.id}`, secret: sealed }) : undefined;
      let serverId: string | undefined;
      try {
        const t = d.mcp;
        const row = d.kind === "native" ? await mcp().addNative(a, d.id, conn?.id)
          : t?.transport === "http" ? await mcp().addServer(a, { name: d.id, transport: "http", url: t.url, ...(conn ? { connectionId: conn.id } : {}) })
          : await mcp().addServer(a, { name: d.id, transport: "stdio", command: t!.transport === "stdio" ? t!.command : "", args: t!.transport === "stdio" ? t!.args : [], ...(conn ? { connectionId: conn.id } : {}) });
        serverId = row.id;
        if (d.install) await withDeadline(d.install(await ctxFor(a, d, { id: row.id, name: d.id, url: null, connectionId: conn?.id ?? null }, clean)));
        for (const botId of botIds) await mcp().bind(a, botId, row.id);
      } catch (e) {
        if (serverId) await mcp().removeServer(a, serverId).catch(() => {});
        if (conn) await revokeQuietly(a, conn.id);
        throw e;
      }
      await audit(db, a.userId, { kind: "connection", outcome: "ok", subjectId: serverId!, detail: "plugin-installed" });
      return { id: d.id, serverId: serverId! };
    },
    async uninstall(a: ActiveActor, id: string) {
      const { d, s } = await installed(a, id);
      if (d.disconnect) await withDeadline(d.disconnect(await ctxFor(a, d, s))).catch(() => {}); // remote cleanup is best effort; local removal always proceeds
      await mcp().removeServer(a, s.id);
      if (s.connectionId) await revokeQuietly(a, s.connectionId);
      toolNames.delete(s.id);
      return { id };
    },
    /** Starts the plugin's own connect flow (e.g. OAuth). */
    async connect(a: ActiveActor, id: string, options?: Record<string, unknown>) {
      const { d, s } = await installed(a, id);
      if (!d.connect) throw new PluginError("NOT_SUPPORTED", "This plugin has nothing to connect.");
      return (await withDeadline(d.connect(await ctxFor(a, d, s), options))) ?? {};
    },
    /** OAuth redirect target: completes the flow the signed-in user started. */
    async callback(a: ActiveActor, id: string, params: URLSearchParams) {
      const { d, s } = await installed(a, id);
      if (!d.callback) throw new PluginError("NOT_SUPPORTED", "This plugin has no sign-in callback.");
      await withDeadline(d.callback(await ctxFor(a, d, s), params));
    },
    /** Revokes remote access and wipes the stored credentials, keeping the plugin installed. */
    async disconnect(a: ActiveActor, id: string) {
      const { d, s } = await installed(a, id);
      if (!d.disconnect) throw new PluginError("NOT_SUPPORTED", "This plugin has nothing to disconnect.");
      await withDeadline(d.disconnect(await ctxFor(a, d, s)));
      return { id };
    },
    /** Health check + tool list. MCP plugins connect and list tools; native plugins use `status()`. Never throws for plugin failures. */
    async test(a: ActiveActor, id: string): Promise<{ status: PluginStatus; tools: { name: string; description: string }[] }> {
      const { d, s } = await installed(a, id);
      if (d.kind === "mcp") {
        try { const tools = await mcp().tools(a, s.id); toolNames.set(s.id, tools.map((t) => t.name)); return { status: { state: "connected" }, tools }; }
        catch (e) { const code = (e as { code?: string }).code; return { status: { state: "error", detail: code === "TIMEOUT" ? "The server took too long." : code === "BLOCKED_URL" ? "That address is not allowed." : "The server could not be reached or rejected the credentials." }, tools: [] }; }
      }
      const tools = (d.tools ?? []).map((t) => ({ name: t.name, description: t.description.slice(0, 300) }));
      try { return { status: d.status ? await withDeadline(d.status(await ctxFor(a, d, s))) : { state: "connected" }, tools }; }
      catch (e) { return { status: { state: "error", detail: e instanceof PluginError ? e.safe : "The plugin could not be checked." }, tools }; }
    },
    /** Plugin ids the user has bound to this bot. */
    async bindings(a: ActiveActor, botId: string) {
      const names = new Set((await mcp().bound(a, botId)).map((b) => b.name));
      return listPlugins().filter((d) => names.has(d.id)).map((d) => d.id);
    },
    async setBinding(a: ActiveActor, botId: string, id: string, on: boolean) {
      const { s } = await installed(a, id);
      if (on) await mcp().bind(a, botId, s.id); else await mcp().unbind(a, botId, s.id);
      return { botId, id, bound: on };
    },
    /** Runs one native tool for a bot. Requires this user's binding; ownership and the stored secret are resolved on every call. */
    async callTool(a: ActiveActor, botId: string, id: string, tool: string, args: Record<string, unknown>) {
      const outcome = (o: "ok" | "failed" | "timeout") => audit(db, a.userId, { kind: "tool_call", botId, outcome: o, detail: "plugin" });
      const d = getPlugin(id);
      if (!d || d.kind !== "native" || !(await mcp().bound(a, botId)).some((b) => b.name === id)) throw new PluginError("NOT_BOUND", "That plugin is not connected to this bot.");
      const t = d.tools?.find((x) => x.name === tool);
      if (!t) throw new PluginError("UNKNOWN_TOOL", "That plugin has no such tool.");
      const missing = (t.inputSchema.required ?? []).filter((k) => args[k] === undefined);
      if (missing.length) throw new PluginError("INVALID_ARGS", `Missing: ${missing.join(", ")}`);
      try {
        const { s } = await installed(a, id);
        const out = render(await withDeadline(t.handler(await ctxFor(a, d, s), args)));
        await outcome("ok"); return out;
      } catch (e) { await outcome(e instanceof PluginError && e.code === "TIMEOUT" ? "timeout" : "failed"); throw e instanceof PluginError ? e : new PluginError("FAILED"); }
    },
    /** Prompt section describing the plugins THIS user bound to the bot (empty when none). Contains no secrets. */
    async promptFor(a: ActiveActor, botId: string): Promise<string> {
      const bound = await mcp().bound(a, botId); const lines: string[] = []; let native = false, remote = false;
      for (const d of listPlugins()) {
        const b = bound.find((x) => x.name === d.id); if (!b) continue;
        if (d.kind === "native") { native = true; lines.push(`- ${d.id} (${d.name}): ${d.description}\n${(d.tools ?? []).map((t) => `    ${t.name}: ${t.description} args ${JSON.stringify(t.inputSchema.properties ?? {})}${t.inputSchema.required?.length ? ` required ${JSON.stringify(t.inputSchema.required)}` : ""}`).join("\n")}`); }
        else { remote = true; const names = toolNames.get(b.id); lines.push(`- ${d.id} (${d.name}): ${d.description}${names?.length ? ` Tools: ${names.slice(0, 40).join(", ")}.` : ""}`); }
      }
      if (!lines.length) return "";
      return [`Plugins connected to you by this user (the user's own accounts; use only when needed):`, ...lines,
        native ? "Call a plugin tool with a fenced block:\n```zetta:plugin\n{\"plugin\":\"<id>\",\"tool\":\"<tool>\",\"args\":{}}\n```" : "",
        remote ? "Call an MCP server tool with:\n```zetta:mcp\n{\"server\":\"<id>\",\"tool\":\"<tool>\",\"args\":{}}\n```" : ""].filter(Boolean).join("\n");
    },
  };
}
export type Plugins = ReturnType<typeof createPlugins>;
