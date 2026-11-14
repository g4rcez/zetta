import { randomBytes, timingSafeEqual } from "node:crypto";
import { b64u, sha } from "../oauth2";
import { PluginError, type PluginContext, type PluginStatus } from "../registry";
import { clean } from "../untrusted";

/**
 * Reddit OAuth2 "web app" flow (Authorization Code + state), used as an INTEGRATION grant for bot tools. See github.com/reddit-archive/reddit/wiki/OAuth2:
 *   auth    https://www.reddit.com/api/v1/authorize     (response_type=code, duration=permanent, scope space separated, state)
 *   token   https://www.reddit.com/api/v1/access_token  (HTTP Basic client_id:client_secret; authorization_code and refresh_token grants)
 *   revoke  https://www.reddit.com/api/v1/revoke_token  (HTTP Basic; token + token_type_hint)
 *   api     https://oauth.reddit.com                    (Bearer token; a descriptive User-Agent is mandatory or Reddit throttles/blocks)
 * Reddit does not support PKCE, so the pending authorization (sha256(state), expiry, requested scopes and switches) is kept INSIDE the user's own
 * sealed plugin config exactly like the Google plugin: bound to the signed-in user, single use, never in the browser.
 *
 * Config keys (strings): clientId, clientSecret (the user's own Reddit "web app", entered when installing; kept across disconnects), refreshToken, accessToken, expiresAt (epoch ms), username, over18 ("true": the account's own "I'm over 18" preference),
 * scopes (granted, space separated), allowNsfw ("true"), allowWrite ("true"), subreddits (write allowlist, comma separated), pending (JSON).
 * None of them is ever returned to the browser or to a bot except the username, the scopes and the switches (through `status`).
 */

/** Scopes the user can tick. `identity` is always requested on top (it names the account and reads the over-18 preference). */
export const SCOPES = {
  read: { label: "Read posts and comments, browse and search subreddits", write: false },
  history: { label: "Read your saved, upvoted, posts and comments history", write: false },
  mysubreddits: { label: "List the subreddits you joined", write: false },
  privatemessages: { label: "Read your inbox (sending also needs Allow actions)", write: false },
  submit: { label: "Create posts and comments", write: true },
  vote: { label: "Upvote and downvote", write: true },
  edit: { label: "Edit and delete your posts and comments", write: true },
  save: { label: "Save and unsave posts and comments", write: true },
  subscribe: { label: "Join and leave subreddits", write: true },
} as const;
export type ScopeId = keyof typeof SCOPES;
export const SCOPE_IDS = Object.keys(SCOPES) as ScopeId[];
const IDENTITY = "identity";

export type RedditSettings = {
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  apiBase: string;
  clientId?: string;
  clientSecret?: string;
  redirectBase?: string;
  userAgent: string;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  now: () => number;
};
const defaults: Omit<RedditSettings, "userAgent"> = {
  authUrl: "https://www.reddit.com/api/v1/authorize",
  tokenUrl: "https://www.reddit.com/api/v1/access_token",
  revokeUrl: "https://www.reddit.com/api/v1/revoke_token",
  apiBase: "https://oauth.reddit.com",
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
};
let overrides: Partial<RedditSettings> = {};
/** Test hook: point the plugin at a fake Reddit. Pass `{}` to reset. */
export const configureRedditForTests = (o: Partial<RedditSettings>) => {
  overrides = o;
  refreshing.clear();
  callbacks.clear();
};
/**
 * The OAuth client comes from the installing user's sealed config, so every user (and the bots they bind) uses their own Reddit app and its
 * own rate limit. Reddit asks for a User-Agent naming the developer account; once connected it names the user's own account.
 */
export const settings = (config: Readonly<Record<string, string>> = {}): RedditSettings => ({
  ...defaults,
  clientId: config.clientId || undefined,
  clientSecret: config.clientSecret || undefined,
  redirectBase: process.env.REDDIT_OAUTH_REDIRECT_BASE || process.env.ZETTA_SERVER_URL || undefined,
  userAgent: `server:zetta-plugin:1.0${config.username ? ` (by /u/${config.username})` : ""}`,
  ...overrides,
});
export const redirectUri = (s = settings()) =>
  `${(s.redirectBase ?? "").replace(/\/+$/, "")}/api/plugins/reddit/callback`;
export const KEEP_ON_DISCONNECT = ["clientId", "clientSecret"] as const;
const NOT_CONFIGURED = () =>
  new PluginError(
    "NOT_CONFIGURED",
    "Reddit has no app yet.",
    `Create a "web app" at reddit.com/prefs/apps with ${redirectUri()} as its redirect uri, then enter its client id and secret in Studio > Plugins > Reddit > Settings.`,
  );
const requireConfigured = (config: Readonly<Record<string, string>>) => {
  const s = settings(config);
  if (!s.clientId || !s.clientSecret || !s.redirectBase) throw NOT_CONFIGURED();
  return s as RedditSettings & { clientId: string; clientSecret: string; redirectBase: string };
};

const STATE_TTL_MS = 10 * 60_000,
  SKEW_MS = 60_000,
  HTTP_MS = 15_000;
const RECONNECT = "Reconnect Reddit in Studio > Plugins > Reddit.";

export const grantedScopes = (c: Readonly<Record<string, string>>) =>
  new Set((c.scopes ?? "").split(" ").filter(Boolean));
const isScope = (v: unknown): v is ScopeId => typeof v === "string" && v in SCOPES;

/** Throws unless at least one of `any` was granted. */
export function needScope(ctx: PluginContext, ...any: ScopeId[]) {
  if (!ctx.config.refreshToken)
    throw new PluginError(
      "NEEDS_AUTH",
      "Reddit is not connected.",
      "Connect Reddit in Studio > Plugins > Reddit.",
    );
  const g = grantedScopes(ctx.config);
  if (!any.some((s) => g.has(s)))
    throw new PluginError(
      "SCOPE_MISSING",
      `That needs Reddit access that was not granted (${any.map((s) => SCOPES[s].label).join(" / ")}).`,
      `Tick it in Studio > Plugins > Reddit and press Update permissions.`,
    );
}

const SUB = /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;
/** `r/Foo`, `/r/foo/` or `foo` -> `foo` (lowercase for comparisons). Throws on anything else. */
export function subName(v: unknown, name = "subreddit"): string {
  const s = String(v ?? "")
    .trim()
    .replace(/^\/?r\//i, "")
    .replace(/\/+$/, "");
  if (!SUB.test(s))
    throw new PluginError("INVALID_ARGS", `${name} must be a subreddit name such as r/typescript.`);
  return s;
}
/** Parses the write allowlist. Throws on a bad entry when saving; `lenient` skips them when enforcing. */
export const allowlist = (raw: string | undefined, lenient = false) =>
  (raw ?? "")
    .split(/[\s,;]+/)
    .filter(Boolean)
    .flatMap((s) => {
      try {
        return [subName(s).toLowerCase()];
      } catch (e) {
        if (lenient) return [];
        throw new PluginError(
          "INVALID_FIELD",
          `"${clean(s, 30)}" is not a subreddit name.`,
          (e as PluginError).fix,
        );
      }
    });

const basic = (s: { clientId: string; clientSecret: string }) =>
  `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64")}`;
const post = async (
  s: ReturnType<typeof requireConfigured>,
  url: string,
  form: Record<string, string>,
) => {
  const res = await s.fetch(url, {
    method: "POST",
    headers: {
      authorization: basic(s),
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": s.userAgent,
    },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(HTTP_MS),
    redirect: "error",
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty body (revoke) */
  }
  return { ok: res.ok, status: res.status, body };
};

/** Applies the switches the user chose in the connect panel. `allowNsfw` / `allowWrite` only stick when they make sense. */
function preferences(
  base: Record<string, string>,
  options: Record<string, unknown>,
  scopes: Set<string>,
): Record<string, string> {
  const next = { ...base };
  if (options.allowNsfw === true) next.allowNsfw = "true";
  else if (options.allowNsfw === false) delete next.allowNsfw;
  if (
    options.allowWrite === true &&
    (SCOPE_IDS.some((s) => SCOPES[s].write && scopes.has(s)) || scopes.has("privatemessages"))
  )
    next.allowWrite = "true";
  else if (options.allowWrite !== undefined) delete next.allowWrite;
  if (typeof options.subreddits === "string") {
    const list = allowlist(options.subreddits.slice(0, 2000));
    if (list.length) next.subreddits = list.slice(0, 50).join(", ");
    else delete next.subreddits;
  }
  return next;
}

/** connect(): validates the user's choices, stores the pending flow and returns Reddit's consent URL (or only saves the switches). */
export async function startConnect(
  ctx: PluginContext,
  options: Record<string, unknown> = {},
): Promise<{ authorizeUrl?: string; message?: string }> {
  const s = requireConfigured(ctx.config);
  const raw = Array.isArray(options.scopes) ? options.scopes : [];
  if (!raw.every(isScope))
    throw new PluginError(
      "INVALID_SCOPE",
      "Unknown Reddit permission.",
      "Reload Studio and pick the permissions again.",
    );
  const want = [...new Set(raw as ScopeId[])];
  if (!want.length && !ctx.config.refreshToken)
    throw new PluginError(
      "INVALID_SCOPE",
      "Pick at least one Reddit permission.",
      "Tick what bots may do, then connect.",
    );
  const have = grantedScopes(ctx.config);
  // Nothing new to ask Reddit for: only the switches change.
  if (ctx.config.refreshToken && want.every((w) => have.has(w))) {
    const { pending: _p, ...rest } = ctx.config;
    await ctx.setConfig(preferences(rest, options, have));
    return { message: "Settings saved." };
  }
  allowlist(typeof options.subreddits === "string" ? options.subreddits : ""); // report a bad allowlist before leaving for Reddit
  const state = b64u(randomBytes(32));
  const pending = {
    s: b64u(sha(state)),
    exp: s.now() + STATE_TTL_MS,
    scopes: want,
    allowNsfw: options.allowNsfw === true,
    allowWrite: options.allowWrite === true,
    subreddits:
      typeof options.subreddits === "string" ? options.subreddits.slice(0, 2000) : undefined,
  };
  await ctx.setConfig({ ...ctx.config, pending: JSON.stringify(pending) });
  const u = new URL(s.authUrl);
  const q: Record<string, string> = {
    client_id: s.clientId,
    response_type: "code",
    state,
    redirect_uri: redirectUri(s),
    duration: "permanent",
    scope: [IDENTITY, ...want].join(" "),
  };
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return { authorizeUrl: u.toString() };
}

const callbacks = new Set<string>();
const INVALID = () =>
  new PluginError(
    "INVALID_STATE",
    "That Reddit sign-in link is no longer valid.",
    "Start again from Studio > Plugins > Reddit.",
  );
/** The redirect target of Reddit. Validates state, consumes it, exchanges the code and seals the tokens. Throws PluginError on every failure. */
export async function finishConnect(ctx: PluginContext, params: URLSearchParams): Promise<void> {
  const s = requireConfigured(ctx.config);
  let pending:
    | {
        s: string;
        exp: number;
        scopes: string[];
        allowNsfw: boolean;
        allowWrite: boolean;
        subreddits?: string;
      }
    | undefined;
  try {
    pending = ctx.config.pending ? JSON.parse(ctx.config.pending) : undefined;
  } catch {
    pending = undefined;
  }
  const state = params.get("state") ?? "";
  if (!pending || !state) throw INVALID();
  const a = Buffer.from(b64u(sha(state))),
    b = Buffer.from(pending.s);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw INVALID();
  if (callbacks.has(ctx.userId)) throw INVALID();
  callbacks.add(ctx.userId);
  try {
    const { pending: _drop, ...rest } = ctx.config;
    await ctx.setConfig(rest); // single use: gone before the code is exchanged
    if (s.now() > pending.exp)
      throw new PluginError(
        "STATE_EXPIRED",
        "That Reddit sign-in took too long.",
        "Start again from Studio > Plugins > Reddit.",
      );
    const error = params.get("error");
    if (error)
      throw error === "access_denied"
        ? new PluginError(
            "ACCESS_DENIED",
            "Reddit access was declined.",
            "Connect again and press Allow on Reddit's page.",
          )
        : new PluginError(
            "REDDIT_ERROR",
            "Reddit refused the sign-in request.",
            "Check the app's redirect uri at reddit.com/prefs/apps, then start again.",
          );
    const code = params.get("code");
    if (!code || code.length > 2000)
      throw new PluginError(
        "INVALID_STATE",
        "Reddit did not return a code.",
        "Start again from Studio > Plugins > Reddit.",
      );
    const r = await post(s, s.tokenUrl, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(s),
    });
    const t = r.body;
    if (!r.ok || typeof t.access_token !== "string")
      throw new PluginError(
        "EXCHANGE_FAILED",
        "Reddit rejected the sign-in.",
        "Start again. If it keeps failing, check the app's client id, secret and redirect uri.",
      );
    const refresh = typeof t.refresh_token === "string" ? t.refresh_token : rest.refreshToken;
    if (!refresh)
      throw new PluginError(
        "NO_REFRESH_TOKEN",
        "Reddit did not grant permanent access.",
        "Remove Zetta under reddit.com/prefs/apps (authorized apps) and connect again.",
      );
    const granted = new Set(
      String(t.scope ?? "")
        .split(/[\s,]+/)
        .filter(isScope),
    );
    let next: Record<string, string> = {
      ...rest,
      refreshToken: refresh,
      accessToken: t.access_token,
      expiresAt: String(s.now() + Number(t.expires_in ?? 3600) * 1000),
      scopes: [...granted].join(" "),
    };
    const me = await fetchMe(s, t.access_token);
    if (me?.name) next.username = me.name;
    if (me?.over18) next.over18 = "true";
    else delete next.over18;
    next = preferences(
      next,
      {
        allowNsfw: pending.allowNsfw,
        allowWrite: pending.allowWrite,
        ...(pending.subreddits !== undefined ? { subreddits: pending.subreddits } : {}),
      },
      granted,
    );
    await ctx.setConfig(next);
  } finally {
    callbacks.delete(ctx.userId);
  }
}

async function fetchMe(
  s: RedditSettings,
  token: string,
): Promise<{ name: string; over18: boolean } | undefined> {
  try {
    const res = await s.fetch(`${s.apiBase}/api/v1/me?raw_json=1`, {
      headers: { authorization: `Bearer ${token}`, "user-agent": s.userAgent },
      signal: AbortSignal.timeout(HTTP_MS),
      redirect: "error",
    });
    const j = (await res.json()) as { name?: unknown; over_18?: unknown };
    return res.ok && typeof j.name === "string"
      ? { name: clean(j.name, 40), over18: j.over_18 === true }
      : undefined;
  } catch {
    return undefined;
  }
}

const refreshing = new Map<string, Promise<string>>();
/** A valid access token. Refreshes with expiry skew; concurrent callers of one user share a single refresh request. */
export async function accessToken(ctx: PluginContext, force = false): Promise<string> {
  const c = ctx.config;
  const s = settings(c);
  if (!c.refreshToken)
    throw new PluginError(
      "NEEDS_AUTH",
      "Reddit is not connected.",
      "Connect Reddit in Studio > Plugins > Reddit.",
    );
  if (!force && c.accessToken && Number(c.expiresAt) - SKEW_MS > s.now()) return c.accessToken;
  const hit = refreshing.get(ctx.userId);
  if (hit) return hit;
  const work = (async () => {
    const cfg = requireConfigured(c);
    const r = await post(cfg, cfg.tokenUrl, {
      grant_type: "refresh_token",
      refresh_token: c.refreshToken!,
    });
    if (!r.ok || r.body.error) {
      if (r.body.error === "invalid_grant" || r.status === 400 || r.status === 401) {
        // revoked by the user, or the app was deleted
        const {
          refreshToken: _r,
          accessToken: _a,
          expiresAt: _e,
          scopes: _s,
          ...rest
        } = ctx.config; // keeps the app credentials
        await ctx.setConfig(rest).catch(() => {});
        throw new PluginError("NEEDS_AUTH", "Reddit access was revoked or expired.", RECONNECT);
      }
      throw new PluginError(
        "REDDIT_UNAVAILABLE",
        "Reddit could not refresh access right now.",
        "Try again in a few minutes.",
      );
    }
    const token = r.body.access_token;
    if (typeof token !== "string")
      throw new PluginError(
        "REDDIT_UNAVAILABLE",
        "Reddit could not refresh access right now.",
        "Try again in a few minutes.",
      );
    const next: Record<string, string> = {
      ...ctx.config,
      accessToken: token,
      expiresAt: String(s.now() + Number(r.body.expires_in ?? 3600) * 1000),
    };
    if (typeof r.body.refresh_token === "string") next.refreshToken = r.body.refresh_token;
    await ctx.setConfig(next).catch(() => {}); // persisting is an optimisation; the token in hand is still good
    return token;
  })().finally(() => refreshing.delete(ctx.userId));
  refreshing.set(ctx.userId, work);
  return work;
}

/**
 * Authenticated call to the Reddit API (`path` starts with "/"). GETs add raw_json=1 (no HTML entity escaping); POSTs send a form with
 * api_type=json. Retries once with a forced refresh on 401. Errors are mapped to safe messages (no upstream text, no tokens).
 */
export async function rfetch(
  ctx: PluginContext,
  path: string,
  init: {
    method?: "GET" | "POST";
    query?: Record<string, string | undefined>;
    form?: Record<string, string | undefined>;
  } = {},
): Promise<unknown> {
  const s = settings(ctx.config);
  const u = new URL(`${s.apiBase}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {}))
    if (v !== undefined) u.searchParams.set(k, v);
  const method = init.method ?? "GET";
  if (method === "GET") u.searchParams.set("raw_json", "1");
  const form =
    method === "POST"
      ? new URLSearchParams(
          Object.entries({ api_type: "json", ...init.form }).filter(
            (e): e is [string, string] => e[1] !== undefined,
          ),
        )
      : undefined;
  const go = async (force: boolean) =>
    s.fetch(u.toString(), {
      method,
      signal: AbortSignal.timeout(HTTP_MS),
      redirect: "manual",
      headers: {
        authorization: `Bearer ${await accessToken(ctx, force)}`,
        "user-agent": s.userAgent,
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form,
    });
  let res: Response;
  try {
    res = await go(false);
    if (res.status === 401) res = await go(true);
  } catch (e) {
    if (e instanceof PluginError) throw e;
    throw new PluginError(
      "UNREACHABLE",
      "Reddit could not be reached from the server.",
      "Check the server's internet connection, then ask again.",
    );
  }
  if (res.ok) {
    try {
      return await res.json();
    } catch {
      return {};
    }
  }
  if (res.status === 401)
    throw new PluginError("NEEDS_AUTH", "Reddit access was revoked or expired.", RECONNECT);
  if (res.status === 403)
    throw new PluginError(
      "FORBIDDEN",
      "Reddit denied that. The subreddit may be private, quarantined or banned, or your account cannot do this.",
      "Check that your Reddit account can open it in a browser.",
    );
  if (res.status === 404 || (res.status >= 300 && res.status < 400))
    throw new PluginError(
      "NOT_FOUND",
      "Reddit could not find that.",
      "Check the subreddit, user or post id.",
    );
  if (res.status === 429) {
    const wait = Math.max(1, Math.ceil(Number(res.headers.get("x-ratelimit-reset")) || 60));
    throw new PluginError(
      "RATE_LIMITED",
      "Reddit is rate limiting this app.",
      `Wait about ${wait} seconds and ask again.`,
    );
  }
  throw new PluginError(
    "REDDIT_UNAVAILABLE",
    `Reddit could not complete that (HTTP ${res.status}).`,
    "Try again in a few minutes.",
  );
}

export async function disconnect(ctx: PluginContext): Promise<void> {
  const s = settings(ctx.config);
  if (s.clientId && s.clientSecret && ctx.config.refreshToken)
    await post(s as ReturnType<typeof requireConfigured>, s.revokeUrl, {
      token: ctx.config.refreshToken,
      token_type_hint: "refresh_token",
    }).catch(() => {}); // best effort
  const keep: Record<string, string> = {};
  for (const k of KEEP_ON_DISCONNECT) if (ctx.config[k]) keep[k] = ctx.config[k];
  await ctx.setConfig(keep);
}

export async function status(ctx: PluginContext): Promise<PluginStatus> {
  const s = settings(ctx.config);
  if (!s.clientId || !s.clientSecret || !s.redirectBase) {
    const e = NOT_CONFIGURED();
    return { state: "error", detail: `${e.safe} ${e.fix}` };
  }
  if (!ctx.config.refreshToken)
    return { state: "needs-auth", detail: "Not connected yet. Choose permissions and connect." };
  let token: string;
  try {
    token = await accessToken(ctx);
  } catch (e) {
    if (e instanceof PluginError)
      return { state: e.code === "NEEDS_AUTH" ? "needs-auth" : "error", detail: e.safe };
    throw e;
  }
  const me = await fetchMe(s, token);
  if (me && (me.over18 !== (ctx.config.over18 === "true") || me.name !== ctx.config.username)) {
    const next: Record<string, string> = { ...ctx.config, username: me.name };
    if (me.over18) next.over18 = "true";
    else delete next.over18;
    await ctx.setConfig(next).catch(() => {});
  }
  const c = ctx.config,
    over18 = me ? me.over18 : c.over18 === "true";
  const info = {
    username: c.username ?? null,
    scopes: [...grantedScopes(c)],
    allowNsfw: c.allowNsfw === "true",
    allowWrite: c.allowWrite === "true",
    subreddits: c.subreddits ?? "",
    over18,
  };
  const detail =
    c.allowNsfw === "true" && !over18
      ? 'NSFW is allowed here, but your Reddit account has not enabled "I\'m over eighteen" (reddit.com/settings/preferences), so Reddit itself hides NSFW content.'
      : c.username
        ? `Connected as u/${c.username}`
        : "Connected";
  return { state: "connected", detail, info };
}
