import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { botIntegration, mcpServer } from "@zetta/db/schema/features";
import { assertPublicUrl, ComputerError } from "../computer/service";
import type { ConnectionsService } from "../connections/service";
import { audit } from "../features/audit";
import { AccessError, type ActiveActor } from "../identity/access";

export class McpError extends Error { constructor(readonly code: "STDIO_NOT_ALLOWED" | "BLOCKED_URL" | "NOT_BOUND" | "TIMEOUT" | "FAILED" | "INVALID") { super(code); } }
type Server = typeof mcpServer.$inferSelect;
export type McpConnect = (server: Server, authorization?: string) => Promise<Transport>;
const CALL_MS = 20_000, MAX_TEXT = 8000;

/** An allowlisted stdio server is a COMPLETE argv chosen by the administrator; users can only pick one, never supply arguments. */
export type StdioEntry = { command: string; args: string[] };
export type McpOptions = { callMs?: number; allowPrivate?: boolean; stdioAllowlist?: StdioEntry[]; connect?: McpConnect };
/** ZETTA_MCP_ALLOWLIST: entries separated by `;`, each a space-separated argv (no shell), e.g. `/usr/bin/npx -y chrome-devtools-mcp@latest --headless`. */
export const parseAllowlist = (raw = process.env.ZETTA_MCP_ALLOWLIST ?? ""): StdioEntry[] => raw.split(";").map((e) => e.trim().split(/\s+/).filter(Boolean)).filter((a) => a.length > 0).map(([command, ...args]) => ({ command: command!, args }));

/** Production transports: streamable HTTP (public addresses only) or an administrator-allowlisted local command with a minimal environment. */
const defaultConnect: McpConnect = async (s, authorization) => {
  if (s.transport === "http") return new StreamableHTTPClientTransport(new URL(s.url!), { requestInit: { redirect: "error", ...(authorization ? { headers: { Authorization: authorization } } : {}) } });
  // Neutral working directory: package managers must not pick up the server's own workspace configuration.
  return new StdioClientTransport({ command: s.command!, args: s.args, cwd: tmpdir(), env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }, stderr: "ignore" });
};

/**
 * MCP integration (RFC-042/043/044). Servers belong to one user and are bound to bots per user. Every operation opens a fresh
 * session, applies a deadline, and always closes it. Local stdio servers run only for commands the administrator allowlisted
 * (ZETTA_MCP_ALLOWLIST); HTTP servers must be public addresses. Secrets come from the sealed connection store at call time.
 */
export function createMcp(db: Database, connections?: ConnectionsService, opts: McpOptions = {}) {
  const allow = opts.stdioAllowlist ?? parseAllowlist();
  const connect = opts.connect ?? defaultConnect;
  const owned = async (a: ActiveActor, id: string) => { const [s] = await db.select().from(mcpServer).where(and(eq(mcpServer.id, id), eq(mcpServer.ownerUserId, a.userId))); if (!s) throw new AccessError("NOT_FOUND"); return s; };

  /** Opens one connected session (credentials resolved now). The caller must close it. */
  async function openSession(a: ActiveActor, s: Server) {
    let auth: string | undefined;
    if (s.connectionId) {
      const secret = connections ? await connections.secretFor(a, s.connectionId).catch(() => undefined) : undefined;
      if (!secret) throw new McpError("FAILED");
      auth = `Bearer ${secret.toString("utf8")}`; secret.fill(0);
    }
    // Re-validate the address at call time (the registration-time check can be outdated by a DNS change).
    if (s.transport === "http" && !opts.allowPrivate) await assertPublicUrl(s.url!).catch(() => { throw new McpError("BLOCKED_URL"); });
    const client = new Client({ name: "zetta", version: "1" });
    const transport = await connect(s, auth);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new McpError("TIMEOUT")), opts.callMs ?? CALL_MS); });
      await Promise.race([client.connect(transport), deadline]);
    } catch (e) { await client.close().catch(() => {}); await transport.close().catch(() => {}); throw e instanceof McpError ? e : new McpError("FAILED"); }
    finally { if (timer) clearTimeout(timer); }
    return { client, close: async () => { await client.close().catch(() => {}); await transport.close().catch(() => {}); } };
  }
  async function callWith(client: Client, tool: string, args: Record<string, unknown>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new McpError("TIMEOUT")), opts.callMs ?? CALL_MS); });
      return await Promise.race([client.callTool({ name: tool, arguments: args }), deadline]);
    } catch (e) { throw e instanceof McpError ? e : new McpError("FAILED"); } finally { if (timer) clearTimeout(timer); }
  }
  async function withClient<T>(a: ActiveActor, s: Server, work: (c: Client) => Promise<T>): Promise<T> {
    let auth: string | undefined;
    if (s.connectionId) {
      // Fails closed: a revoked/missing connection means the call does not happen, and no other credential is tried.
      const secret = connections ? await connections.secretFor(a, s.connectionId).catch(() => undefined) : undefined;
      if (!secret) throw new McpError("FAILED");
      auth = `Bearer ${secret.toString("utf8")}`; secret.fill(0);
    }
    const client = new Client({ name: "zetta", version: "1" });
    const transport = await connect(s, auth);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new McpError("TIMEOUT")), opts.callMs ?? CALL_MS); });
      return await Promise.race([(async () => { await client.connect(transport); return work(client); })(), deadline]);
    } catch (e) { throw e instanceof McpError ? e : new McpError("FAILED"); }
    finally { if (timer) clearTimeout(timer); await client.close().catch(() => {}); await transport.close().catch(() => {}); }
  }
  const text = (r: unknown) => {
    const content = (r as { content?: { type: string; text?: string }[] }).content ?? [];
    return content.map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`)).join("\n").slice(0, MAX_TEXT);
  };

  return {
    async addServer(a: ActiveActor, v: { name: string; transport: "http" | "stdio"; url?: string; command?: string; args?: string[]; connectionId?: string }) {
      if (v.transport === "http") {
        if (!v.url) throw new McpError("INVALID");
        if (!opts.allowPrivate) await assertPublicUrl(v.url).catch((e) => { throw e instanceof ComputerError ? new McpError("BLOCKED_URL") : e; });
      } else if (!v.command || !allow.some((e) => e.command === v.command && JSON.stringify(e.args) === JSON.stringify(v.args ?? []))) throw new McpError("STDIO_NOT_ALLOWED");
      const [row] = await db.insert(mcpServer).values({ ownerUserId: a.userId, name: v.name, transport: v.transport, url: v.url ?? null, command: v.command ?? null, args: v.args ?? [], connectionId: v.connectionId ?? null }).returning();
      return { id: row!.id, name: row!.name, transport: row!.transport };
    },
    async listServers(a: ActiveActor) { return (await db.select().from(mcpServer).where(eq(mcpServer.ownerUserId, a.userId))).map((s) => ({ id: s.id, name: s.name, transport: s.transport, hasConnection: Boolean(s.connectionId) })); },
    async removeServer(a: ActiveActor, id: string) {
      await owned(a, id);
      await db.delete(botIntegration).where(and(eq(botIntegration.serverId, id), eq(botIntegration.ownerUserId, a.userId)));
      await db.delete(mcpServer).where(and(eq(mcpServer.id, id), eq(mcpServer.ownerUserId, a.userId)));
      return { id };
    },
    async bind(a: ActiveActor, botId: string, serverId: string) {
      const [b] = await db.select().from(bot).where(and(eq(bot.id, botId), eq(bot.archived, false)));
      if (!b || (b.ownerUserId !== a.userId && b.visibility !== "team")) throw new AccessError("NOT_FOUND");
      await owned(a, serverId);
      await db.insert(botIntegration).values({ botId, ownerUserId: a.userId, serverId }).onConflictDoNothing();
      return { botId, serverId };
    },
    async unbind(a: ActiveActor, botId: string, serverId: string) { await db.delete(botIntegration).where(and(eq(botIntegration.botId, botId), eq(botIntegration.ownerUserId, a.userId), eq(botIntegration.serverId, serverId))); return { botId, serverId }; },
    async bound(a: ActiveActor, botId: string) {
      const rows = await db.select({ s: mcpServer }).from(botIntegration).innerJoin(mcpServer, eq(mcpServer.id, botIntegration.serverId)).where(and(eq(botIntegration.botId, botId), eq(botIntegration.ownerUserId, a.userId)));
      return rows.map((r) => ({ id: r.s.id, name: r.s.name }));
    },
    /** Tool catalogue of one of the user's servers (opens and closes a session). */
    async tools(a: ActiveActor, serverId: string) {
      const s = await owned(a, serverId);
      return withClient(a, s, async (c) => (await c.listTools()).tools.map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 300) })));
    },
    /**
     * A scope keeps sessions open across the tool calls of ONE chat turn (stateful servers such as a browser need that), then closes
     * them all. Bindings and ownership are checked on every call, exactly as in `callTool`.
     */
    openScope(a: ActiveActor) {
      const sessions = new Map<string, Awaited<ReturnType<typeof openSession>>>();
      return {
        callTool: async (botId: string, serverName: string, tool: string, args: Record<string, unknown>) => {
          const hit = (await this.bound(a, botId)).find((b) => b.name === serverName);
          if (!hit) throw new McpError("NOT_BOUND");
          const srv = await owned(a, hit.id);
          try {
            let sess = sessions.get(srv.id);
            if (!sess) { sess = await openSession(a, srv); sessions.set(srv.id, sess); }
            const out = text(await callWith(sess.client, tool, args));
            await audit(db, a.userId, { kind: "tool_call", botId, outcome: "ok", detail: "mcp" });
            return out;
          } catch (e) { await audit(db, a.userId, { kind: "tool_call", botId, outcome: e instanceof McpError && e.code === "TIMEOUT" ? "timeout" : "failed", detail: "mcp" }); throw e; }
        },
        close: async () => { await Promise.all([...sessions.values()].map((x) => x.close())); sessions.clear(); },
      };
    },
    /** Calls one tool for a bot. Requires the bot↔server binding of THIS user; ownership of the server is re-checked on every call. */
    async callTool(a: ActiveActor, botId: string, serverName: string, tool: string, args: Record<string, unknown>) {
      const bound = await this.bound(a, botId);
      const hit = bound.find((b) => b.name === serverName);
      if (!hit) throw new McpError("NOT_BOUND");
      const s = await owned(a, hit.id);
      try {
        const out = await withClient(a, s, async (c) => text(await c.callTool({ name: tool, arguments: args })));
        await audit(db, a.userId, { kind: "tool_call", botId, outcome: "ok", detail: "mcp" });
        return out;
      } catch (e) { await audit(db, a.userId, { kind: "tool_call", botId, outcome: e instanceof McpError && e.code === "TIMEOUT" ? "timeout" : "failed", detail: "mcp" }); throw e; }
    },
  };
}
export type Mcp = ReturnType<typeof createMcp>;
