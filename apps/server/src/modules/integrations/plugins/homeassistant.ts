import { isLayaTag } from "@zetta/core/laya-languages";
import { assertPublicUrl } from "../../computer/service";
import {
  PluginError,
  registerPlugin,
  type PluginContext,
  type PluginDef,
  type PluginStatus,
} from "./registry";

/**
 * Home Assistant through its REST API, with a long-lived access token (docs: https://developers.home-assistant.io/docs/api/rest/).
 * Endpoints used: GET /api/ (health + token check), GET /api/states, POST /api/services/{domain}/{service},
 * POST /api/conversation/process (Assist: HA's own local intent engine, no LLM).
 *
 * SSRF: the base URL is user supplied. Same policy as WhatsApp and MCP servers: `assertPublicUrl` unless the operator enabled
 * `allowPrivate`. A Home Assistant server is almost always on a LAN, so ZETTA_ALLOW_PRIVATE_NETWORK=1 is the normal case.
 * Redirects are never followed, so the bearer token is only ever sent to the address the user typed.
 */
let policy = { allowPrivate: false };
/** Called once by the MCP service with its own `allowPrivate` option. */
export const configureHomeAssistant = (p: { allowPrivate?: boolean }) => {
  policy = { allowPrivate: Boolean(p.allowPrivate) };
};

const TIMEOUT_MS = 10_000,
  MAX_BODY = 4_000_000,
  MAX_STATES = 200,
  MAX_TEXT = 500;
/** The built-in (non-LLM) Assist agent. Pinned, so a user whose default agent is an LLM still gets the deterministic one. */
const ASSIST_AGENT = "conversation.home_assistant";
const SLUG = /^[a-z0-9_]{1,64}$/,
  ENTITY = /^[a-z0-9_]{1,64}\.[a-z0-9_]{1,64}$/;

const base = (c: PluginContext) => {
  try {
    const u = new URL((c.config.baseUrl ?? "").trim());
    if (!/^https?:$/.test(u.protocol)) throw 0;
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    throw new PluginError(
      "BAD_URL",
      "The Home Assistant address is not a valid http(s) URL.",
      "Use an address such as http://homeassistant.local:8123.",
    );
  }
};

async function haFetch(
  c: PluginContext,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const url = base(c) + path;
  if (!policy.allowPrivate)
    await assertPublicUrl(url).catch(() => {
      throw new PluginError(
        "BLOCKED_URL",
        "That address is not allowed (private addresses must be enabled by the administrator).",
        "Ask the administrator to set ZETTA_ALLOW_PRIVATE_NETWORK=1, or use a public https address.",
      );
    });
  const token = (c.config.token ?? "").trim();
  if (!token)
    throw new PluginError(
      "NOT_CONFIGURED",
      "Home Assistant has no access token.",
      "Open the plugin and paste a long-lived access token.",
    );
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new PluginError(
      "UNREACHABLE",
      "Home Assistant could not be reached.",
      "Check the address and that the server is running.",
    );
  }
  if (res.status === 401 || res.status === 403)
    throw new PluginError(
      "NEEDS_AUTH",
      "Home Assistant rejected the access token.",
      "Create a new long-lived access token (profile > Security) and update the plugin.",
    );
  if (res.status >= 300)
    throw new PluginError("HA_ERROR", `Home Assistant answered ${res.status}.`);
  const text = await res.text();
  if (text.length > MAX_BODY)
    throw new PluginError("TOO_LARGE", "Home Assistant answered with too much data.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new PluginError("HA_ERROR", "Home Assistant answered with something unexpected.");
  }
}

type State = { entity_id?: unknown; state?: unknown; attributes?: { friendly_name?: unknown } };
const compact = (s: State) => ({
  entity_id: String(s.entity_id ?? ""),
  name: typeof s.attributes?.friendly_name === "string" ? s.attributes.friendly_name : undefined,
  state: String(s.state ?? ""),
});

export type AssistResult = { type: string; speech: string };

const MAX_LANGUAGES = 5;
/** The saved "language" value is a comma separated list ("pt-BR,en"; a single tag from older settings is a list of one). */
export const assistLanguages = (value: string | undefined): string[] =>
  [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(isLayaTag),
    ),
  ].slice(0, MAX_LANGUAGES);

async function assistOnce(
  c: PluginContext,
  text: string,
  language?: string,
): Promise<AssistResult> {
  const r = (await haFetch(c, "/api/conversation/process", {
    method: "POST",
    body: { text, agent_id: ASSIST_AGENT, ...(language ? { language } : {}) },
  })) as { response?: { response_type?: unknown; speech?: { plain?: { speech?: unknown } } } };
  const speech = r.response?.speech?.plain?.speech;
  return {
    type: typeof r.response?.response_type === "string" ? r.response.response_type : "error",
    speech: typeof speech === "string" ? speech.slice(0, MAX_TEXT) : "",
  };
}

/**
 * Sends a sentence to Home Assistant's own Assist intent engine (local matching of entities, areas and aliases; no LLM).
 * `type` is HA's `response_type`: "action_done", "query_answer" or "error" (no match, unknown target...).
 * Assist takes one language per request, so each configured language is tried in order and the first answer that is not an
 * error wins. When all fail, the answer of the first language is returned. No language: Home Assistant uses its own.
 */
export async function assist(c: PluginContext, text: string): Promise<AssistResult> {
  const languages = assistLanguages(c.config.language);
  if (languages.length === 0) return assistOnce(c, text);
  let first: AssistResult | undefined;
  for (const language of languages) {
    const answer = await assistOnce(c, text, language);
    if (answer.type !== "error") return answer;
    first ??= answer;
  }
  return first!;
}

const def: PluginDef = {
  id: "homeassistant",
  name: "Home Assistant",
  icon: "home",
  category: "other",
  kind: "native",
  auth: "api-key",
  docsUrl: "https://developers.home-assistant.io/docs/api/rest/",
  description:
    "Read the state of your smart home and control it through your own Home Assistant server.",
  notes:
    "Needs a Home Assistant server that Zetta can reach. Home Assistant is usually on a private network, so the administrator must set ZETTA_ALLOW_PRIVATE_NETWORK=1. The token has the full power of your Home Assistant user. 'Fast control' answers simple commands with Home Assistant's own Assist engine instead of the AI; it needs the decision model (Laya) turned on and only acts on entities you expose to Assist in Home Assistant.",
  guide: () => [
    "In Home Assistant open your profile (bottom left) > Security > Long-lived access tokens > Create token.",
    "Copy the token now: Home Assistant shows it only once.",
    "Enter the address of your server (for example http://homeassistant.local:8123) and the token here.",
    "Optional: set 'Fast control' to on. In Home Assistant, Settings > Voice assistants > Expose decides which entities it may control.",
  ],
  fields: [
    {
      key: "baseUrl",
      label: "Home Assistant URL",
      kind: "url",
      placeholder: "http://homeassistant.local:8123",
      help: "Private addresses such as 192.168.x.x or .local require the administrator to enable private networks.",
    },
    {
      key: "token",
      label: "Long-lived access token",
      secret: true,
      kind: "password",
      help: "Home Assistant profile > Security > Long-lived access tokens.",
    },
    {
      key: "fastControl",
      label: "Fast control",
      kind: "select",
      optional: true,
      options: [
        { value: "off", label: "Off: the AI handles every message" },
        { value: "on", label: "On: simple commands skip the AI" },
      ],
      help: "Simple home commands are sent straight to Home Assistant Assist. Needs the decision model (Laya) turned on.",
    },
    {
      key: "language",
      label: "Assist languages",
      kind: "languages",
      optional: true,
      help: "Home Assistant tries them in this order. Empty uses the language of your Home Assistant.",
    },
  ],
  async install(ctx) {
    await haFetch(ctx, "/api/");
  },
  async status(ctx): Promise<PluginStatus> {
    try {
      await haFetch(ctx, "/api/");
      return { state: "connected" };
    } catch (e) {
      if (e instanceof PluginError)
        return e.code === "NEEDS_AUTH"
          ? { state: "needs-auth", detail: e.safe }
          : { state: "error", detail: e.safe };
      throw e;
    }
  },
  tools: [
    {
      name: "states",
      description:
        "List the entities of the smart home with their state (id, name, state). Filter by domain such as light, switch, climate or sensor. At most 200 are returned.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: { domain: { type: "string", description: "For example light" } },
      },
      async handler(ctx, args) {
        const domain = typeof args.domain === "string" ? args.domain.trim() : "";
        if (domain && !SLUG.test(domain))
          throw new PluginError("INVALID_ARGS", "The domain is not valid.");
        const all = await haFetch(ctx, "/api/states");
        const rows = (Array.isArray(all) ? (all as State[]) : [])
          .filter((s) => !domain || String(s.entity_id).startsWith(`${domain}.`))
          .map(compact);
        return { total: rows.length, states: rows.slice(0, MAX_STATES) };
      },
    },
    {
      name: "call_service",
      description:
        "Call a Home Assistant service, for example domain light, service turn_off, entity_id light.kitchen. Use 'states' first when you do not know the entity id.",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string" },
          service: { type: "string" },
          entity_id: { type: "string" },
          data: { type: "object", description: "Extra service data, for example brightness_pct" },
        },
        required: ["domain", "service"],
      },
      async handler(ctx, args) {
        const { domain, service, entity_id: entity, data } = args;
        if (typeof domain !== "string" || !SLUG.test(domain))
          throw new PluginError("INVALID_ARGS", "The domain is not valid.");
        if (typeof service !== "string" || !SLUG.test(service))
          throw new PluginError("INVALID_ARGS", "The service is not valid.");
        if (entity !== undefined && (typeof entity !== "string" || !ENTITY.test(entity)))
          throw new PluginError("INVALID_ARGS", "The entity id is not valid.");
        if (
          data !== undefined &&
          (typeof data !== "object" || data === null || Array.isArray(data))
        )
          throw new PluginError("INVALID_ARGS", "The data must be an object.");
        const changed = await haFetch(ctx, `/api/services/${domain}/${service}`, {
          method: "POST",
          body: { ...(data as object | undefined), ...(entity ? { entity_id: entity } : {}) },
        });
        return { changed: (Array.isArray(changed) ? (changed as State[]) : []).map(compact) };
      },
    },
    {
      name: "assist",
      description:
        "Send a plain sentence such as 'turn off the kitchen light' to Home Assistant's own Assist engine. Returns what Home Assistant answered.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      async handler(ctx, args) {
        const text = typeof args.text === "string" ? args.text.trim() : "";
        if (!text || text.length > 500)
          throw new PluginError("INVALID_ARGS", "The text must have 1 to 500 characters.");
        return assist(ctx, text);
      },
    },
  ],
};
export const HOME_ASSISTANT = registerPlugin(def);
