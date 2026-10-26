/**
 * PLUGIN CONTRACT (stable; native plugins such as WhatsApp and Google are written against this file).
 *
 * A plugin is a definition registered once at module load with `registerPlugin(def)`. Two kinds:
 *   - kind "mcp":    backed by an MCP server (`def.mcp`: remote https URL or an argv). The platform connects, lists and calls tools.
 *   - kind "native": in-process. `def.tools[]` are called by bots through the fenced block
 *                    ```zetta:plugin {"plugin":"<id>","tool":"<name>","args":{...}}```
 *
 * Per-user state (isolation rules):
 *   - Installing creates one user-owned `mcp_server` row named `<plugin id>` (native rows use the url `zetta-plugin://<id>`), so the
 *     existing per-user ownership and per-bot `bot_integration` binding model applies unchanged. Users never see each other's plugins.
 *   - Config is sealed in the connections store (provider "plugin") as ONE secret per install: a JSON object of ALL field values
 *     (kind "mcp" with a single secret field stores that raw value, used as the bearer token). The browser never gets values back.
 *   - Handlers receive the decrypted config only for the duration of one call, through `ctx.config`. Use `ctx.setConfig(next)` to
 *     persist refreshed state (OAuth tokens, session ids); it re-seals and revokes the previous secret.
 *   - A bot may call a plugin only when the calling user bound it to that bot (`bot_integration`); ownership is re-checked per call.
 *
 * Handlers must throw `PluginError(code, safe, fix)`: `safe` says what went wrong and `fix` what the USER can do about it. Both are shown to the
 * user (as a callout in the chat) and to the bot, so write them for a person and never include secrets. Common codes (AUTH, NEEDS_AUTH, TIMEOUT,
 * RATE_LIMITED, ...) get a default `fix` from chat/explain.ts when you leave it out. Anything that is not a PluginError is reported as unexpected.
 * Tool results are strings (objects are JSON-stringified) and are truncated to 8000 characters.
 */
export type PluginFieldKind = "text" | "password" | "url" | "textarea";
/** One entry of the config schema. The install dialog in the web app is generated from these. */
export type PluginField = { key: string; label: string; secret?: boolean; optional?: boolean; kind?: PluginFieldKind; placeholder?: string; help?: string };
export type PluginCategory = "monitoring" | "analytics" | "cloud" | "dev" | "productivity" | "docs" | "browser" | "messaging" | "social" | "google" | "security" | "other";
/** none: nothing to configure. api-key: the user pastes `fields`. oauth: `connect()` returns an authorize URL (the plugin owns the flow). */
export type PluginAuth = "none" | "api-key" | "oauth";

export type PluginContext = {
  userId: string;
  /** Decrypted field values for THIS user. Never log or return them. Empty object when nothing is stored. */
  config: Readonly<Record<string, string>>;
  /** Replaces the stored config (re-sealed). Call only from a handler/lifecycle hook of the same user. */
  setConfig(next: Record<string, string>): Promise<void>;
};
export type JsonSchema = { type: "object"; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
export type PluginTool = {
  name: string; // ^[a-zA-Z0-9_.-]{1,64}$
  description: string;
  /** "read" tools only fetch; anything else (the default) may change or send something. Bots answering outside people may only read. */
  effect?: "read" | "write";
  inputSchema: JsonSchema;
  handler(ctx: PluginContext, args: Record<string, unknown>): Promise<string | Record<string, unknown> | unknown[]>;
};
export type PluginStatus = { state: "connected" | "needs-auth" | "error"; detail?: string; /** Browser-safe extras (e.g. the connected account). Never secrets. */ info?: Record<string, unknown> };
export type CredentialField = "username" | "password" | "totp";
/** A vault item the USER allowed bots to fill, only on pages whose host matches `origins` (see credentials.ts). No values. */
export type CredentialGrant = { id: string; title: string; origins: string[]; fields: CredentialField[] };
/**
 * Password-manager plugins. A revealed value never reaches a bot: the chat service types it into the bot's own browser or desktop after
 * checking the grant, the field and the page's origin, and the bot only learns that the field was filled.
 */
export type PluginCredentials = {
  grants(ctx: PluginContext): Promise<CredentialGrant[]>;
  reveal(ctx: PluginContext, itemId: string, field: CredentialField): Promise<string>;
};
/** One message from outside people, as a channel plugin saw it. `key` is unique per install (re-polls never deliver twice). */
export type InboundEvent = { key: string; chat: string; chatName: string; from: string; text: string; at: number; media?: boolean; group?: boolean };
export type InboundFilter = { direct: boolean; groups: boolean; chats: string[] };
/**
 * Channel plugins (WhatsApp, Telegram...): new outside messages start a turn for the bot the user picked (see modules/inbound).
 * `poll` must not call ctx.setConfig (the poller cannot re-seal secrets); its cursor is opaque JSON the plugin owns (null = first poll:
 * no backfill, just remember where "now" is). `reply` names the tool and argument a bot uses to answer one chat.
 */
export type PluginInbound = {
  label: string;
  minIntervalSeconds?: number;
  poll(ctx: PluginContext, cursor: unknown, o: { filter: InboundFilter; maxEvents: number }): Promise<{ events: InboundEvent[]; cursor: unknown; warning?: string }>;
  reply: { tool: string; chatArg: string; normalize(chat: string): string };
};
export type PluginMcpTarget ={ transport: "http"; url: string; secretField?: string } | { transport: "stdio"; command: string; args: string[] };

export type PluginDef = {
  id: string; // ^[a-z0-9_-]{1,32}$, unique
  name: string;
  description: string;
  /** lucide icon name in kebab-case (the web app maps known names and falls back to a generic icon). */
  icon: string;
  category: PluginCategory;
  auth: PluginAuth;
  fields: PluginField[];
  docsUrl?: string;
  /** false when the endpoint/command/auth could not be confirmed from official docs. Shown in the UI. */
  verified?: boolean;
  notes?: string;
  kind: "mcp" | "native";
  mcp?: PluginMcpTarget;
  tools?: PluginTool[];
  /** Validate / provision after the config is saved. Throw PluginError to abort (the install is rolled back). */
  install?(ctx: PluginContext): Promise<void>;
  /** Start or continue an OAuth/pairing flow. Return a URL for the user to open, or nothing. */
  connect?(ctx: PluginContext, options?: Record<string, unknown>): Promise<{ authorizeUrl?: string; qrDataUrl?: string; message?: string; /** Browser-safe extras for the plugin's own Studio panel. Never secrets. */ data?: Record<string, unknown> } | void>;
  /** Revoke remote access / delete remote state. Runs before the local secret is removed. */
  /** OAuth redirect target (GET /api/plugins/<id>/callback). Runs as the signed-in user; throw PluginError to report a failure. */
  callback?(ctx: PluginContext, params: URLSearchParams): Promise<void>;
  disconnect?(ctx: PluginContext): Promise<void>;
  /** Health of a native plugin (kind "mcp" is probed by listing its tools instead). */
  status?(ctx: PluginContext): Promise<PluginStatus>;
  /** Password managers only: the user's grants and server-side reveal (never exposed as a tool). */
  credentials?: PluginCredentials;
  /** Channel plugins only: lets a bot answer new outside messages (see PluginInbound). */
  inbound?: PluginInbound;
};

export const DEFAULT_SAFE = "The plugin could not complete that.";
/**
 * `safe` says what went wrong and `fix` says what the USER can do about it (both shown to the user and the bot; no secrets).
 * Write them for a person: "Telegram could not find that chat." / "Ask them to open the bot and press Start."
 */
export class PluginError extends Error { constructor(readonly code: string, readonly safe: string = DEFAULT_SAFE, readonly fix?: string) { super(code); } }

const registry = new Map<string, PluginDef>();
const ID = /^[a-z0-9_-]{1,32}$/, TOOL = /^[a-zA-Z0-9_.-]{1,64}$/;

/** Registers a plugin. Idempotent for the same object; a different definition under an existing id throws. */
export function registerPlugin(def: PluginDef): PluginDef {
  if (!ID.test(def.id)) throw new Error(`invalid plugin id: ${def.id}`);
  if (def.kind === "mcp" && !def.mcp) throw new Error(`mcp plugin ${def.id} needs "mcp"`);
  if (def.kind === "native" && !def.tools) throw new Error(`native plugin ${def.id} needs "tools"`);
  if (def.inbound && !def.tools?.some((t) => t.name === def.inbound!.reply.tool)) throw new Error(`inbound plugin ${def.id} needs its reply tool`);
  for (const t of def.tools ?? []) if (!TOOL.test(t.name)) throw new Error(`invalid tool name: ${t.name}`);
  for (const f of def.fields) if (!/^[a-zA-Z0-9_]{1,40}$/.test(f.key)) throw new Error(`invalid field key: ${f.key}`);
  const prev = registry.get(def.id);
  if (prev && prev !== def) throw new Error(`plugin already registered: ${def.id}`);
  registry.set(def.id, def);
  return def;
}
export const getPlugin = (id: string) => registry.get(id);
export const listPlugins = () => [...registry.values()];
/** Test helper: removes a plugin so a fixture can be re-registered. */
export const unregisterPlugin = (id: string) => registry.delete(id);

/** Browser-safe description of a plugin (no handlers, no secrets). */
export const pluginMeta = (d: PluginDef) => ({
  id: d.id, name: d.name, description: d.description, icon: d.icon, category: d.category, auth: d.auth, kind: d.kind, transport: d.mcp?.transport ?? null, fields: d.fields, docsUrl: d.docsUrl ?? null, verified: d.verified !== false, notes: d.notes ?? null, credentials: Boolean(d.credentials), inbound: d.inbound ? { label: d.inbound.label } : null,
  tools: (d.tools ?? []).map((t) => ({ name: t.name, description: t.description })),
});
export type PluginMeta = ReturnType<typeof pluginMeta>;
