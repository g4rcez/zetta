import type { Database } from "@zetta/db";
import { audit, auditToolDetail } from "../../features/audit";
import { ghLoggedIn, harnessHome } from "../../chat/harness";
import { AccessError, type ActiveActor } from "../../identity/access";
import type { ConnectionsService } from "../../connections/service";
import { toolAllowed, type ToolAccess } from "../tool-access";
import { originAllowed } from "./credentials";
import {
  getPlugin,
  listPlugins,
  PluginError,
  pluginMeta,
  type CredentialField,
  type CredentialGrant,
  type InboundFilter,
  type PluginContext,
  type PluginDef,
  type PluginStatus,
} from "./registry";

/** Native plugins are stored as a user-owned server row with this url scheme; it is never reachable as an MCP session. */
export const NATIVE_URL_PREFIX = "zetta-plugin://";
const CALL_MS = 60_000,
  MAX_TEXT = 8000,
  PROVIDER = "plugin";
const CREDENTIAL_PROMPT = `Signing in: you never see or type passwords. Get the logins the user shared with <plugin>.list_credentials, open the sign-in page, then let Zetta type the value for you (browser: click the input first with click_text; desktop: Zetta finds the input itself):
\`\`\`zetta:credential
{"ref":"<ref from list_credentials>","field":"username|password|totp","target":"browser|desktop"}
\`\`\`   (Zetta only types it on the login's own https sites and into a matching input; you get "filled" back, never the value. Fill one field per block, username first. Then press Return or click the sign-in button yourself.)`;

/** Tells a bot which plugins it could still get and how to start a setup. The card collects every key, so the model never needs one. */
const setupPrompt = (missing: PluginDef[]) =>
  missing.length
    ? [
        `Plugins not connected to you yet: ${missing.map((d) => `${d.id} (${d.name})`).join(", ")}.`,
        `When the user wants something one of them does, or a plugin call fails because it is not set up, open a setup card instead of explaining Studio:\n\`\`\`zetta:setup\n{"plugin":"<id>"}\n\`\`\`   (Google also takes "options":{"scopes":["gmail.readonly","calendar.events.readonly","drive.readonly"]}.) The user types the keys and signs in inside the card; you never see them. NEVER ask the user to paste a token, key or password in the chat. After the card, tell the user what it asks for in one or two lines, wait for them to say it is set up, then retry the task.`,
      ].join("\n")
    : "";

/** How a bot manages a channel plugin's incoming messages. It can only read and propose: the user applies the change in a card. */
const inboundHint = (d: PluginDef) => {
  if (!d.inbound) return "";
  const editable = d.fields.filter((f) => f.botEditable && !f.secret);
  const example = JSON.stringify({
    action: "propose",
    plugin: d.id,
    incoming: "on",
    who: "direct",
    settings: Object.fromEntries(editable.slice(0, 1).map((f) => [f.key, "..."])),
  });
  return [
    `\n    Incoming ${d.inbound.label} messages (a bot answers new ones) are managed with a zetta:inbound block, never with Zetta's HTTP API or a browser.`,
    `{"action":"status","plugin":"${d.id}"} reads the state. ${example} shows the user a card with the exact change and an Apply button; nothing changes until they press it.`,
    `"incoming" is on or off, "who" is direct, groups or both, "only" lists chat ids. Settings you may propose: ${editable.map((f) => `${f.key} (${f.label})`).join(", ") || "none"}.`,
    "Keys, the address of the user's own server and sending are changed by the user in Studio.",
  ].join(" ");
};

/** `mine`: the user's own (private) configuration of a plugin. `team`: the workspace's one, edited by the administrator and used by every member. */
export type Scope = "mine" | "team";
type ServerRow = {
  id: string;
  name: string;
  url: string | null;
  connectionId: string | null;
  ownerUserId?: string;
  sharing?: "private" | "team";
};

/**
 * The binding a call uses. A bot may hold the user's own and the team's configuration of one plugin; the call must then say which, and
 * the bot is told to ask the user first.
 */
export function pickBinding<T extends { name: string; sharing: "private" | "team" }>(
  bound: T[],
  name: string,
  config?: Scope,
): T | undefined {
  const hits = bound.filter((b) => b.name === name);
  if (config) return hits.find((b) => (b.sharing === "team") === (config === "team"));
  if (hits.length > 1)
    throw new PluginError(
      "CHOOSE_CONFIG",
      `This bot has your own and the team's ${name} configuration, and the call did not say which.`,
      'Ask the user which one to use, then repeat the call with "config":"mine" or "config":"team".',
    );
  return hits[0];
}
/** GitHub with no saved token: its MCP tools cannot run; bots use the server's `gh` login instead. */
export const githubWithoutToken = (b: { name: string; hasConnection: boolean }) =>
  b.name === "github" && !b.hasConnection;
/** The slice of the MCP service the plugin layer needs. */
export type McpCore = {
  addServer(
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
  ): Promise<{ id: string }>;
  addNative(
    a: ActiveActor,
    id: string,
    connectionId?: string,
    sharing?: Scope,
  ): Promise<{ id: string }>;
  serverByName(a: ActiveActor, name: string, scope?: Scope): Promise<ServerRow | undefined>;
  setConnection(a: ActiveActor, id: string, connectionId: string | null): Promise<void>;
  removeServer(a: ActiveActor, id: string): Promise<unknown>;
  bind(a: ActiveActor, botId: string, serverId: string): Promise<unknown>;
  unbind(a: ActiveActor, botId: string, serverId: string): Promise<unknown>;
  bound(
    a: ActiveActor,
    botId: string,
  ): Promise<
    ({
      id: string;
      name: string;
      tools: { name: string; description: string }[];
      ownerUserId: string;
      sharing: "private" | "team";
      hasConnection: boolean;
    } & ToolAccess)[]
  >;
  serverById(
    id: string,
  ): Promise<(ServerRow & { ownerUserId: string; sharing: "private" | "team" }) | undefined>;
  tools(a: ActiveActor, serverId: string): Promise<{ name: string; description: string }[]>;
};

/**
 * Plugin lifecycle and execution for one user at a time. Every method takes the acting user and touches that user's own rows, bindings
 * and sealed secret, or the workspace's team configuration (changed by the administrator only, used by every member).
 */
export function createPlugins(
  db: Database,
  connections: ConnectionsService | undefined,
  mcp: () => McpCore,
  /** Whether the server's gh CLI is logged in for this HOME; a parameter so tests do not depend on the machine. */
  gh: (home: string | undefined) => Promise<boolean> = (home) => ghLoggedIn(home),
) {
  const need = () => {
    if (!connections?.configured())
      throw new PluginError(
        "CONNECTIONS_NOT_CONFIGURED",
        "Secrets storage is not configured on this server (ZETTA_CONNECTION_KEY).",
      );
    return connections;
  };
  const def = (id: string) => {
    const d = getPlugin(id);
    if (!d) throw new AccessError("NOT_FOUND");
    return d;
  };
  const isNative = (d: PluginDef, s: ServerRow) =>
    d.kind === "native"
      ? Boolean(s.url?.startsWith(NATIVE_URL_PREFIX))
      : !s.url?.startsWith(NATIVE_URL_PREFIX);
  async function installed(a: ActiveActor, id: string, scope: Scope = "mine") {
    const d = def(id);
    const s = await mcp().serverByName(a, id, scope);
    if (!s || !isNative(d, s)) throw new AccessError("NOT_FOUND");
    return { d, s };
  }
  const adminOnly = (a: ActiveActor, scope: Scope) => {
    if (scope === "team" && !a.isAdmin)
      throw new PluginError(
        "ADMIN_ONLY",
        "Only the administrator can change the team configuration.",
        "Ask the administrator, or install the plugin on your own account.",
      );
  };
  /** Like `installed`, for a change: the team configuration is the administrator's to change. */
  async function managed(a: ActiveActor, id: string, scope: Scope) {
    adminOnly(a, scope);
    return installed(a, id, scope);
  }
  const seal = (d: PluginDef, config: Record<string, string>) => {
    if (d.kind === "mcp") {
      const key = d.mcp?.transport === "http" ? d.mcp.secretField : undefined;
      return key && config[key] ? config[key] : undefined;
    }
    const filled = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ""));
    return Object.keys(filled).length ? JSON.stringify(filled) : undefined;
  };
  async function load(a: ActiveActor, d: PluginDef, s: ServerRow): Promise<Record<string, string>> {
    if (!s.connectionId) return {};
    const buf = await need()
      .secretFor(a, s.connectionId)
      .catch(() => undefined);
    if (!buf)
      throw new PluginError(
        "SECRET_UNAVAILABLE",
        "The saved credentials are no longer available. Reinstall the plugin.",
      );
    const raw = buf.toString("utf8");
    buf.fill(0);
    if (d.kind === "mcp") {
      const key = d.mcp?.transport === "http" ? d.mcp.secretField : undefined;
      return key ? { [key]: raw } : {};
    }
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" ? (v as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
  const revokeQuietly = async (a: ActiveActor, id: string) => {
    try {
      const c = (await need().list(a)).find((x) => x.id === id);
      if (c) await need().revoke(a, id, c.revision);
    } catch {
      /* an already revoked secret is fine */
    }
  };
  async function ctxFor(
    a: ActiveActor,
    d: PluginDef,
    s: ServerRow,
    preset?: Record<string, string>,
    botId?: string,
  ): Promise<PluginContext> {
    // A team configuration keeps its secret under its owner and acts as its own principal, so its limits, locks and sessions never mix
    // with the owner's private configuration of the same plugin.
    const team = s.sharing === "team";
    const owner: ActiveActor =
      team && s.ownerUserId && s.ownerUserId !== a.userId
        ? { userId: s.ownerUserId, isAdmin: false }
        : a;
    let config = preset ?? (await load(owner, d, s));
    let connectionId = s.connectionId;
    return {
      userId: team ? `team:${s.id}` : a.userId,
      botId,
      get config() {
        return config;
      },
      async setConfig(next) {
        const sealed = seal(d, next);
        const prev = connectionId;
        const created = sealed
          ? await need().create(owner, {
              provider: PROVIDER,
              label: `plugin:${d.id}`,
              secret: sealed,
            })
          : undefined;
        await mcp().setConnection(a, s.id, created?.id ?? null);
        connectionId = created?.id ?? null;
        config = { ...next };
        if (prev) await revokeQuietly(owner, prev);
      },
    } as PluginContext;
  }
  /** The server row a bot's binding points at, for a user who is allowed to use it (their own, or the team's). */
  async function boundRow(a: ActiveActor, binding: { id: string }) {
    const s = await mcp().serverById(binding.id);
    if (!s || !(s.sharing === "team" || s.ownerUserId === a.userId))
      throw new PluginError("NOT_BOUND", "That plugin is not connected to this bot any more.");
    return s;
  }
  const withDeadline = async <T>(work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, rej) => {
          timer = setTimeout(
            () => rej(new PluginError("TIMEOUT", "The plugin took too long.")),
            CALL_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  /** A context that cannot re-seal the config: background work every minute must never churn the stored secret or race a tool call that updates it. */
  const readOnly = (ctx: PluginContext): PluginContext => ({
    userId: ctx.userId,
    config: ctx.config,
    setConfig: () =>
      Promise.reject(
        new PluginError("READ_ONLY", "Background work cannot change plugin settings."),
      ),
  });
  /** Validates field values against the plugin's schema. Blank fields fall back to `current` (so an edit can leave a secret untouched). */
  function fieldValues(
    d: PluginDef,
    config: Record<string, string>,
    current: Readonly<Record<string, string>> = {},
  ) {
    const allowed = new Set(d.fields.map((f) => f.key));
    for (const k of Object.keys(config))
      if (!allowed.has(k)) throw new PluginError("INVALID_FIELD", "Unknown setting.");
    const clean: Record<string, string> = {};
    for (const f of d.fields) {
      const v = (config[f.key] ?? "").trim() || current[f.key] || "";
      if (!v && !f.optional) throw new PluginError("MISSING_FIELD", `${f.label} is required.`);
      if (v && f.kind === "url") {
        try {
          if (!/^https?:$/.test(new URL(v).protocol)) throw 0;
        } catch {
          throw new PluginError("INVALID_FIELD", `${f.label} must be an http(s) address.`);
        }
      }
      if (v && f.kind === "select" && !f.options?.some((o) => o.value === v))
        throw new PluginError("INVALID_FIELD", `${f.label} has an unknown choice.`);
      if (v.length > 4000) throw new PluginError("INVALID_FIELD", `${f.label} is too long.`);
      if (v) clean[f.key] = v;
    }
    return clean;
  }
  // Tool schemas never change at runtime: stringify each once, not on every prompt of every tool-loop round.
  const toolText = new WeakMap<object, string>();
  const toolLine = (t: NonNullable<PluginDef["tools"]>[number]) => {
    let line = toolText.get(t);
    if (line === undefined) {
      line = `    ${t.name}: ${t.description} args ${JSON.stringify(t.inputSchema.properties ?? {})}${t.inputSchema.required?.length ? ` required ${JSON.stringify(t.inputSchema.required)}` : ""}`;
      toolText.set(t, line);
    }
    return line;
  };
  const toolLines = (d: PluginDef, access?: ToolAccess[]) =>
    (d.tools ?? [])
      .filter((t) => !access || access.some((x) => toolAllowed(x, t.name)))
      .map(toolLine)
      .join("\n");
  const render = (v: unknown) =>
    (typeof v === "string" ? v : (JSON.stringify(v) ?? "")).slice(0, MAX_TEXT);

  return {
    /** Everything installable (browser-safe: no handlers). */
    catalog: () => listPlugins().map(pluginMeta),
    /** Internal (server modules such as Agenda sync): the context for an installed native plugin, the user's own first, then the team's. Never exposed through routes. */
    async contextFor(a: ActiveActor, id: string): Promise<PluginContext> {
      const { d, s } = await installed(a, id).catch(() => installed(a, id, "team"));
      return ctxFor(a, d, s);
    },
    /**
     * Internal (the chat fast path): the context of a native plugin for one bot and one tool, or undefined when the plugin is not
     * bound to the bot, the bot may not use the tool, or the bot holds both the user's own and the team's configuration. Never exposed through routes.
     */
    async contextForBot(
      a: ActiveActor,
      botId: string,
      id: string,
      tool: string,
    ): Promise<PluginContext | undefined> {
      try {
        const d = getPlugin(id);
        const binding = pickBinding(await mcp().bound(a, botId), id);
        if (!d || d.kind !== "native" || d.always || !binding || !toolAllowed(binding, tool))
          return undefined;
        return await ctxFor(a, d, await boundRow(a, binding), undefined, botId);
      } catch {
        return undefined;
      }
    },
    /** The plugins the user may use: their own and the team's. Probing is separate (`test`). */
    async list(a: ActiveActor) {
      const out: {
        id: string;
        serverId: string;
        hasSecret: boolean;
        sharing: "private" | "team";
      }[] = [];
      for (const d of listPlugins())
        for (const scope of ["mine", "team"] as const) {
          const s = await mcp().serverByName(a, d.id, scope);
          if (s && isNative(d, s))
            out.push({
              id: d.id,
              serverId: s.id,
              hasSecret: Boolean(s.connectionId),
              sharing: scope === "team" ? "team" : "private",
            });
        }
      return out;
    },
    async install(
      a: ActiveActor,
      id: string,
      config: Record<string, string>,
      botIds: string[] = [],
      scope: Scope = "mine",
    ) {
      const d = def(id);
      adminOnly(a, scope);
      if (d.always)
        throw new PluginError(
          "BUILT_IN",
          `${d.name} is built in and already on for every bot.`,
          "Manage it in each bot's settings.",
        );
      if (await mcp().serverByName(a, id, scope))
        throw new PluginError("ALREADY_INSTALLED", "That plugin is already installed.");
      const clean = fieldValues(d, config);
      const sealed = seal(d, clean);
      const conn = sealed
        ? await need().create(a, { provider: PROVIDER, label: `plugin:${d.id}`, secret: sealed })
        : undefined;
      let serverId: string | undefined;
      try {
        const t = d.mcp;
        const row =
          d.kind === "native"
            ? await mcp().addNative(a, d.id, conn?.id, scope)
            : t?.transport === "http"
              ? await mcp().addServer(a, {
                  name: d.id,
                  transport: "http",
                  url: t.url,
                  sharing: scope,
                  ...(conn ? { connectionId: conn.id } : {}),
                })
              : await mcp().addServer(a, {
                  name: d.id,
                  transport: "stdio",
                  command: t!.transport === "stdio" ? t!.command : "",
                  args: t!.transport === "stdio" ? t!.args : [],
                  sharing: scope,
                  ...(conn ? { connectionId: conn.id } : {}),
                });
        serverId = row.id;
        if (d.install)
          await withDeadline(
            d.install(
              await ctxFor(
                a,
                d,
                {
                  id: row.id,
                  name: d.id,
                  url: null,
                  connectionId: conn?.id ?? null,
                  ownerUserId: a.userId,
                  sharing: scope === "team" ? "team" : "private",
                },
                clean,
              ),
            ),
          );
        for (const botId of botIds) await mcp().bind(a, botId, row.id);
      } catch (e) {
        if (serverId)
          await mcp()
            .removeServer(a, serverId)
            .catch(() => {});
        if (conn) await revokeQuietly(a, conn.id);
        throw e;
      }
      await audit(db, a.userId, {
        kind: "connection",
        outcome: "ok",
        subjectId: serverId!,
        detail: scope === "team" ? "plugin-installed-team" : "plugin-installed",
      });
      return { id: d.id, serverId: serverId! };
    },
    async uninstall(a: ActiveActor, id: string, scope: Scope = "mine") {
      const { d, s } = await managed(a, id, scope);
      if (d.disconnect) await withDeadline(d.disconnect(await ctxFor(a, d, s))).catch(() => {}); // remote cleanup is best effort; local removal always proceeds
      await mcp().removeServer(a, s.id);
      if (s.connectionId)
        await revokeQuietly(
          scope === "team" && s.ownerUserId ? { userId: s.ownerUserId, isAdmin: false } : a,
          s.connectionId,
        );
      return { id };
    },
    /**
     * Replaces the user's own settings (API keys, OAuth client) of an installed plugin. Blank fields keep their stored value.
     * Changing an OAuth plugin's settings disconnects it first: tokens issued to the old client are useless with the new one.
     */
    async configure(
      a: ActiveActor,
      id: string,
      config: Record<string, string>,
      scope: Scope = "mine",
    ) {
      const { d, s } = await managed(a, id, scope);
      if (!d.fields.length) throw new PluginError("NOT_SUPPORTED", "This plugin has no settings.");
      const ctx = await ctxFor(a, d, s);
      const next = fieldValues(d, config, ctx.config);
      if (d.fields.every((f) => (next[f.key] ?? "") === (ctx.config[f.key] ?? "")))
        return { id, changed: false };
      if (d.auth === "oauth" && d.disconnect) await withDeadline(d.disconnect(ctx)).catch(() => {});
      const keys = new Set(d.fields.map((f) => f.key));
      const state =
        d.auth === "oauth"
          ? {}
          : Object.fromEntries(Object.entries(ctx.config).filter(([k]) => !keys.has(k)));
      await ctx.setConfig({ ...state, ...next });
      await audit(db, a.userId, {
        kind: "connection",
        outcome: "ok",
        subjectId: s.id,
        detail: "plugin-configured",
      });
      // A channel plugin may now be able to set up push (for example a new address for the channel's server to call).
      if (scope === "mine" && d.inbound?.enable)
        await withDeadline(d.inbound.enable(ctx)).catch(() => {});
      return { id, changed: true };
    },
    /** Starts the plugin's own connect flow (e.g. OAuth). */
    async connect(
      a: ActiveActor,
      id: string,
      options?: Record<string, unknown>,
      scope: Scope = "mine",
    ) {
      const { d, s } = await managed(a, id, scope);
      if (!d.connect) throw new PluginError("NOT_SUPPORTED", "This plugin has nothing to connect.");
      return (await withDeadline(d.connect(await ctxFor(a, d, s), options))) ?? {};
    },
    /** OAuth redirect target: completes the flow the signed-in user started. */
    async callback(a: ActiveActor, id: string, params: URLSearchParams) {
      // The provider's redirect carries no scope: the configuration that started the sign-in is the one whose pending state matches.
      let failure: unknown = new AccessError("NOT_FOUND");
      for (const scope of a.isAdmin ? (["mine", "team"] as const) : (["mine"] as const)) {
        const found = await installed(a, id, scope).catch(() => undefined);
        if (!found) continue;
        const { d, s } = found;
        if (!d.callback)
          throw new PluginError("NOT_SUPPORTED", "This plugin has no sign-in callback.");
        try {
          await withDeadline(d.callback(await ctxFor(a, d, s), params));
          return;
        } catch (e) {
          failure = e;
        }
      }
      throw failure;
    },
    /** Revokes remote access and wipes the stored credentials, keeping the plugin installed. */
    async disconnect(
      a: ActiveActor,
      id: string,
      scope: Scope = "mine",
      options?: Record<string, unknown>,
    ) {
      const { d, s } = await managed(a, id, scope);
      if (!d.disconnect)
        throw new PluginError("NOT_SUPPORTED", "This plugin has nothing to disconnect.");
      await withDeadline(d.disconnect(await ctxFor(a, d, s), options));
      return { id };
    },
    /** Health check + tool list. MCP plugins connect and list tools; native plugins use `status()`. Never throws for plugin failures. */
    async test(
      a: ActiveActor,
      id: string,
      scope: Scope = "mine",
    ): Promise<{ status: PluginStatus; tools: { name: string; description: string }[] }> {
      const { d, s } = await installed(a, id, scope);
      // GitHub without a token has no tools (its MCP server needs one), but bots still use the server's gh login for git and gh.
      if (d.id === "github" && !s.connectionId) {
        const cli = await gh(harnessHome(a.userId, "claude-code"));
        return {
          status: cli
            ? { state: "connected", detail: "Uses the GitHub CLI login on the server." }
            : {
                state: "needs-auth",
                detail: "Add a token, or run `gh auth login` on the server.",
              },
          tools: [],
        };
      }
      if (d.kind === "mcp") {
        try {
          const tools = await mcp().tools(a, s.id);
          return { status: { state: "connected" }, tools };
        } catch (e) {
          const code = (e as { code?: string }).code;
          return {
            status: {
              state: "error",
              detail:
                code === "TIMEOUT"
                  ? "The server took too long."
                  : code === "BLOCKED_URL"
                    ? "That address is not allowed."
                    : "The server could not be reached or rejected the credentials.",
            },
            tools: [],
          };
        }
      }
      const tools = (d.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description.slice(0, 300),
      }));
      try {
        return {
          status: d.status
            ? await withDeadline(d.status(await ctxFor(a, d, s)))
            : { state: "connected" },
          tools,
        };
      } catch (e) {
        return {
          status: {
            state: "error",
            detail: e instanceof PluginError ? e.safe : "The plugin could not be checked.",
          },
          tools,
        };
      }
    },
    /**
     * Internal (modules/inbound): one poll of a channel plugin for this user. Its context cannot re-seal the config, so a poll every
     * minute never churns the stored secret or races a tool call that updates it.
     */
    async pollInbound(
      a: ActiveActor,
      id: string,
      cursor: unknown,
      o: { filter: InboundFilter; maxEvents: number },
    ) {
      const { d, s } = await installed(a, id);
      if (!d.inbound)
        throw new PluginError("NO_INBOUND", "This plugin cannot deliver incoming messages.");
      return withDeadline(d.inbound.poll(readOnly(await ctxFor(a, d, s)), cursor, o));
    },
    /** Internal (modules/inbound): the user turned incoming messages on, so the channel plugin may set up push (own configuration only). */
    async prepareInbound(a: ActiveActor, id: string) {
      const { d, s } = await installed(a, id);
      if (d.inbound?.enable) await withDeadline(d.inbound.enable(await ctxFor(a, d, s)));
    },
    /** Internal (modules/inbound): checks a push from the channel's server against this user's own configuration. Anything unclear is "invalid". */
    async verifyPush(a: ActiveActor, id: string, headers: Headers, raw: string) {
      const { d, s } = await installed(a, id).catch(() => ({ d: undefined, s: undefined }));
      if (!d?.inbound?.verifyPush || !s) return "invalid" as const;
      return d.inbound.verifyPush(readOnly(await ctxFor(a, d, s)), headers, raw);
    },
    /** Plugin ids the user has bound to this bot (once each, even when both configurations are bound). */
    async bindings(a: ActiveActor, botId: string) {
      const names = new Set((await mcp().bound(a, botId)).map((b) => b.name));
      return listPlugins()
        .filter((d) => names.has(d.id))
        .map((d) => d.id);
    },
    /**
     * What the bot needs to know to start a setup in the chat: where the plugin stands for this user and bot, plus the field labels and
     * guide steps. Never values. A team setup that does not exist yet is the administrator's to start.
     */
    async setupInfo(a: ActiveActor, botId: string, id: string, scope: Scope = "mine") {
      const d = getPlugin(id);
      if (!d || d.always) throw new AccessError("NOT_FOUND");
      const there = (await this.list(a)).some(
        (p) => p.id === id && p.sharing === (scope === "team" ? "team" : "private"),
      );
      if (!there) adminOnly(a, scope);
      const probe = there ? (await this.test(a, id, scope)).status : undefined;
      const state = !probe ? ("not-installed" as const) : probe.state;
      const bound = (await this.bindingScopes(a, botId)).some(
        (b) => b.id === id && b.scope === scope,
      );
      return {
        plugin: d.id,
        name: d.name,
        state,
        detail: probe?.detail,
        bound,
        auth: d.auth,
        fields: d.fields.map((f) => ({
          label: f.label,
          secret: Boolean(f.secret),
          optional: Boolean(f.optional),
        })),
        guide: d.guide?.() ?? [],
        notes: d.notes,
        docsUrl: d.docsUrl,
      };
    },
    /**
     * Internal (chat tools): the settings a bot may read and propose to change, with their saved values. Secrets and anything the plugin
     * did not mark `botEditable` never appear. Own configuration only.
     */
    async botSettings(a: ActiveActor, id: string) {
      const d = getPlugin(id);
      if (!d || d.always) throw new AccessError("NOT_FOUND");
      const own = await installed(a, id).catch(() => undefined);
      if (!own) return { name: d.name, installed: false as const, settings: [] };
      const ctx = await ctxFor(a, d, own.s);
      return {
        name: d.name,
        installed: true as const,
        settings: d.fields
          .filter((f) => f.botEditable && !f.secret)
          .map((f) => ({ key: f.key, label: f.label, value: ctx.config[f.key] ?? "" })),
      };
    },
    /**
     * Internal (chat tools): checks the settings a bot wants to change and returns what would change. Saves nothing: the user applies it
     * through `configure` in a card. A setting that is not `botEditable` is refused, whatever the plugin's schema says.
     */
    async proposeSettings(a: ActiveActor, id: string, settings: Record<string, string>) {
      const d = getPlugin(id);
      if (!d || d.always) throw new AccessError("NOT_FOUND");
      const { s } = await installed(a, id);
      const editable = new Map(
        d.fields.filter((f) => f.botEditable && !f.secret).map((f) => [f.key, f]),
      );
      for (const key of Object.keys(settings))
        if (!editable.has(key))
          throw new PluginError(
            "NOT_ALLOWED",
            `A bot cannot change "${key}". Only the user changes it, in Studio > Plugins > ${d.name}.`,
          );
      const current = (await ctxFor(a, d, s)).config;
      const next = fieldValues(d, settings, current);
      return {
        name: d.name,
        changes: Object.keys(settings)
          .filter((key) => (next[key] ?? "") !== (current[key] ?? ""))
          .map((key) => ({
            key,
            label: editable.get(key)!.label,
            from: current[key] ?? "",
            to: next[key] ?? "",
          })),
      };
    },
    /** Which configuration of each plugin the user bound to this bot. */
    async bindingScopes(a: ActiveActor, botId: string) {
      const bound = await mcp().bound(a, botId);
      return listPlugins().flatMap((d) =>
        bound
          .filter((b) => b.name === d.id)
          .map((b) => ({
            id: d.id,
            scope: b.sharing === "team" ? ("team" as const) : ("mine" as const),
          })),
      );
    },
    async setBinding(
      a: ActiveActor,
      botId: string,
      id: string,
      on: boolean,
      scope: Scope = "mine",
    ) {
      const { s } = await installed(a, id, scope);
      if (on) await mcp().bind(a, botId, s.id);
      else await mcp().unbind(a, botId, s.id);
      return { botId, id, scope, bound: on };
    },
    /** Runs one native tool for a bot. Requires this user's binding; ownership and the stored secret are resolved on every call. */
    async callTool(
      a: ActiveActor,
      botId: string,
      id: string,
      tool: string,
      args: Record<string, unknown>,
      config?: Scope,
    ) {
      const outcome = (o: "ok" | "failed" | "timeout" | "denied") =>
        audit(db, a.userId, {
          kind: "tool_call",
          botId,
          outcome: o,
          detail: auditToolDetail("plugin", tool),
        });
      const d = getPlugin(id);
      if (d?.always && !(await d.always.available(botId, a.userId).catch(() => false)))
        throw new PluginError(
          "NOT_BOUND",
          `${d.name} is switched off for this bot.`,
          `Open the bot's settings and switch ${d.name} back on.`,
        );
      const binding =
        d && !d.always ? pickBinding(await mcp().bound(a, botId), id, config) : undefined;
      if (binding && githubWithoutToken(binding))
        throw new PluginError(
          "USE_GH",
          "GitHub has no token here, so its tools are off. Use the gh command instead.",
          "Run gh in the shell, for example gh pr list -R owner/repo or gh issue list -R owner/repo. Do not call GitHub tools again.",
        );
      if (!d || d.kind !== "native" || (!d.always && !binding))
        throw new PluginError("NOT_BOUND", "That plugin is not connected to this bot.");
      if (binding && !toolAllowed(binding, tool)) {
        await outcome("denied");
        throw new PluginError(
          "TOOL_NOT_ALLOWED",
          "This bot may not use that tool.",
          `Open the bot's settings > Plugins & MCP and allow ${tool.replace(/_/g, " ")}.`,
        );
      }
      const t = d.tools?.find((x) => x.name === tool);
      if (!t) throw new PluginError("UNKNOWN_TOOL", "That plugin has no such tool.");
      const missing = (t.inputSchema.required ?? []).filter((k) => args[k] === undefined);
      if (missing.length) throw new PluginError("INVALID_ARGS", `Missing: ${missing.join(", ")}`);
      try {
        const ctx: PluginContext = d.always
          ? {
              userId: a.userId,
              botId,
              config: {},
              setConfig: () => Promise.reject(new PluginError("FAILED")),
            }
          : await ctxFor(a, d, await boundRow(a, binding!), undefined, botId);
        const out = render(await withDeadline(t.handler(ctx, args)));
        await outcome("ok");
        return out;
      } catch (e) {
        await outcome(e instanceof PluginError && e.code === "TIMEOUT" ? "timeout" : "failed");
        throw e instanceof PluginError ? e : new PluginError("FAILED");
      }
    },
    /** Every credential the user granted through password managers bound to this bot (metadata only). Unreadable plugins are skipped. */
    async credentialGrants(a: ActiveActor, botId: string) {
      const bound = new Set((await mcp().bound(a, botId)).map((b) => b.name));
      const out: { plugin: string; grant: CredentialGrant }[] = [];
      for (const d of listPlugins()) {
        if (!d.credentials || d.kind !== "native" || !bound.has(d.id)) continue;
        try {
          const { s } = await installed(a, d.id).catch(() => installed(a, d.id, "team"));
          for (const grant of await d.credentials.grants(await ctxFor(a, d, s)))
            out.push({ plugin: d.id, grant });
        } catch {
          /* reported when the bot tries to use it */
        }
      }
      return out;
    },
    /**
     * Reveals one granted value for the chat service to type into the bot's own page. Refuses unless the plugin is bound to the bot, the user
     * granted that item and field, and `pageUrl` is an https page on one of the grant's origins. The value is never logged or audited.
     */
    async credential(
      a: ActiveActor,
      botId: string,
      id: string,
      itemId: string,
      field: CredentialField,
      pageUrl: string,
    ): Promise<{ value: string; title: string }> {
      const deny = async (code: string, safe: string, fix?: string): Promise<never> => {
        await audit(db, a.userId, {
          kind: "tool_call",
          botId,
          outcome: "denied",
          detail: `credential:${code.toLowerCase()}`,
        });
        throw new PluginError(code, safe, fix);
      };
      const d = getPlugin(id);
      if (
        !d?.credentials ||
        d.kind !== "native" ||
        !(await mcp().bound(a, botId)).some((b) => b.name === id)
      )
        return deny(
          "NOT_BOUND",
          "That password manager is not connected to this bot.",
          `Open Studio > Plugins > ${d?.name ?? id} > Bots and allow this bot.`,
        );
      const { s } = await installed(a, id).catch(() => installed(a, id, "team"));
      const ctx = await ctxFor(a, d, s);
      const grant = (await withDeadline(d.credentials.grants(ctx))).find((g) => g.id === itemId);
      if (!grant)
        return deny(
          "NOT_GRANTED",
          "That login is not shared with bots.",
          `Open Studio > Plugins > ${d.name} and allow the login under Shared logins.`,
        );
      if (!grant.fields.includes(field))
        return deny(
          "FIELD_NOT_GRANTED",
          `Bots may not fill the ${field} of "${grant.title}".`,
          `Open Studio > Plugins > ${d.name} and tick ${field} for that login.`,
        );
      if (!originAllowed(pageUrl, grant.origins))
        return deny(
          "ORIGIN_MISMATCH",
          `"${grant.title}" is only filled on ${grant.origins.join(", ")} over https, and the open page is somewhere else.`,
          `If this site is right, add it to the login's sites in Studio > Plugins > ${d.name}.`,
        );
      try {
        const value = await withDeadline(d.credentials.reveal(ctx, itemId, field));
        await audit(db, a.userId, {
          kind: "tool_call",
          botId,
          outcome: "ok",
          detail: `credential:${field}`,
        });
        return { value, title: grant.title };
      } catch (e) {
        await audit(db, a.userId, {
          kind: "tool_call",
          botId,
          outcome: "failed",
          detail: `credential:${field}`,
        });
        throw e instanceof PluginError ? e : new PluginError("FAILED");
      }
    },
    /** Prompt section describing the plugins THIS user bound to the bot (empty when none). Contains no secrets. */
    async promptFor(a: ActiveActor, botId: string): Promise<string> {
      const bound = await mcp().bound(a, botId);
      type Section = { line: string; kind: "native" | "remote" | "cli"; vault: boolean };
      const sections = await Promise.all(
        listPlugins().map(async (d): Promise<Section | undefined> => {
          if (d.always) {
            if (!(await d.always.available(botId, a.userId).catch(() => false))) return undefined;
            const extra = await d.always.prompt?.(botId, a.userId).catch(() => undefined);
            return {
              kind: "native",
              vault: false,
              line: `- ${d.id} (${d.name}): ${d.description}${extra ? `\n    ${extra}` : ""}\n${toolLines(d)}`,
            };
          }
          const bs = bound.filter((x) => x.name === d.id);
          if (!bs.length) return undefined;
          const vault = Boolean(d.credentials);
          const both = bs.length > 1;
          const which = both
            ? ` You have two configurations of it: "mine" (the user's own account) and "team" (the workspace's shared account). Before you use it in this conversation, ask the user which one to use, then add "config":"mine" or "config":"team" to every call.`
            : bs[0]!.sharing === "team"
              ? " (the workspace's shared account)"
              : "";
          if (d.kind === "native")
            return {
              kind: "native",
              vault,
              line: `- ${d.id} (${d.name})${both ? "" : which}: ${d.description}${both ? which : ""}${inboundHint(d)}\n${toolLines(d, bs)}`,
            };
          // No token: the GitHub MCP tools are off (see runConfig); bots use the server's gh login, so the cached tool names stay out.
          if (bs.every(githubWithoutToken)) {
            const cli = await gh(harnessHome(a.userId, "claude-code")).catch(() => false);
            return {
              kind: "cli",
              vault: false,
              line: cli
                ? `- ${d.id} (${d.name}): no token; use the server's gh login. Run the gh command in the shell, for example gh pr list -R owner/repo, gh issue list -R owner/repo or gh api repos/owner/repo/pulls. Do not use zetta:mcp or zetta:plugin for GitHub.`
                : `- ${d.id} (${d.name}): no token, and the server's gh CLI is not logged in, so GitHub is not usable. Tell the user to add a token in the plugin settings or to run gh auth login on the server. Do not call GitHub tools.`,
            };
          }
          const names = [
            ...new Set(
              bs.flatMap((b) => b.tools.filter((t) => toolAllowed(b, t.name)).map((t) => t.name)),
            ),
          ];
          return {
            kind: "remote",
            vault,
            line: `- ${d.id} (${d.name})${both ? "" : which}: ${d.description}${both ? which : ""}${names.length ? ` Tools: ${names.slice(0, 40).join(", ")}.` : ""}`,
          };
        }),
      );
      const found = sections.filter((x): x is Section => Boolean(x));
      const lines = found.map((x) => x.line),
        native = found.some((x) => x.kind === "native"),
        remote = found.some((x) => x.kind === "remote"),
        vault = found.some((x) => x.vault);
      const setup = setupPrompt(
        listPlugins().filter((d) => !d.always && !bound.some((b) => b.name === d.id)),
      );
      if (!lines.length) return setup;
      return [
        `Plugins connected to you by this user (the user's own accounts; use only when needed):`,
        ...lines,
        native
          ? 'Call a plugin tool with a fenced block:\n```zetta:plugin\n{"plugin":"<id>","tool":"<tool>","args":{}}\n```'
          : "",
        remote
          ? 'Call an MCP server tool with:\n```zetta:mcp\n{"server":"<id>","tool":"<tool>","args":{}}\n```'
          : "",
        vault ? CREDENTIAL_PROMPT : "",
        setup,
      ]
        .filter(Boolean)
        .join("\n");
    },
  };
}
export type Plugins = ReturnType<typeof createPlugins>;
