import { randomBytes, timingSafeEqual } from "node:crypto";
import { b64u, redirectBase, sha } from "../oauth2";
import { PluginError, type PluginContext, type PluginStatus } from "../registry";

/**
 * Microsoft identity platform, OAuth 2.0 authorization code flow with PKCE and `state`, used as an INTEGRATION grant for the person's
 * mailbox. It is separate from the app login (better-auth): signing in to Zetta never grants access to Outlook mail. Checked against
 * learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow and .../reply-url (read 2026-11-22):
 *   auth   https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize   (code_challenge S256, state, prompt)
 *   token  https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token       (authorization_code and refresh_token grants)
 *   `{tenant}` is `common` (work, school and personal accounts) unless the person names one. There is no token revocation endpoint in
 *   the v2 protocol, so disconnecting forgets the tokens here and the person removes the app's consent in their Microsoft account.
 *
 * Two client types, both the person's OWN app registration (no Zetta-wide app):
 *   `desktop`: a public client ("Mobile and desktop applications" platform). No secret; the redirect is `http://localhost:<port>`, which
 *     Microsoft matches without the port. Nothing listens there: the browser ends on a page that does not load and the person pastes its
 *     address back (POST /api/plugins/microsoft/complete).
 *   `web`: a confidential client with a secret and a public https redirect URI (`/api/plugins/microsoft/callback`).
 *
 * Server-side state: the pending sign-in (sha256(state), PKCE verifier, expiry, redirect) is kept in the person's own sealed plugin config,
 * so it is bound to them, single use (deleted before the code is exchanged) and off the browser. A wrong `state` is rejected without
 * consuming the pending sign-in. Tokens live only in the sealed config.
 *
 * Config keys (strings): clientId, clientSecret, clientType, tenant (kept across disconnects), accounts (JSON list, one entry per account,
 * keyed by lower case email), pending (JSON). None is ever returned to the browser or to a bot.
 */

export const SCOPES = {
  "Mail.Read": { label: "Mail: read messages" },
  "Mail.Send": { label: "Mail: send email (also needs the sending switch of the mailbox)" },
} as const;
export type ScopeId = keyof typeof SCOPES;
export const SCOPE_IDS = Object.keys(SCOPES) as ScopeId[];
/** Always asked: offline access gives the refresh token, User.Read names the account. */
const BASE_SCOPES = ["offline_access", "User.Read"];
const GRAPH_SCOPE_PREFIX = "https://graph.microsoft.com/";

export type MicrosoftSettings = {
  /** The Microsoft identity platform host; the tenant goes in the path. */
  loginBase: string;
  graphBase: string;
  clientId?: string;
  clientSecret?: string;
  tenant: string;
  redirectBase?: string;
  loopbackPort: number;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  now: () => number;
};
const defaults = {
  loginBase: "https://login.microsoftonline.com",
  graphBase: "https://graph.microsoft.com/v1.0",
  loopbackPort: 53682,
  fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
  now: () => Date.now(),
};
let overrides: Partial<MicrosoftSettings> = {};
/** Test hook: point the plugin at a fake Microsoft. Pass `{}` to reset. */
export const configureMicrosoftForTests = (o: Partial<MicrosoftSettings>) => {
  overrides = o;
  refreshing.clear();
  callbacks.clear();
};
const TENANT =
  /^(?:common|organizations|consumers|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9][a-z0-9.-]{0,251}\.[a-z]{2,63})$/i;
/** The app registration comes from the installing person's sealed config, so every person (and the bots they bind) uses their own. */
export const settings = (config: Readonly<Record<string, string>> = {}): MicrosoftSettings => ({
  ...defaults,
  clientId: config.clientId?.trim() || undefined,
  clientSecret: config.clientSecret?.trim() || undefined,
  tenant: config.tenant && TENANT.test(config.tenant.trim()) ? config.tenant.trim() : "common",
  redirectBase: redirectBase() || undefined,
  ...overrides,
});
const authUrl = (s: MicrosoftSettings) =>
  `${s.loginBase}/${encodeURIComponent(s.tenant)}/oauth2/v2.0/authorize`;
const tokenUrl = (s: MicrosoftSettings) =>
  `${s.loginBase}/${encodeURIComponent(s.tenant)}/oauth2/v2.0/token`;
export const redirectUri = (s = settings()) =>
  `${(s.redirectBase ?? "").replace(/\/+$/, "")}/api/plugins/microsoft/callback`;

export type ClientType = "desktop" | "web";
export const clientType = (config: Readonly<Record<string, string>> = {}): ClientType =>
  config.clientType === "web" ? "web" : "desktop";
/** Microsoft ignores the port of a localhost redirect when it matches, so the registered `http://localhost` covers this one. */
const loopbackRedirect = (port: number) => `http://localhost:${port}`;
const redirectFor = (s: MicrosoftSettings, config: Readonly<Record<string, string>>) =>
  clientType(config) === "desktop" ? loopbackRedirect(s.loopbackPort) : redirectUri(s);
export const KEEP_ON_DISCONNECT = ["clientId", "clientSecret", "clientType", "tenant"] as const;

const NOT_CONFIGURED = () =>
  new PluginError(
    "NOT_CONFIGURED",
    "Microsoft has no app registration yet.",
    `Register an app in Microsoft Entra (see the guide in Studio > Plugins > Microsoft), then enter its application (client) ID in the plugin settings. A web client also needs its secret and ${redirectUri()} as a redirect URI.`,
  );
const requireConfigured = (config: Readonly<Record<string, string>>) => {
  const s = settings(config);
  const web = clientType(config) === "web";
  if (!s.clientId || (web && (!s.clientSecret || !s.redirectBase))) throw NOT_CONFIGURED();
  return s as MicrosoftSettings & { clientId: string };
};

const STATE_TTL_MS = 10 * 60_000,
  SKEW_MS = 60_000,
  HTTP_MS = 15_000;

/** The permissions in a token answer, as ids: Microsoft answers `Mail.Read` or the full `https://graph.microsoft.com/Mail.Read`. */
const idOf = (raw: string): ScopeId | undefined => {
  const bare = raw.startsWith(GRAPH_SCOPE_PREFIX) ? raw.slice(GRAPH_SCOPE_PREFIX.length) : raw;
  return SCOPE_IDS.find((k) => k.toLowerCase() === bare.toLowerCase());
};
export const grantedScopes = (c: { readonly scopes?: string }) =>
  new Set((c.scopes ?? "").split(" ").filter(Boolean));
const asked = (want: ScopeId[]) => [
  ...BASE_SCOPES.map((x) => (x === "User.Read" ? `${GRAPH_SCOPE_PREFIX}User.Read` : x)),
  ...want.map((w) => `${GRAPH_SCOPE_PREFIX}${w}`),
];

/** One connected account. A missing refreshToken means "reconnect this account". */
export type MicrosoftAccount = {
  email: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: string;
  scopes?: string;
};
const ACCOUNT_KEYS = ["refreshToken", "accessToken", "expiresAt", "scopes"] as const;
export const MAX_ACCOUNTS = 10;

export function readAccounts(config: Readonly<Record<string, string>>): MicrosoftAccount[] {
  if (!config.accounts) return [];
  try {
    const list = JSON.parse(config.accounts) as unknown;
    return Array.isArray(list)
      ? list
          .filter(
            (a): a is MicrosoftAccount =>
              Boolean(a) && typeof a.email === "string" && a.email !== "",
          )
          .slice(0, MAX_ACCOUNTS)
      : [];
  } catch {
    return [];
  }
}
const withAccounts = (
  config: Readonly<Record<string, string>>,
  accounts: MicrosoftAccount[],
): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) if (k !== "accounts") next[k] = v;
  if (accounts.length) next.accounts = JSON.stringify(accounts);
  return next;
};
export const ACCOUNT_ARG = {
  type: "string",
  description: "Microsoft account email; see microsoft_accounts.",
} as const;

const unknownAccount = (accounts: MicrosoftAccount[]) =>
  new PluginError(
    "UNKNOWN_ACCOUNT",
    "That Microsoft account is not connected.",
    accounts.length
      ? `Connected accounts: ${accounts.map((a) => a.email).join(", ")}.`
      : "Connect it in Studio > Plugins.",
  );

/**
 * One account seen as a plain single-account context (flat keys). Reads look at the parent's latest config; `setConfig` writes the account
 * back into the parent's list and ignores the write when the account was removed meanwhile, so a late refresh never revives it.
 */
export function accountCtx(ctx: PluginContext, email: string): PluginContext {
  return {
    userId: `${ctx.userId}:${email}`,
    botId: ctx.botId,
    get config() {
      const out: Record<string, string> = {};
      for (const k of ["clientId", "clientSecret", "clientType", "tenant"])
        if (ctx.config[k]) out[k] = ctx.config[k]!;
      for (const [k, v] of Object.entries(
        readAccounts(ctx.config).find((a) => a.email === email) ?? { email },
      ))
        if (typeof v === "string" && v) out[k] = v;
      return out;
    },
    async setConfig(next) {
      const list = readAccounts(ctx.config);
      const i = list.findIndex((a) => a.email === email);
      if (i < 0) return;
      const account: MicrosoftAccount = { email };
      for (const k of ACCOUNT_KEYS) if (next[k]) account[k] = next[k];
      list[i] = account;
      await ctx.setConfig(withAccounts(ctx.config, list));
    },
  };
}

/** Throws SCOPE_MISSING unless the account was granted `scope`. */
export function needScope(ctx: PluginContext, scope: ScopeId) {
  if (!ctx.config.refreshToken)
    throw new PluginError(
      "NEEDS_AUTH",
      "Microsoft is not connected. Connect it in Studio > Plugins.",
    );
  if (![...grantedScopes(ctx.config)].some((g) => idOf(g) === scope))
    throw new PluginError(
      "SCOPE_MISSING",
      `That needs Microsoft access that was not granted (${SCOPES[scope].label}).`,
      "Open Studio > Plugins > Microsoft, choose Change permissions on that account, tick it and sign in again.",
    );
}

/** The account a call acts on, as a single-account context, with `scope` checked. */
export function pickAccount(ctx: PluginContext, email: string, scope: ScopeId): PluginContext {
  const all = readAccounts(ctx.config);
  if (!all.length)
    throw new PluginError(
      "NEEDS_AUTH",
      "Microsoft is not connected. Connect it in Studio > Plugins.",
    );
  const hit = all.find((a) => a.email === email.trim().toLowerCase());
  if (!hit) throw unknownAccount(all);
  const view = accountCtx(ctx, hit.email);
  needScope(view, scope);
  return view;
}

type Answer = { ok: boolean; status: number; body: Record<string, unknown> };
const post = async (url: string, form: Record<string, string>): Promise<Answer> => {
  const res = await settings().fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(HTTP_MS),
    redirect: "error",
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty body */
  }
  return { ok: res.ok, status: res.status, body };
};
/** A secret goes only with a web client; a public client must not send one. */
const clientForm = (
  s: MicrosoftSettings & { clientId: string },
  config: Record<string, string>,
) => ({
  client_id: s.clientId,
  ...(clientType(config) === "web" && s.clientSecret ? { client_secret: s.clientSecret } : {}),
});

/**
 * connect(): validates the person's choices, stores the pending sign-in and returns the Microsoft consent URL.
 * `options.scopes` picks from Mail.Read / Mail.Send; `options.account` (an email) updates that account, otherwise a new one is added.
 */
export async function startConnect(
  ctx: PluginContext,
  options: Record<string, unknown> = {},
): Promise<{ authorizeUrl?: string; data?: Record<string, unknown> }> {
  const s = requireConfigured(ctx.config);
  const raw = Array.isArray(options.scopes) ? options.scopes : [];
  if (raw.some((x) => typeof x !== "string" || !SCOPE_IDS.includes(x as ScopeId)))
    throw new PluginError("INVALID_SCOPE", "Unknown Microsoft permission.");
  const want = [...new Set(raw as ScopeId[])];
  if (!want.length) throw new PluginError("INVALID_SCOPE", "Pick at least one permission.");
  const accounts = readAccounts(ctx.config);
  let target: MicrosoftAccount | undefined;
  if (options.account !== undefined) {
    target =
      typeof options.account === "string"
        ? accounts.find((a) => a.email === (options.account as string).trim().toLowerCase())
        : undefined;
    if (!target) throw unknownAccount(accounts);
  } else if (accounts.length >= MAX_ACCOUNTS)
    throw new PluginError(
      "TOO_MANY_ACCOUNTS",
      `At most ${MAX_ACCOUNTS} Microsoft accounts can be connected.`,
      "Disconnect one first.",
    );
  const state = b64u(randomBytes(32)),
    verifier = b64u(randomBytes(32));
  const exp = s.now() + STATE_TTL_MS;
  const pending = {
    s: b64u(sha(state)),
    v: verifier,
    exp,
    scopes: want,
    account: target?.email ?? null,
    r: redirectFor(s, ctx.config),
  };
  await ctx.setConfig({ ...ctx.config, pending: JSON.stringify(pending) });
  const u = new URL(authUrl(s));
  const q: Record<string, string> = {
    client_id: s.clientId,
    redirect_uri: pending.r,
    response_type: "code",
    response_mode: "query",
    scope: asked(want).join(" "),
    prompt: target ? "consent" : "select_account",
    state,
    code_challenge: b64u(sha(verifier)),
    code_challenge_method: "S256",
  };
  if (target) q.login_hint = target.email;
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return clientType(ctx.config) === "desktop"
    ? { authorizeUrl: u.toString(), data: { completion: "paste" } }
    : { authorizeUrl: u.toString() };
}

const callbacks = new Set<string>();
/** The redirect target. Validates state, consumes it, exchanges the code and seals the tokens. Throws PluginError on every failure. */
export async function finishConnect(ctx: PluginContext, params: URLSearchParams): Promise<void> {
  const s = requireConfigured(ctx.config);
  let pending:
    | { s: string; v: string; exp: number; scopes: string[]; account?: string | null; r?: string }
    | undefined;
  try {
    pending = ctx.config.pending ? JSON.parse(ctx.config.pending) : undefined;
  } catch {
    pending = undefined;
  }
  const state = params.get("state") ?? "";
  if (!pending || !state)
    throw new PluginError("INVALID_STATE", "That sign-in link is no longer valid. Start again.");
  const a = Buffer.from(b64u(sha(state))),
    b = Buffer.from(pending.s);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new PluginError("INVALID_STATE", "That sign-in link is no longer valid. Start again.");
  if (callbacks.has(ctx.userId))
    throw new PluginError("INVALID_STATE", "That sign-in link is no longer valid. Start again.");
  callbacks.add(ctx.userId);
  try {
    const { pending: _drop, ...rest } = ctx.config;
    await ctx.setConfig(rest); // single use: gone before the code is exchanged
    if (s.now() > pending.exp)
      throw new PluginError("STATE_EXPIRED", "That sign-in took too long. Start again.");
    if (params.get("error"))
      throw new PluginError(
        params.get("error") === "access_denied" ? "ACCESS_DENIED" : "MICROSOFT_ERROR",
        params.get("error") === "access_denied"
          ? "Microsoft access was declined."
          : "Microsoft refused the request.",
      );
    const code = params.get("code");
    if (!code || code.length > 4000)
      throw new PluginError("INVALID_STATE", "Microsoft did not return a code.");
    const r = await post(tokenUrl(s), {
      ...clientForm(s, ctx.config),
      code,
      code_verifier: pending.v,
      grant_type: "authorization_code",
      redirect_uri: pending.r ?? redirectFor(s, ctx.config),
    });
    const t = r.body;
    if (!r.ok || typeof t.access_token !== "string")
      throw new PluginError("EXCHANGE_FAILED", "Microsoft rejected the sign-in. Start again.");
    const email = (await fetchEmail(t.access_token))?.toLowerCase();
    if (!email)
      throw new PluginError(
        "NO_EMAIL",
        "Microsoft did not say which account signed in. Start again.",
      );
    const accounts = readAccounts(rest);
    const existing = accounts.find((x) => x.email === email);
    const refresh = typeof t.refresh_token === "string" ? t.refresh_token : existing?.refreshToken;
    if (!refresh)
      throw new PluginError(
        "NO_REFRESH_TOKEN",
        "Microsoft did not grant offline access. Remove the app from your Microsoft account permissions and connect again.",
      );
    const granted = String(t.scope ?? "")
      .split(" ")
      .map(idOf)
      .filter((x): x is ScopeId => Boolean(x));
    const account: MicrosoftAccount = {
      email,
      refreshToken: refresh,
      accessToken: t.access_token,
      expiresAt: String(s.now() + Number(t.expires_in ?? 3600) * 1000),
      scopes: [...new Set(granted)].join(" "),
    };
    const list = existing
      ? accounts.map((x) => (x.email === email ? account : x))
      : [...accounts, account];
    if (list.length > MAX_ACCOUNTS)
      throw new PluginError(
        "TOO_MANY_ACCOUNTS",
        `At most ${MAX_ACCOUNTS} Microsoft accounts can be connected.`,
        "Disconnect one first.",
      );
    await ctx.setConfig(withAccounts(rest, list));
  } finally {
    callbacks.delete(ctx.userId);
  }
}

/** The address of the account that signed in: `mail`, else the user principal name (a personal account may have no `mail`). */
async function fetchEmail(token: string): Promise<string | undefined> {
  try {
    const s = settings();
    const res = await s.fetch(`${s.graphBase}/me?$select=mail,userPrincipalName`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(HTTP_MS),
      redirect: "error",
    });
    const j = (await res.json()) as { mail?: unknown; userPrincipalName?: unknown };
    const one = [j.mail, j.userPrincipalName].find(
      (v): v is string => typeof v === "string" && /^[^\s@]+@[^\s@]+$/.test(v),
    );
    return res.ok ? one?.slice(0, 254) : undefined;
  } catch {
    return undefined;
  }
}

const refreshing = new Map<string, Promise<string>>();
/** A valid access token. Refreshes with expiry skew; concurrent callers of one account share a single refresh request. */
export async function accessToken(ctx: PluginContext, force = false): Promise<string> {
  const c = ctx.config;
  const s = settings(c);
  if (!c.refreshToken)
    throw new PluginError(
      "NEEDS_AUTH",
      "Microsoft is not connected. Connect it in Studio > Plugins.",
    );
  if (!force && c.accessToken && Number(c.expiresAt) - SKEW_MS > s.now()) return c.accessToken;
  const hit = refreshing.get(ctx.userId);
  if (hit) return hit;
  const work = (async () => {
    const cfg = requireConfigured(ctx.config);
    const r = await post(tokenUrl(cfg), {
      ...clientForm(cfg, ctx.config),
      refresh_token: c.refreshToken!,
      grant_type: "refresh_token",
    });
    if (!r.ok) {
      if (r.body.error === "invalid_grant" || r.body.error === "interaction_required") {
        // revoked, expired, a password change or a policy that asks the person to sign in again
        const {
          refreshToken: _r,
          accessToken: _a,
          expiresAt: _e,
          scopes: _s,
          ...rest
        } = ctx.config;
        await ctx.setConfig(rest).catch(() => {});
        throw new PluginError(
          "NEEDS_AUTH",
          "Microsoft access was revoked or expired. Reconnect Microsoft in Studio > Plugins.",
        );
      }
      throw new PluginError(
        "MICROSOFT_UNAVAILABLE",
        "Microsoft could not refresh access right now.",
      );
    }
    const token = r.body.access_token;
    if (typeof token !== "string")
      throw new PluginError(
        "MICROSOFT_UNAVAILABLE",
        "Microsoft could not refresh access right now.",
      );
    const next: Record<string, string> = {
      ...ctx.config,
      accessToken: token,
      expiresAt: String(s.now() + Number(r.body.expires_in ?? 3600) * 1000),
    };
    // Microsoft hands out a new refresh token each time; the old one is to be discarded.
    if (typeof r.body.refresh_token === "string") next.refreshToken = r.body.refresh_token;
    await ctx.setConfig(next).catch(() => {}); // persisting is an optimisation; the token in hand is still good
    return token;
  })().finally(() => refreshing.delete(ctx.userId));
  refreshing.set(ctx.userId, work);
  return work;
}

/** The words of Graph's failures. Nothing Microsoft says passes through. */
function graphFailure(status: number): PluginError {
  if (status === 401)
    return new PluginError(
      "NEEDS_AUTH",
      "Microsoft access was revoked or expired. Reconnect Microsoft in Studio > Plugins.",
    );
  if (status === 400)
    return new PluginError("BAD_REQUEST", "Microsoft did not accept that request.");
  if (status === 403)
    return new PluginError(
      "FORBIDDEN",
      "Microsoft denied that (a permission is missing, or your organization has not allowed this app).",
    );
  if (status === 404) return new PluginError("NOT_FOUND", "Microsoft could not find that item.");
  if (status === 410) return new PluginError("GONE", "Microsoft no longer has that item.");
  if (status === 429)
    return new PluginError("RATE_LIMITED", "Microsoft is rate limiting requests. Try again later.");
  if (status >= 500)
    return new PluginError("MICROSOFT_UNAVAILABLE", "Microsoft could not complete that right now.");
  return new PluginError("MICROSOFT_ERROR", "Microsoft could not complete that.");
}

/** Authenticated call to Graph. Retries once with a forced refresh on 401. Errors are mapped to safe messages (no upstream text). */
export async function graphFetch(
  ctx: PluginContext,
  url: string,
  init: { method?: string; json?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const go = async (force: boolean) =>
    settings().fetch(url, {
      method: init.method ?? "GET",
      signal: AbortSignal.timeout(HTTP_MS * 2),
      redirect: "error",
      headers: {
        ...init.headers,
        authorization: `Bearer ${await accessToken(ctx, force)}`,
        ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  let res: Response;
  try {
    res = await go(false);
    if (res.status === 401) res = await go(true);
  } catch (e) {
    if (e instanceof PluginError) throw e;
    throw new PluginError("MICROSOFT_UNAVAILABLE", "Microsoft could not be reached.");
  }
  if (res.ok) return res;
  throw graphFailure(res.status);
}

/** Without `options.account` every account is removed (only the app registration stays); with it, only that account. */
export async function disconnect(
  ctx: PluginContext,
  options: Record<string, unknown> = {},
): Promise<void> {
  const accounts = readAccounts(ctx.config);
  const only =
    typeof options.account === "string" ? options.account.trim().toLowerCase() : undefined;
  if (only) {
    if (!accounts.some((a) => a.email === only)) throw unknownAccount(accounts);
    await ctx.setConfig(
      withAccounts(
        ctx.config,
        accounts.filter((a) => a.email !== only),
      ),
    );
    return;
  }
  const keep: Record<string, string> = {};
  for (const k of KEEP_ON_DISCONNECT) if (ctx.config[k]) keep[k] = ctx.config[k];
  await ctx.setConfig(keep);
}

/** A desktop sign-in that is waiting for its redirect: lets a page that was reloaded, or a second tab, still show the paste step. */
function signInInfo(config: Readonly<Record<string, string>>, now: number) {
  try {
    const p = config.pending
      ? (JSON.parse(config.pending) as { exp?: number; r?: string })
      : undefined;
    if (p?.r?.startsWith("http://localhost:") && typeof p.exp === "number" && p.exp > now)
      return { completion: "paste", expiresAt: p.exp };
  } catch {
    // An unreadable pending value is no sign-in.
  }
  return undefined;
}

export async function status(ctx: PluginContext): Promise<PluginStatus> {
  const s = settings(ctx.config);
  const signIn = signInInfo(ctx.config, s.now());
  if (!s.clientId || (clientType(ctx.config) === "web" && (!s.clientSecret || !s.redirectBase))) {
    const e = NOT_CONFIGURED();
    return { state: "error", detail: `${e.safe} ${e.fix}` };
  }
  const before = readAccounts(ctx.config);
  if (!before.some((a) => a.refreshToken))
    return {
      state: "needs-auth",
      detail: "Not connected yet. Choose permissions and connect.",
      ...(signIn && { info: { signIn } }),
    };
  const ok = new Set<string>();
  let why = "";
  for (const a of before) {
    if (!a.refreshToken) continue;
    try {
      await accessToken(accountCtx(ctx, a.email));
      ok.add(a.email);
    } catch (e) {
      if (e instanceof PluginError && e.code === "NEEDS_AUTH") why = e.safe;
      else throw e;
    } // a revoked account is wiped by accessToken; the others stay usable
  }
  const accounts = readAccounts(ctx.config);
  const live = accounts.filter((a) => ok.has(a.email));
  if (!live.length)
    return {
      state: "needs-auth",
      detail: why || "Reconnect Microsoft in Studio > Plugins.",
      ...(signIn && { info: { signIn } }),
    };
  return {
    state: "connected",
    detail: `Connected as ${live.map((a) => a.email).join(", ")}`,
    info: {
      accounts: accounts.map((a) => ({
        email: a.email,
        state: ok.has(a.email) ? "connected" : "needs-auth",
        scopes: [...grantedScopes(a)],
      })),
      ...(signIn && { signIn }),
    },
  };
}
