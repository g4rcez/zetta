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
 *   - Built-in plugins (`builtin`) ship with Zetta and need no configuration, but they are NOT on by default: the person activates one
 *     (an install with nothing to fill in) and chooses the bots, exactly like any other plugin. A built-in plugin may also have a `gate`:
 *     extra conditions checked on every call and prompt (mail switched on, a phone call in progress), on top of the binding.
 *
 * Handlers must throw `PluginError(code, safe, fix)`: `safe` says what went wrong and `fix` what the USER can do about it. Both are shown to the
 * user (as a callout in the chat) and to the bot, so write them for a person and never include secrets. Common codes (AUTH, NEEDS_AUTH, TIMEOUT,
 * RATE_LIMITED, ...) get a default `fix` from chat/explain.ts when you leave it out. Anything that is not a PluginError is reported as unexpected.
 * Tool results are strings (objects are JSON-stringified) and are truncated to 8000 characters.
 */
import type { MailGate } from "../../chat/mail-policy";
import type { PhoneGate } from "../../chat/phone-policy";
import type { PluginTurn } from "./turn";

export type PluginFieldKind = "text" | "password" | "url" | "textarea" | "select" | "languages";
/** One entry of the config schema. The install dialog in the web app is generated from these. */
export type PluginField = {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  kind?: PluginFieldKind;
  placeholder?: string;
  help?: string;
  /**
   * A bot may read this setting and propose a new value (the user applies it in a card, see zetta:inbound). Never for secrets, and never for
   * a setting that opens a risk by itself (an address Zetta calls, a switch that lets bots send). Default: only the user changes it.
   */
  botEditable?: boolean;
  /**
   * The shape a filled value must have, checked when it is saved: a regular expression for the whole value, and the same in words
   * ("starts with AC and has 34 characters"), which follows the field's label in the error.
   */
  pattern?: { source: string; format: string };
  /** The allowed values of a "select" field. A blank value keeps the stored one, so the first option is not a default. */
  options?: { value: string; label: string }[];
};
export type PluginCategory =
  | "monitoring"
  | "analytics"
  | "cloud"
  | "dev"
  | "productivity"
  | "docs"
  | "browser"
  | "messaging"
  | "social"
  | "google"
  | "security"
  | "other";
/** none: nothing to configure. api-key: the user pastes `fields`. oauth: `connect()` returns an authorize URL (the plugin owns the flow). */
export type PluginAuth = "none" | "api-key" | "oauth";

export type PluginContext = {
  userId: string;
  /** Decrypted field values for THIS user. Never log or return them. Empty object when nothing is stored. */
  config: Readonly<Record<string, string>>;
  /** Replaces the stored config (re-sealed). Call only from a handler/lifecycle hook of the same user. */
  setConfig(next: Record<string, string>): Promise<void>;
  /** The bot that called the tool (tool calls only). */
  botId?: string;
  /** The real user the request ran as. `userId` is `team:<id>` for a team configuration; a flow that finishes later needs the person. */
  actorUserId?: string;
  /** Where the call comes from (tool calls of a built-in plugin only). Absent means "none": a plugin that needs a place must refuse. */
  turn?: PluginTurn;
  /** Built-in mailbox plugin only: the server's decision point for a send (see chat/mail-policy.ts). Absent: a send always waits for a card. */
  mailGate?: MailGate;
  /** Built-in phone plugin only: the server's decision point for an outgoing call (see chat/phone-policy.ts). Absent: a call always waits for a card. */
  phoneGate?: PhoneGate;
  /** The chat the call comes from (an id the server resolved). The outcome of a call is reported there. */
  conversationId?: string;
  /** Shows the person a note in the chat (not the bot): what was sent in their name, in full. Absent when nobody is watching. */
  show?: (markdown: string) => void;
  /**
   * Tells the chat how far a long call has got ("Downloading", 45%). It only matters while the call is running: the chat stops listening
   * when the call returns, so a background job keeps the latest one it was given and a later call replaces it. Absent when nobody is watching.
   */
  progress?: (p: PluginProgress) => void;
};
/** One line of progress for the chat: a short text, and how much is done (0-100) when that is known. */
export type PluginProgress = { text: string; percent?: number };
export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};
export type PluginTool = {
  name: string; // ^[a-zA-Z0-9_.-]{1,64}$
  description: string;
  /**
   * "read" tools only fetch; anything else (the default) may change or send something. Bots answering outside people may only read.
   * "send" tools put something in front of other people in the person's name (mail): a kind of write that can never be taken back. Every
   * test that asks "is this a read?" treats a "send" tool as a write, and the server decides on each call whether it goes out at once or
   * waits for a card (chat/mail-policy.ts).
   */
  effect?: "read" | "write" | "send";
  inputSchema: JsonSchema;
  handler(
    ctx: PluginContext,
    args: Record<string, unknown>,
  ): Promise<string | Record<string, unknown> | unknown[]>;
};
export type PluginStatus = {
  state: "connected" | "needs-auth" | "error";
  detail?: string;
  /** Browser-safe extras (e.g. the connected account). Never secrets. */ info?: Record<
    string,
    unknown
  >;
};
export type CredentialField = "username" | "password" | "totp";
/** A vault item the USER allowed bots to fill, only on pages whose host matches `origins` (see credentials.ts). No values. */
export type CredentialGrant = {
  id: string;
  title: string;
  origins: string[];
  fields: CredentialField[];
};
/**
 * Password-manager plugins. A revealed value never reaches a bot: the chat service types it into the bot's own browser or desktop after
 * checking the grant, the field and the page's origin, and the bot only learns that the field was filled.
 */
export type PluginCredentials = {
  grants(ctx: PluginContext): Promise<CredentialGrant[]>;
  reveal(ctx: PluginContext, itemId: string, field: CredentialField): Promise<string>;
};
/** One message from outside people, as a channel plugin saw it. `key` is unique per install (re-polls never deliver twice). */
export type InboundEvent = {
  key: string;
  chat: string;
  chatName: string;
  from: string;
  text: string;
  at: number;
  media?: boolean;
  group?: boolean;
  /** A voice note the plugin can fetch (see `PluginInbound.fetchAudio`); the platform turns it into text before the event is stored. */
  audio?: { ref: string; seconds?: number };
};
export type InboundFilter = { direct: boolean; groups: boolean; chats: string[] };
/**
 * Channel plugins (WhatsApp, Telegram...): new outside messages start a turn for the bot the user picked (see modules/inbound).
 * `poll` must not call ctx.setConfig (the poller cannot re-seal secrets); its cursor is opaque JSON the plugin owns (null = first poll:
 * no backfill, just remember where "now" is). `reply` names the tool and argument a bot uses to answer one chat.
 */
export type PluginInbound = {
  label: string;
  minIntervalSeconds?: number;
  poll(
    ctx: PluginContext,
    cursor: unknown,
    o: { filter: InboundFilter; maxEvents: number },
  ): Promise<{
    events: InboundEvent[];
    cursor: unknown;
    warning?: string;
    /** Push is set up for this user, so the next poll is only a safety net: wait at least this long (never shorter than the route's interval). */
    nextPollSeconds?: number;
  }>;
  /**
   * Push setup, per user and kept in the user's own plugin config (never an environment variable). Called with a context that can save
   * settings, when the user turns incoming messages on and after they change the plugin's settings. Best effort: a failure only means
   * polling stays at its normal speed, and `poll` finishes the setup later when it can.
   */
  enable?(ctx: PluginContext): Promise<void>;
  /**
   * Push: the platform calls this with the raw body of a request from the channel's server (public route, no session), and the config of
   * the user named in the address. "invalid" = the signature does not prove the request came from the channel for this user (answered 401).
   * "ignore" = genuine but not news (for example our own message; answered 200 so the channel does not retry). "wake" = genuine news. The
   * body is never used as message data: "wake" only makes the platform poll that user's route now. "status" = genuine news about the
   * connection itself (a session got linked or lost): the platform tells the user's open pages to read the plugin status again.
   */
  verifyPush?(
    ctx: PluginContext,
    headers: Headers,
    raw: string,
  ): "wake" | "ignore" | "invalid" | "status";
  /**
   * Push that carries the messages (Slack's Events API): the platform calls this with the raw body of a request from the channel's server
   * and the route's filter. The plugin proves the request is genuine (a signature; "invalid" is answered 401), and returns the answer the
   * channel wants (a challenge it asks for once, or a plain acknowledgement) and the new messages, already filtered. The platform stores
   * them like polled ones (once per key, with the same caps and framing) and starts the turn. A plugin with `ingest` is not polled.
   */
  ingest?(
    ctx: PluginContext,
    headers: Headers,
    raw: string,
    o: { filter: InboundFilter },
  ): { response?: { status: number; body: unknown }; events: InboundEvent[] } | "invalid";
  /**
   * The bytes of a voice note an event pointed at with `audio.ref`, at most 10 MB, so the platform can transcribe it on this machine.
   * Like `poll`, it only reads. The plugin checks size and host itself.
   */
  fetchAudio?(ctx: PluginContext, ref: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  reply: { tool: string; chatArg: string; normalize(chat: string): string };
};
export type PluginMcpTarget =
  | { transport: "http"; url: string; secretField?: string }
  | { transport: "stdio"; command: string; args: string[] };

export type PluginDef = {
  id: string; // ^[a-z0-9_-]{1,32}$, unique
  name: string;
  description: string;
  /** icon key in kebab-case (the web app maps known names and falls back to a generic icon). */
  icon: string;
  category: PluginCategory;
  auth: PluginAuth;
  fields: PluginField[];
  docsUrl?: string;
  /** false when the endpoint/command/auth could not be confirmed from official docs. Shown in the UI. */
  verified?: boolean;
  notes?: string;
  /** Numbered setup steps for a person (no secrets). The setup card in the chat and the bot's `zetta:setup` result show them. Evaluated per call so it can use server values. */
  guide?(): string[];
  kind: "mcp" | "native";
  mcp?: PluginMcpTarget;
  tools?: PluginTool[];
  /** Validate / provision after the config is saved. Throw PluginError to abort (the install is rolled back). */
  install?(ctx: PluginContext): Promise<void>;
  /** Start or continue an OAuth/pairing flow. Return a URL for the user to open, or nothing. */
  connect?(
    ctx: PluginContext,
    options?: Record<string, unknown>,
  ): Promise<{
    authorizeUrl?: string;
    qrDataUrl?: string;
    message?: string;
    /** Browser-safe extras for the plugin's own Studio panel. Never secrets. */ data?: Record<
      string,
      unknown
    >;
  } | void>;
  /** Revoke remote access / delete remote state. Runs before the local secret is removed. */
  /** OAuth redirect target (GET /api/plugins/<id>/callback). Runs as the signed-in user; throw PluginError to report a failure. */
  callback?(ctx: PluginContext, params: URLSearchParams): Promise<void>;
  /** `options` is the optional body of the disconnect request (for example `{ account }` to remove one of several accounts). */
  disconnect?(ctx: PluginContext, options?: Record<string, unknown>): Promise<void>;
  /** Health of a native plugin (kind "mcp" is probed by listing its tools instead). */
  status?(ctx: PluginContext): Promise<PluginStatus>;
  /**
   * Plugins whose tools can stop and wait for a person (see PluginPause). `resume` runs when the person answered the card: it continues the
   * paused call and returns the tool result text (or throws another PluginPause when the call stops again). The binding rules that applied to
   * the tool that paused (`PluginPause.pluginTool`) apply to the continuation.
   */
  pausing?: {
    resume(ctx: PluginContext, requestId: string, answer: PluginAnswer): Promise<string>;
  };
  /** Password managers only: the user's grants and server-side reveal (never exposed as a tool). */
  credentials?: PluginCredentials;
  /** Channel plugins only: lets a bot answer new outside messages (see PluginInbound). */
  inbound?: PluginInbound;
  /**
   * Ships with Zetta and needs no configuration: native, and every field optional and not secret. It is not on by default: the person
   * activates it and chooses the bots, like any plugin. The web app shows it as "Built in".
   */
  builtin?: boolean;
  /** Extra conditions of a built-in plugin, checked on every call and prompt after the bot's binding. */
  gate?: {
    /** `turn` says where the call or prompt comes from (see turn.ts); most plugins ignore it. */
    available(botId: string, userId?: string, turn?: PluginTurn): Promise<boolean>;
    /** What a refused call says when `available` is false and "switched off" would mislead (written for a person; no secrets). */
    refusal?: { safe: string; fix: string };
    /** Extra prompt text for this bot (no secrets). */ prompt?(
      botId: string,
      userId?: string,
      turn?: PluginTurn,
    ): Promise<string>;
  };
};

export const DEFAULT_SAFE = "The plugin could not complete that.";
/**
 * `safe` says what went wrong and `fix` says what the USER can do about it (both shown to the user and the bot; no secrets).
 * Write them for a person: "Telegram could not find that chat." / "Ask them to open the bot and press Start."
 */
export class PluginError extends Error {
  constructor(
    readonly code: string,
    readonly safe: string = DEFAULT_SAFE,
    readonly fix?: string,
  ) {
    super(code);
  }
}

/** One field value of a form a paused tool asks for. */
export type PluginFormValue = string | number | boolean | string[];
/** What the person decided on a paused call. `content` is the filled form (empty for a plain approval). */
export type PluginAnswer =
  | { action: "accept"; content: Record<string, PluginFormValue> }
  | { action: "decline" | "cancel" };
/** The question a paused call is waiting on. Everything here is shown to the person, so no secrets. */
export type PluginPauseInfo = {
  requestId: string;
  /** approval: yes or no for one call. input: the tool asks for values (`fields`). */
  mode: "approval" | "input";
  /** The tool the call runs, as the service names it (for example `tools.github.issues.close`). */
  tool: string;
  /** What the service said to the person. Untrusted text: shown, never followed. */
  message: string;
  /** The exact input of the call (approval) as JSON text, already cut. */
  input?: string;
  /** A mail the call sends, in full, so the card can show it as a mail (from, to, subject, text). Only the mailbox plugin sets it. */
  mail?: { from: string; to: string[]; subject: string; text: string };
  /** A phone call the approval places, in full, so the card can show it as a call. Only the phone plugin sets it. */
  phone?: {
    to: string;
    country: string;
    briefing: string;
    maxMinutes: number;
    voicemail: "hang_up" | "leave_message";
  };
  /** The form (mode "input"): one entry per field. */
  fields?: {
    key: string;
    label: string;
    type: "string" | "number" | "boolean";
    required: boolean;
  }[];
  /** Epoch milliseconds. After this the service forgets the request. */
  expiresAt: number;
};
/**
 * Thrown by a tool that cannot go on until a person decides (an approval policy, a form). The chat service turns it into an Approve card
 * and tells the bot to wait; the plugin's `pausing.resume` continues the call when the person answers. A bot can never answer for them.
 */
export class PluginPause extends PluginError {
  /** The plugin tool whose call paused. Set by the plugin service when the call comes through it, so a resume is checked against that tool. */
  pluginTool: string | undefined;
  constructor(
    readonly pause: PluginPauseInfo,
    readonly plugin: string,
  ) {
    super(
      "PAUSED",
      "The call is waiting for the user to approve it.",
      "Wait for the user to answer the card, then you get the result. Do not repeat the call.",
    );
  }
}

const registry = new Map<string, PluginDef>();
const ID = /^[a-z0-9_-]{1,32}$/,
  TOOL = /^[a-zA-Z0-9_.-]{1,64}$/;

/** Registers a plugin. Idempotent for the same object; a different definition under an existing id throws. */
export function registerPlugin(def: PluginDef): PluginDef {
  if (!ID.test(def.id)) throw new Error(`invalid plugin id: ${def.id}`);
  if (def.kind === "mcp" && !def.mcp) throw new Error(`mcp plugin ${def.id} needs "mcp"`);
  if (def.kind === "native" && !def.tools) throw new Error(`native plugin ${def.id} needs "tools"`);
  if (def.builtin && (def.kind !== "native" || def.fields.some((f) => !f.optional || f.secret)))
    throw new Error(
      `built-in plugin ${def.id} must be native with only optional, non-secret fields`,
    );
  if (def.gate && !def.builtin) throw new Error(`plugin ${def.id} has a gate but is not built in`);
  if (def.inbound && !def.tools?.some((t) => t.name === def.inbound!.reply.tool))
    throw new Error(`inbound plugin ${def.id} needs its reply tool`);
  for (const t of def.tools ?? [])
    if (!TOOL.test(t.name)) throw new Error(`invalid tool name: ${t.name}`);
  for (const f of def.fields) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(f.key)) throw new Error(`invalid field key: ${f.key}`);
    if (f.kind === "select" && !f.options?.length)
      throw new Error(`select field ${f.key} needs options`);
  }
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
  id: d.id,
  name: d.name,
  description: d.description,
  icon: d.icon,
  category: d.category,
  auth: d.auth,
  kind: d.kind,
  transport: d.mcp?.transport ?? null,
  fields: d.fields,
  docsUrl: d.docsUrl ?? null,
  verified: d.verified !== false,
  notes: d.notes ?? null,
  guide: d.guide?.() ?? [],
  credentials: Boolean(d.credentials),
  builtin: Boolean(d.builtin),
  inbound: d.inbound ? { label: d.inbound.label } : null,
  tools: (d.tools ?? []).map((t) => ({ name: t.name, description: t.description })),
});
export type PluginMeta = ReturnType<typeof pluginMeta>;
