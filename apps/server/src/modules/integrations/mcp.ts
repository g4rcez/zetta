import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Database } from "@zetta/db";
import { and, eq, ne } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { botIntegration, mcpServer } from "@zetta/db/schema/features";
import { assertPublicUrl, ComputerError } from "../computer/service";
import type { ConnectionsService } from "../connections/service";
import { audit, auditToolDetail } from "../features/audit";
import type { McpRun } from "../chat/harness";
import { AccessError, type ActiveActor } from "../identity/access";
import { catalogStdio } from "./plugins/catalog";
import { getPlugin } from "./plugins/registry";
import { toolAllowed } from "./tool-access";
import { configureWhatsapp } from "./plugins/whatsapp"; // importing registers the plugin
import "./plugins/google"; // importing registers the plugin
import "./plugins/telegram"; // importing registers the plugin
import "./plugins/reddit"; // importing registers the plugin
import "./plugins/composio"; // importing registers the plugin
import "../bot-database/plugin"; // importing registers the built-in bot database
import { configureVault } from "./plugins/vault"; // importing registers 1Password and Bitwarden
import {
  createPlugins,
  NATIVE_URL_PREFIX,
  pickBinding,
  type McpCore,
  type Scope,
} from "./plugins/service";

export class McpError extends Error {
  constructor(
    readonly code:
      | "STDIO_NOT_ALLOWED"
      | "BLOCKED_URL"
      | "NOT_BOUND"
      | "TOOL_NOT_ALLOWED"
      | "TIMEOUT"
      | "FAILED"
      | "INVALID",
  ) {
    super(code);
  }
}
type Server = typeof mcpServer.$inferSelect;
export type McpConnect = (server: Server, authorization?: string) => Promise<Transport>;
const CALL_MS = 20_000,
  MAX_TEXT = 8000;

/** An allowlisted stdio server is a COMPLETE argv chosen by the administrator; users can only pick one, never supply arguments. */
export type StdioEntry = { command: string; args: string[] };
export type McpOptions = {
  callMs?: number;
  allowPrivate?: boolean;
  stdioAllowlist?: StdioEntry[];
  connect?: McpConnect;
  /** Lets members, not only the administrator, run local (stdio) servers. Default: ZETTA_MCP_MEMBER_STDIO=1. */
  memberStdio?: boolean;
};
/** ZETTA_MCP_ALLOWLIST: entries separated by `;`, each a space-separated argv (no shell), e.g. `/usr/bin/npx -y chrome-devtools-mcp@latest --headless`. */
export const parseAllowlist = (raw = process.env.ZETTA_MCP_ALLOWLIST ?? ""): StdioEntry[] =>
  raw
    .split(";")
    .map((e) => e.trim().split(/\s+/).filter(Boolean))
    .filter((a) => a.length > 0)
    .map(([command, ...args]) => ({ command: command!, args }));

/** Production transports: streamable HTTP (public addresses only) or an administrator-allowlisted local command with a minimal environment. */
const defaultConnect: McpConnect = async (s, authorization) => {
  if (s.transport === "http")
    return new StreamableHTTPClientTransport(new URL(s.url!), {
      requestInit: {
        redirect: "error",
        ...(authorization ? { headers: { Authorization: authorization } } : {}),
      },
    });
  // Neutral working directory: package managers must not pick up the server's own workspace configuration.
  return new StdioClientTransport({
    command: s.command!,
    args: s.args,
    cwd: tmpdir(),
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    stderr: "ignore",
  });
};

/**
 * MCP integration (RFC-042/043/044). Servers belong to one user and are bound to bots per user. Every operation opens a fresh
 * session, applies a deadline, and always closes it. Local stdio servers run only for commands the administrator allowlisted
 * (ZETTA_MCP_ALLOWLIST); HTTP servers must be public addresses. Secrets come from the sealed connection store at call time.
 */
export function createMcp(db: Database, connections?: ConnectionsService, opts: McpOptions = {}) {
  // Catalog entries are the only built-in local commands; the administrator may add more with ZETTA_MCP_ALLOWLIST.
  const allow = opts.stdioAllowlist ?? [...catalogStdio(), ...parseAllowlist()];
  const connect = opts.connect ?? defaultConnect;
  // A local server is a process on the host with the server's OS user (browsers that can reach the host network and files), outside the
  // address policy. Only the administrator who runs the server may use one, unless they open it to members.
  const memberStdio = opts.memberStdio ?? process.env.ZETTA_MCP_MEMBER_STDIO === "1";
  const stdioOk = (a: ActiveActor) => a.isAdmin || memberStdio;
  /** A server the user may change: their own, or the team's when they are the administrator. */
  const owned = async (a: ActiveActor, id: string) => {
    const [s] = await db.select().from(mcpServer).where(eq(mcpServer.id, id));
    if (!s || !(s.sharing === "team" ? a.isAdmin : s.ownerUserId === a.userId))
      throw new AccessError("NOT_FOUND");
    return s;
  };

  /** A server the user may use: their own, or the workspace's team configuration. */
  const visible = async (a: ActiveActor, id: string) => {
    const [s] = await db.select().from(mcpServer).where(eq(mcpServer.id, id));
    if (!s || !(s.sharing === "team" || s.ownerUserId === a.userId))
      throw new AccessError("NOT_FOUND");
    return s;
  };
  /** Whose sealed secret a server uses: a team configuration's secret belongs to its owner, whoever calls it. */
  const secretOwner = (a: ActiveActor, s: Server): ActiveActor =>
    s.sharing === "team" && s.ownerUserId !== a.userId
      ? { userId: s.ownerUserId, isAdmin: false }
      : a;

  /** Opens one connected session (credentials resolved now). The caller must close it. */
  async function openSession(a: ActiveActor, s: Server) {
    if (s.url?.startsWith(NATIVE_URL_PREFIX)) throw new McpError("INVALID"); // in-process plugins have no MCP session
    // A team server was added by the administrator, who chose to let members use it.
    if (s.transport === "stdio" && s.sharing !== "team" && !stdioOk(a))
      throw new McpError("STDIO_NOT_ALLOWED");
    let auth: string | undefined;
    if (s.connectionId) {
      const secret = connections
        ? await connections.secretFor(secretOwner(a, s), s.connectionId).catch(() => undefined)
        : undefined;
      if (!secret) throw new McpError("FAILED");
      auth = `Bearer ${secret.toString("utf8")}`;
      secret.fill(0);
    }
    // Re-validate the address at call time (the registration-time check can be outdated by a DNS change).
    if (s.transport === "http" && !opts.allowPrivate)
      await assertPublicUrl(s.url!).catch(() => {
        throw new McpError("BLOCKED_URL");
      });
    const client = new Client({ name: "zetta", version: "1" });
    const transport = await connect(s, auth);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new McpError("TIMEOUT")), opts.callMs ?? CALL_MS);
      });
      await Promise.race([client.connect(transport), deadline]);
    } catch (e) {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      throw e instanceof McpError ? e : new McpError("FAILED");
    } finally {
      if (timer) clearTimeout(timer);
    }
    return {
      client,
      close: async () => {
        await client.close().catch(() => {});
        await transport.close().catch(() => {});
      },
    };
  }
  async function callWith(client: Client, tool: string, args: Record<string, unknown>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new McpError("TIMEOUT")), opts.callMs ?? CALL_MS);
      });
      return await Promise.race([client.callTool({ name: tool, arguments: args }), deadline]);
    } catch (e) {
      throw e instanceof McpError ? e : new McpError("FAILED");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async function withClient<T>(
    a: ActiveActor,
    s: Server,
    work: (c: Client) => Promise<T>,
  ): Promise<T> {
    if (s.url?.startsWith(NATIVE_URL_PREFIX)) throw new McpError("INVALID");
    // A team server was added by the administrator, who chose to let members use it.
    if (s.transport === "stdio" && s.sharing !== "team" && !stdioOk(a))
      throw new McpError("STDIO_NOT_ALLOWED");
    let auth: string | undefined;
    if (s.connectionId) {
      // Fails closed: a revoked/missing connection means the call does not happen, and no other credential is tried.
      const secret = connections
        ? await connections.secretFor(secretOwner(a, s), s.connectionId).catch(() => undefined)
        : undefined;
      if (!secret) throw new McpError("FAILED");
      auth = `Bearer ${secret.toString("utf8")}`;
      secret.fill(0);
    }
    if (s.transport === "http" && !opts.allowPrivate)
      await assertPublicUrl(s.url!).catch(() => {
        throw new McpError("BLOCKED_URL");
      });
    const client = new Client({ name: "zetta", version: "1" });
    const transport = await connect(s, auth);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new McpError("TIMEOUT")), opts.callMs ?? CALL_MS);
      });
      return await Promise.race([
        (async () => {
          await client.connect(transport);
          return work(client);
        })(),
        deadline,
      ]);
    } catch (e) {
      throw e instanceof McpError ? e : new McpError("FAILED");
    } finally {
      if (timer) clearTimeout(timer);
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }
  }
  const text = (r: unknown) => {
    const content = (r as { content?: { type: string; text?: string }[] }).content ?? [];
    return content
      .map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`))
      .join("\n")
      .slice(0, MAX_TEXT);
  };

  const boundRows = (a: ActiveActor, botId: string) =>
    db
      .select({ s: mcpServer, i: botIntegration })
      .from(botIntegration)
      .innerJoin(mcpServer, eq(mcpServer.id, botIntegration.serverId))
      .where(and(eq(botIntegration.botId, botId), eq(botIntegration.ownerUserId, a.userId)));

  let core!: McpCore;
  configureWhatsapp({ allowPrivate: opts.allowPrivate }); // same private-address policy as MCP servers
  configureVault({ allowPrivate: Boolean(opts.allowPrivate) }); // 1Password Connect servers follow it too
  const plugins = createPlugins(db, connections, () => core);
  const api = {
    async addServer(
      a: ActiveActor,
      v: {
        name: string;
        transport: "http" | "stdio";
        url?: string;
        command?: string;
        args?: string[];
        connectionId?: string;
        sharing?: Scope;
      },
    ) {
      if (v.transport === "http") {
        if (!v.url) throw new McpError("INVALID");
        if (!opts.allowPrivate)
          await assertPublicUrl(v.url).catch((e) => {
            throw e instanceof ComputerError ? new McpError("BLOCKED_URL") : e;
          });
      } else if (
        !stdioOk(a) ||
        !v.command ||
        !allow.some(
          (e) => e.command === v.command && JSON.stringify(e.args) === JSON.stringify(v.args ?? []),
        )
      )
        throw new McpError("STDIO_NOT_ALLOWED");
      const [row] = await db
        .insert(mcpServer)
        .values({
          ownerUserId: a.userId,
          name: v.name,
          transport: v.transport,
          url: v.url ?? null,
          command: v.command ?? null,
          args: v.args ?? [],
          connectionId: v.connectionId ?? null,
          sharing: v.sharing === "team" ? "team" : "private",
        })
        .returning();
      return { id: row!.id, name: row!.name, transport: row!.transport };
    },
    async listServers(a: ActiveActor) {
      return (await db.select().from(mcpServer).where(eq(mcpServer.ownerUserId, a.userId))).map(
        (s) => ({
          id: s.id,
          name: s.name,
          transport: s.transport,
          hasConnection: Boolean(s.connectionId),
        }),
      );
    },
    async removeServer(a: ActiveActor, id: string) {
      await owned(a, id);
      // Members' bindings of a team server go with it.
      await db.delete(botIntegration).where(eq(botIntegration.serverId, id));
      await db.delete(mcpServer).where(eq(mcpServer.id, id));
      return { id };
    },
    async bind(a: ActiveActor, botId: string, serverId: string) {
      const [b] = await db
        .select()
        .from(bot)
        .where(and(eq(bot.id, botId), eq(bot.archived, false)));
      if (!b || (b.ownerUserId !== a.userId && b.visibility !== "team"))
        throw new AccessError("NOT_FOUND");
      const server = await visible(a, serverId);
      // One server per name, scope and bot: a bot may hold a private and the team configuration of a plugin, never two of the same kind.
      const same = await db
        .select({ id: botIntegration.id })
        .from(botIntegration)
        .innerJoin(mcpServer, eq(mcpServer.id, botIntegration.serverId))
        .where(
          and(
            eq(botIntegration.botId, botId),
            eq(botIntegration.ownerUserId, a.userId),
            eq(mcpServer.name, server.name),
            eq(mcpServer.sharing, server.sharing),
            ne(mcpServer.id, serverId),
          ),
        );
      for (const row of same) await db.delete(botIntegration).where(eq(botIntegration.id, row.id));
      await db
        .insert(botIntegration)
        .values({ botId, ownerUserId: a.userId, serverId })
        .onConflictDoNothing();
      return { botId, serverId };
    },
    async unbind(a: ActiveActor, botId: string, serverId: string) {
      await db
        .delete(botIntegration)
        .where(
          and(
            eq(botIntegration.botId, botId),
            eq(botIntegration.ownerUserId, a.userId),
            eq(botIntegration.serverId, serverId),
          ),
        );
      return { botId, serverId };
    },
    async bound(a: ActiveActor, botId: string) {
      const rows = await boundRows(a, botId);
      return rows.map((r) => ({
        id: r.s.id,
        name: r.s.name,
        toolsMode: r.i.toolsMode,
        allowedTools: r.i.allowedTools,
        tools: r.s.tools,
        ownerUserId: r.s.ownerUserId,
        sharing: r.s.sharing,
      }));
    },
    /**
     * For a Claude Code run: this user's remote (http) servers bound to the bot, as CLI config plus allow rules, and the environment
     * variables that hold their tokens. A server whose token cannot be read, or that has no allowed tool, is left out (fail closed).
     * Stdio servers and in-process plugins stay on the zetta:mcp / zetta:plugin path.
     */
    async runConfig(
      a: ActiveActor,
      botId: string,
    ): Promise<{ mcp?: McpRun; env: Record<string, string> }> {
      const servers: McpRun["servers"] = {};
      const allow: string[] = [];
      const env: Record<string, string> = {};
      // DNS check and secret read run for all servers at once; the config is then assembled in bound order so token names stay stable.
      const ready = await Promise.all(
        (await boundRows(a, botId)).map(async ({ s, i }) => {
          if (s.transport !== "http" || !s.url || s.url.startsWith(NATIVE_URL_PREFIX))
            return undefined;
          if (i.toolsMode === "selected" && !i.allowedTools.length) return undefined;
          if (
            !opts.allowPrivate &&
            !(await assertPublicUrl(s.url).then(
              () => true,
              () => false,
            ))
          )
            return undefined;
          if (!s.connectionId) return { s, i, url: s.url, secret: undefined };
          const secret = connections
            ? await connections.secretFor(secretOwner(a, s), s.connectionId).catch(() => undefined)
            : undefined;
          return secret ? { s, i, url: s.url, secret } : undefined;
        }),
      );
      for (const r of ready) {
        if (!r) continue;
        const { s, i, url, secret } = r;
        let headers: Record<string, string> | undefined;
        if (secret) {
          const key = `ZETTA_MCP_TOKEN_${Object.keys(env).length}`;
          env[key] = secret.toString("utf8");
          secret.fill(0);
          headers = { Authorization: `Bearer \${${key}}` };
        }
        // The team configuration of a server gets its own name, so it never collides with the user's private one.
        const name = s.sharing === "team" ? `${s.name}-team` : s.name;
        servers[name] = { type: "http", url, ...(headers ? { headers } : {}) };
        allow.push(
          ...(i.toolsMode === "all"
            ? [`mcp__${name}`]
            : i.allowedTools.map((t) => `mcp__${name}__${t}`)),
        );
      }
      return Object.keys(servers).length ? { mcp: { servers, allow }, env } : { env };
    },
    /** The tools one bound server offers this bot: its catalogue plus the bot's current choice. Native plugins list theirs from the registry. */
    async toolAccess(a: ActiveActor, botId: string, serverId: string) {
      const hit = (await this.bound(a, botId)).find((b) => b.id === serverId);
      if (!hit) throw new McpError("NOT_BOUND");
      const s = await visible(a, serverId);
      const catalogue = s.url?.startsWith(NATIVE_URL_PREFIX)
        ? (getPlugin(s.name)?.tools ?? []).map((t) => ({
            name: t.name,
            description: t.description.slice(0, 300),
          }))
        : hit.tools.length
          ? hit.tools
          : await this.tools(a, serverId);
      return { tools: catalogue, toolsMode: hit.toolsMode, allowedTools: hit.allowedTools };
    },
    /** Switches a bound server between all tools and a chosen list. Chosen names must exist in the catalogue. */
    async setToolAccess(
      a: ActiveActor,
      botId: string,
      serverId: string,
      v: { toolsMode: "all" | "selected"; allowedTools: string[] },
    ) {
      const known = new Set((await this.toolAccess(a, botId, serverId)).tools.map((t) => t.name));
      if (v.allowedTools.some((t) => !known.has(t))) throw new McpError("INVALID");
      const allowedTools = v.toolsMode === "selected" ? [...new Set(v.allowedTools)] : [];
      await db
        .update(botIntegration)
        .set({ toolsMode: v.toolsMode, allowedTools })
        .where(
          and(
            eq(botIntegration.botId, botId),
            eq(botIntegration.ownerUserId, a.userId),
            eq(botIntegration.serverId, serverId),
          ),
        );
      return { toolsMode: v.toolsMode, allowedTools };
    },
    /** The access token of the plugin `name` the user bound to the bot, for a CLI run that needs to authenticate as that account. */
    async tokenOf(a: ActiveActor, botId: string, name: string): Promise<string | undefined> {
      const rows = await db
        .select({ c: mcpServer.connectionId, s: mcpServer })
        .from(botIntegration)
        .innerJoin(mcpServer, eq(mcpServer.id, botIntegration.serverId))
        .where(
          and(
            eq(botIntegration.botId, botId),
            eq(botIntegration.ownerUserId, a.userId),
            eq(mcpServer.name, name),
          ),
        );
      // The user's own configuration wins over the team's.
      const row = rows.find((r) => r.s.sharing === "private") ?? rows[0];
      if (!row?.c || !connections) return undefined;
      const secret = await connections
        .secretFor(secretOwner(a, row.s), row.c)
        .catch(() => undefined);
      if (!secret) return undefined;
      const token = secret.toString("utf8");
      secret.fill(0);
      return token;
    },
    /** Internal (plugins): registers an in-process plugin as the user's server row so ownership and bot bindings apply unchanged. */
    async addNative(a: ActiveActor, id: string, connectionId?: string, sharing: Scope = "mine") {
      const [row] = await db
        .insert(mcpServer)
        .values({
          ownerUserId: a.userId,
          name: id,
          transport: "http",
          url: `${NATIVE_URL_PREFIX}${id}`,
          args: [],
          connectionId: connectionId ?? null,
          sharing: sharing === "team" ? "team" : "private",
        })
        .returning();
      return { id: row!.id, name: row!.name, transport: row!.transport };
    },
    /** Internal (plugins): the user's own server row by name (`mine`) or the workspace's team configuration of it (`team`). */
    async serverByName(a: ActiveActor, name: string, scope: Scope = "mine") {
      const [s] = await db
        .select()
        .from(mcpServer)
        .where(
          scope === "team"
            ? and(eq(mcpServer.name, name), eq(mcpServer.sharing, "team"))
            : and(
                eq(mcpServer.name, name),
                eq(mcpServer.ownerUserId, a.userId),
                eq(mcpServer.sharing, "private"),
              ),
        );
      return s;
    },
    /** Internal (plugins): a server row by id, whoever owns it. The caller checks that the user may use it. */
    async serverById(id: string) {
      const [s] = await db.select().from(mcpServer).where(eq(mcpServer.id, id));
      return s;
    },
    async setConnection(a: ActiveActor, id: string, connectionId: string | null) {
      await owned(a, id);
      await db.update(mcpServer).set({ connectionId }).where(eq(mcpServer.id, id));
    },
    /** Tool catalogue of one server the user may use (opens and closes a session). */
    async tools(a: ActiveActor, serverId: string) {
      const s = await visible(a, serverId);
      const tools = await withClient(a, s, async (c) =>
        (await c.listTools()).tools.map((t) => ({
          name: t.name,
          description: (t.description ?? "").slice(0, 300),
        })),
      );
      await db.update(mcpServer).set({ tools }).where(eq(mcpServer.id, serverId));
      return tools;
    },
    /**
     * A scope keeps sessions open across the tool calls of ONE chat turn (stateful servers such as a browser need that), then closes
     * them all. Bindings and ownership are checked on every call, exactly as in `callTool`.
     */
    openScope(a: ActiveActor) {
      const sessions = new Map<string, Awaited<ReturnType<typeof openSession>>>();
      return {
        callTool: async (
          botId: string,
          serverName: string,
          tool: string,
          args: Record<string, unknown>,
          config?: Scope,
        ) => {
          const hit = pickBinding(await this.bound(a, botId), serverName, config);
          if (!hit) throw new McpError("NOT_BOUND");
          const srv = await visible(a, hit.id);
          const trail = {
            kind: "tool_call",
            botId,
            subjectId: srv.id,
            detail: auditToolDetail("mcp", tool),
          } as const;
          if (!toolAllowed(hit, tool)) {
            await audit(db, a.userId, { ...trail, outcome: "denied" });
            throw new McpError("TOOL_NOT_ALLOWED");
          }
          try {
            let sess = sessions.get(srv.id);
            if (!sess) {
              sess = await openSession(a, srv);
              sessions.set(srv.id, sess);
            }
            const out = text(await callWith(sess.client, tool, args));
            await audit(db, a.userId, { ...trail, outcome: "ok" });
            return out;
          } catch (e) {
            await audit(db, a.userId, {
              ...trail,
              outcome: e instanceof McpError && e.code === "TIMEOUT" ? "timeout" : "failed",
            });
            throw e;
          }
        },
        close: async () => {
          await Promise.all([...sessions.values()].map((x) => x.close()));
          sessions.clear();
        },
      };
    },
    /** Calls one tool for a bot. Requires the bot↔server binding of THIS user; access to the server is re-checked on every call. */
    async callTool(
      a: ActiveActor,
      botId: string,
      serverName: string,
      tool: string,
      args: Record<string, unknown>,
      config?: Scope,
    ) {
      const hit = pickBinding(await this.bound(a, botId), serverName, config);
      if (!hit) throw new McpError("NOT_BOUND");
      const s = await visible(a, hit.id);
      const trail = {
        kind: "tool_call",
        botId,
        subjectId: s.id,
        detail: auditToolDetail("mcp", tool),
      } as const;
      if (!toolAllowed(hit, tool)) {
        await audit(db, a.userId, { ...trail, outcome: "denied" });
        throw new McpError("TOOL_NOT_ALLOWED");
      }
      try {
        const out = await withClient(a, s, async (c) =>
          text(await c.callTool({ name: tool, arguments: args })),
        );
        await audit(db, a.userId, { ...trail, outcome: "ok" });
        return out;
      } catch (e) {
        await audit(db, a.userId, {
          ...trail,
          outcome: e instanceof McpError && e.code === "TIMEOUT" ? "timeout" : "failed",
        });
        throw e;
      }
    },
  };
  core = api as unknown as McpCore;
  return Object.assign(api, { plugins });
}
export type Mcp = ReturnType<typeof createMcp>;
