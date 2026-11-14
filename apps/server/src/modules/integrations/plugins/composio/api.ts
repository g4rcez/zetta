import { createHash } from "node:crypto";
import { PluginError, type PluginContext, type PluginStatus } from "../registry";
import { str } from "../untrusted";

/**
 * Composio (composio.dev) through its REST API v3.1 with the user's own project API key (header `x-api-key`); no SDK, no MCP.
 * Docs: docs.composio.dev (sessions, connected accounts, tools). One Composio "session" per Zetta user holds the toolkits the user allowed:
 *   POST   /tool_router/session                     create (user_id = the Zetta user id; manage_connections and workbench are off)
 *   GET    /tool_router/session/{id}/toolkits       connection state per toolkit
 *   POST   /tool_router/session/{id}/link           Connect Link for one toolkit (the user finishes it on Composio's hosted page)
 *   POST   /tool_router/session/{id}/execute        run one tool
 *   GET    /connected_accounts/{id}                 verifies a finished Connect Link
 * Composio keeps the third-party OAuth tokens. Zetta stores only the API key and these config keys (strings, sealed per user):
 * apiKey, toolkits (allowlist, comma separated), allowWrite ("true"), session (JSON: id, key fingerprint, toolkits it was made for), pending (JSON).
 * Nothing but the allowlist and the switches is returned to the browser or a bot (through `status`).
 */

export type ComposioSettings = {
  apiBase: string;
  redirectBase?: string;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  now: () => number;
};
const defaults: ComposioSettings = {
  apiBase: "https://backend.composio.dev/api/v3.1",
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
};
let overrides: Partial<ComposioSettings> = {};
/** Test hook: point the plugin at a fake Composio. Pass `{}` to reset. */
export const configureComposioForTests = (o: Partial<ComposioSettings>) => {
  overrides = o;
  creating.clear();
  tools.clear();
};
export const settings = (): ComposioSettings => ({
  ...defaults,
  redirectBase: process.env.COMPOSIO_REDIRECT_BASE || process.env.ZETTA_SERVER_URL || undefined,
  ...overrides,
});
export const redirectUri = (s = settings()) =>
  `${(s.redirectBase ?? "").replace(/\/+$/, "")}/api/plugins/composio/callback`;

const HTTP_MS = 15_000,
  LINK_TTL_MS = 10 * 60_000,
  META_TTL_MS = 10 * 60_000,
  MAX_PENDING = 5,
  MAX_TOOLKITS = 50;
const TOOLKIT = /^[a-z0-9][a-z0-9_-]{0,59}$/,
  TOOL = /^[A-Z0-9][A-Z0-9_]{0,119}$/,
  ID = /^[A-Za-z0-9_-]{1,80}$/;
const SETTINGS_HINT = "Open Studio > Plugins > Composio.";

export const toolkitSlug = (v: unknown, name = "toolkit") => {
  const s = str(v, 60).toLowerCase();
  if (!TOOLKIT.test(s))
    throw new PluginError(
      "INVALID_ARGS",
      `${name} must be a Composio toolkit slug such as github.`,
    );
  return s;
};
export const toolSlug = (v: unknown) => {
  const s = str(v, 120).toUpperCase();
  if (!TOOL.test(s))
    throw new PluginError(
      "INVALID_ARGS",
      "tool must be a Composio tool slug such as GITHUB_GET_A_REPOSITORY.",
    );
  return s;
};

export const allowedToolkits = (c: Readonly<Record<string, string>>) =>
  (c.toolkits ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
/** The allowlist as saved by the user: unique valid slugs, capped. */
export const parseToolkits = (v: unknown): string[] => {
  if (!Array.isArray(v)) throw new PluginError("INVALID_FIELD", "Pick toolkits from the list.");
  const list = [...new Set(v.map((x) => toolkitSlug(x)))];
  if (list.length > MAX_TOOLKITS)
    throw new PluginError(
      "INVALID_FIELD",
      `Allow at most ${MAX_TOOLKITS} toolkits.`,
      "Remove some toolkits and save again.",
    );
  return list;
};

const NOT_ALLOWED = (slug: string) =>
  new PluginError(
    "NOT_ALLOWED",
    `${slug} is not on the Composio plugin's allowlist.`,
    `Allow it in ${SETTINGS_HINT} and press Save.`,
  );
export function needAllowed(ctx: PluginContext, slug: string) {
  if (!allowedToolkits(ctx.config).includes(slug)) throw NOT_ALLOWED(slug);
}
export const writesAllowed = (ctx: PluginContext) => ctx.config.allowWrite === "true";

type Init = {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | undefined>;
  body?: unknown;
};
/** Authenticated call. Errors map to safe messages: no upstream text, never the key. */
export async function cfetch(
  ctx: PluginContext,
  path: string,
  init: Init = {},
): Promise<Record<string, unknown>> {
  const s = settings(),
    key = ctx.config.apiKey;
  if (!key)
    throw new PluginError("NEEDS_AUTH", "Composio has no API key.", `Add it in ${SETTINGS_HINT}`);
  const u = new URL(`${s.apiBase}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {}))
    if (v !== undefined) u.searchParams.set(k, v);
  let res: Response;
  try {
    res = await s.fetch(u.toString(), {
      method: init.method ?? "GET",
      headers: {
        "x-api-key": key,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(HTTP_MS),
      redirect: "error",
    });
  } catch {
    throw new PluginError(
      "UNREACHABLE",
      "Composio could not be reached from the server.",
      "Check the server's internet connection, then ask again.",
    );
  }
  if (res.ok) {
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (res.status === 401 || res.status === 403)
    throw new PluginError(
      "AUTH",
      "Composio rejected the API key.",
      `Create a new project API key at dashboard.composio.dev and replace it in ${SETTINGS_HINT} > Settings.`,
    );
  if (res.status === 402)
    throw new PluginError(
      "QUOTA",
      "Your Composio plan has no usage left.",
      "Check the plan and usage in the Composio dashboard.",
    );
  if (res.status === 404)
    throw new PluginError(
      "NOT_FOUND",
      "Composio could not find that.",
      "Check the toolkit, tool or account.",
    );
  if (res.status === 429) {
    const wait = Math.max(1, Math.ceil(Number(res.headers.get("retry-after")) || 60));
    throw new PluginError(
      "RATE_LIMITED",
      "Composio is rate limiting this API key.",
      `Wait about ${wait} seconds and ask again.`,
    );
  }
  if (res.status === 400 || res.status === 422)
    throw new PluginError(
      "COMPOSIO_REJECTED",
      "Composio rejected that request.",
      "Check the toolkit and the arguments, then ask again.",
    );
  throw new PluginError(
    "COMPOSIO_UNAVAILABLE",
    `Composio could not complete that (HTTP ${res.status}).`,
    "Try again in a few minutes.",
  );
}

const items = (r: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];

// ---------- session ----------
type Session = { id: string; key: string; toolkits: string };
const fingerprint = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 16);
const readSession = (c: Readonly<Record<string, string>>): Session | undefined => {
  try {
    const v = c.session ? JSON.parse(c.session) : undefined;
    return v && typeof v.id === "string" && ID.test(v.id) ? v : undefined;
  } catch {
    return undefined;
  }
};
const creating = new Map<string, Promise<string>>();
/**
 * The user's Composio session, created on first use. Sessions never expire, so it is reused until the API key or the allowlist changes;
 * then a new one is made and the old one is deleted (best effort). Concurrent callers of one user share a single creation.
 */
export async function ensureSession(ctx: PluginContext): Promise<string> {
  const want = [...allowedToolkits(ctx.config)].sort();
  if (!want.length)
    throw new PluginError(
      "NOT_CONFIGURED",
      "No Composio toolkit is allowed yet.",
      `Pick the toolkits bots may use in ${SETTINGS_HINT} and press Save.`,
    );
  const key = fingerprint(ctx.config.apiKey ?? ""),
    have = readSession(ctx.config);
  if (have && have.key === key && have.toolkits === want.join(",")) return have.id;
  const hit = creating.get(ctx.userId);
  if (hit) return hit;
  const work = (async () => {
    const r = await cfetch(ctx, "/tool_router/session", {
      method: "POST",
      body: {
        user_id: ctx.userId,
        toolkits: { enable: want },
        manage_connections: { enable: false },
        workbench: { enable: false },
      },
    });
    const id = r.session_id;
    if (typeof id !== "string" || !ID.test(id))
      throw new PluginError(
        "COMPOSIO_UNAVAILABLE",
        "Composio did not start a session.",
        "Try again in a few minutes.",
      );
    const old = have && have.key === key ? have.id : undefined;
    await ctx.setConfig({
      ...ctx.config,
      session: JSON.stringify({ id, key, toolkits: want.join(",") } satisfies Session),
    });
    if (old) await cfetch(ctx, `/tool_router/session/${old}`, { method: "DELETE" }).catch(() => {});
    return id;
  })().finally(() => creating.delete(ctx.userId));
  creating.set(ctx.userId, work);
  return work;
}

export type ToolkitState = { slug: string; name: string; connected: boolean; accountId?: string };
/** Connection state of the allowed toolkits (one call). */
export async function toolkitStates(ctx: PluginContext): Promise<ToolkitState[]> {
  const allowed = allowedToolkits(ctx.config);
  const id = await ensureSession(ctx); // throws NOT_CONFIGURED when nothing is allowed
  const r = await cfetch(ctx, `/tool_router/session/${id}/toolkits`, {
    query: { toolkits: allowed.join(","), limit: String(MAX_TOOLKITS) },
  });
  const found = new Map(items(r).map((t) => [String(t.slug), t]));
  return allowed.map((slug) => {
    const t = found.get(slug),
      acc = t?.connected_account as { id?: unknown; status?: unknown } | null | undefined;
    const active = acc?.status === "ACTIVE" && typeof acc.id === "string";
    return {
      slug,
      name: typeof t?.name === "string" ? t.name.slice(0, 80) : slug,
      connected: active,
      accountId: active ? (acc!.id as string) : undefined,
    };
  });
}

// ---------- tool metadata ----------
export type ToolInfo = {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
  readOnly: boolean;
  input: unknown;
};
const tools = new Map<string, { at: number; info: ToolInfo }>();
export const toToolInfo = (t: Record<string, unknown>): ToolInfo => ({
  slug: String(t.slug),
  name: String(t.name ?? t.slug),
  description: String(t.description ?? ""),
  toolkit: String((t.toolkit as { slug?: unknown } | undefined)?.slug ?? "").toLowerCase(),
  // Fail closed: only a tool Composio itself tags readOnlyHint counts as read-only.
  readOnly: Array.isArray(t.tags) && t.tags.includes("readOnlyHint"),
  input: t.input_parameters,
});
/** Metadata of one tool (cached: tool schemas are the same for every user). */
export async function toolInfo(ctx: PluginContext, slug: string): Promise<ToolInfo> {
  const hit = tools.get(slug),
    now = settings().now();
  if (hit && now - hit.at < META_TTL_MS) return hit.info;
  const info = toToolInfo(await cfetch(ctx, `/tools/${encodeURIComponent(slug)}`));
  if (!info.toolkit)
    throw new PluginError(
      "NOT_FOUND",
      "Composio could not find that tool.",
      "Search for the tool again.",
    );
  if (tools.size >= 500) tools.clear();
  tools.set(slug, { at: now, info });
  return info;
}

// ---------- lifecycle ----------
const readPending = (
  c: Readonly<Record<string, string>>,
): { id: string; toolkit: string; exp: number }[] => {
  try {
    const v = c.pending ? JSON.parse(c.pending) : [];
    return Array.isArray(v)
      ? v.filter((p) => ID.test(p?.id) && TOOLKIT.test(p?.toolkit) && typeof p?.exp === "number")
      : [];
  } catch {
    return [];
  }
};

export async function install(ctx: PluginContext): Promise<void> {
  if (!/^\S{8,200}$/.test(ctx.config.apiKey ?? ""))
    throw new PluginError(
      "INVALID_FIELD",
      "That does not look like a Composio API key.",
      "Copy the project API key from dashboard.composio.dev.",
    );
  await cfetch(ctx, "/toolkits", { query: { limit: "1" } }); // 401 -> AUTH: the install is rolled back
}

/** Settings and connect actions of the Studio panel (`options.action`). */
export async function connect(
  ctx: PluginContext,
  options: Record<string, unknown> = {},
): Promise<{ authorizeUrl?: string; message?: string; data?: Record<string, unknown> }> {
  const action = options.action;
  if (action === "search") {
    const r = await cfetch(ctx, "/toolkits", {
      query: { search: str(options.query, 60) || undefined, limit: "20" },
    });
    return {
      data: {
        toolkits: items(r)
          .map((t) => ({ slug: String(t.slug), name: String(t.name ?? t.slug).slice(0, 80) }))
          .filter((t) => TOOLKIT.test(t.slug)),
      },
    };
  }
  if (action === "save") {
    const list = parseToolkits(options.toolkits),
      next = { ...ctx.config };
    if (list.length) next.toolkits = list.join(",");
    else delete next.toolkits;
    if (options.allowWrite === true && list.length) next.allowWrite = "true";
    else delete next.allowWrite;
    await ctx.setConfig(next);
    return { message: "Settings saved." };
  }
  if (action === "link") {
    const s = settings();
    if (!s.redirectBase)
      throw new PluginError(
        "NOT_CONFIGURED",
        "The server has no public address for the sign-in callback.",
        "Set ZETTA_SERVER_URL on the server.",
      );
    const toolkit = toolkitSlug(options.toolkit);
    needAllowed(ctx, toolkit);
    const id = await ensureSession(ctx);
    const r = await cfetch(ctx, `/tool_router/session/${id}/link`, {
      method: "POST",
      body: { toolkit, callback_url: redirectUri(s) },
    });
    const url = typeof r.redirect_url === "string" ? r.redirect_url : "",
      caId = r.connected_account_id;
    if (!url.startsWith("https://") || typeof caId !== "string" || !ID.test(caId))
      throw new PluginError(
        "COMPOSIO_UNAVAILABLE",
        "Composio did not return a sign-in link.",
        "Try again in a few minutes.",
      );
    const pending = [
      ...readPending(ctx.config).filter((p) => p.exp > s.now()),
      { id: caId, toolkit, exp: s.now() + LINK_TTL_MS },
    ].slice(-MAX_PENDING);
    await ctx.setConfig({ ...ctx.config, pending: JSON.stringify(pending) });
    return { authorizeUrl: url };
  }
  if (action === "unlink") {
    const toolkit = toolkitSlug(options.toolkit),
      state = (await toolkitStates(ctx)).find((t) => t.slug === toolkit);
    if (state?.accountId)
      await cfetch(ctx, `/connected_accounts/${state.accountId}`, { method: "DELETE" });
    return { message: `${toolkit} disconnected.` };
  }
  throw new PluginError("INVALID_ARGS", "Unknown Composio action.", "Reload Studio and try again.");
}

const INVALID = () =>
  new PluginError(
    "INVALID_STATE",
    "That Composio sign-in link is no longer valid.",
    `Start again from ${SETTINGS_HINT}`,
  );
const consuming = new Set<string>();
/**
 * Redirect target of Composio's Connect Link page. The query is not proof of anything, so it is checked against the attempt this user
 * started (single use, 10 minutes), and Composio is asked whether that account is ACTIVE for that toolkit.
 */
export async function callback(ctx: PluginContext, params: URLSearchParams): Promise<void> {
  const s = settings(),
    id = params.get("connected_account_id") ?? "";
  if (!ID.test(id) || consuming.has(ctx.userId)) throw INVALID();
  const all = readPending(ctx.config),
    hit = all.find((p) => p.id === id);
  if (!hit) throw INVALID();
  consuming.add(ctx.userId);
  try {
    await ctx.setConfig({ ...ctx.config, pending: JSON.stringify(all.filter((p) => p.id !== id)) }); // single use: gone before the check
    if (s.now() > hit.exp)
      throw new PluginError(
        "STATE_EXPIRED",
        "That Composio sign-in took too long.",
        `Start again from ${SETTINGS_HINT}`,
      );
    if (params.get("status") !== "success")
      throw new PluginError(
        "ACCESS_DENIED",
        "Composio did not finish the sign-in.",
        "Connect again and allow access on the provider's page.",
      );
    const a = await cfetch(ctx, `/connected_accounts/${id}`);
    if (
      a.status !== "ACTIVE" ||
      String((a.toolkit as { slug?: unknown } | undefined)?.slug ?? "").toLowerCase() !==
        hit.toolkit
    )
      throw new PluginError(
        "EXCHANGE_FAILED",
        "Composio could not confirm that account.",
        "Connect again. If it keeps failing, check the account on the provider's page.",
      );
  } finally {
    consuming.delete(ctx.userId);
  }
}

export async function disconnect(ctx: PluginContext): Promise<void> {
  const have = readSession(ctx.config);
  if (have)
    await cfetch(ctx, `/tool_router/session/${have.id}`, { method: "DELETE" }).catch(() => {}); // best effort; connected accounts stay in the user's Composio project
  const keep: Record<string, string> = {};
  for (const k of ["apiKey", "toolkits", "allowWrite"]) if (ctx.config[k]) keep[k] = ctx.config[k]!;
  await ctx.setConfig(keep);
}

export async function status(ctx: PluginContext): Promise<PluginStatus> {
  const allowed = allowedToolkits(ctx.config),
    allowWrite = writesAllowed(ctx);
  if (!allowed.length)
    return {
      state: "needs-auth",
      detail: "Pick the toolkits bots may use.",
      info: { toolkits: [], allowWrite },
    };
  let states: ToolkitState[];
  try {
    states = await toolkitStates(ctx);
  } catch (e) {
    if (e instanceof PluginError)
      return {
        state: e.code === "AUTH" || e.code === "NEEDS_AUTH" ? "needs-auth" : "error",
        detail: e.safe,
      };
    throw e;
  }
  const n = states.filter((t) => t.connected).length;
  return {
    state: "connected",
    detail: `${n} of ${states.length} allowed toolkits connected`,
    info: {
      toolkits: states.map(({ slug, name, connected }) => ({ slug, name, connected })),
      allowWrite,
    },
  };
}
