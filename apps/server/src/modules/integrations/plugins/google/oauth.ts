import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PluginError, type PluginContext, type PluginStatus } from "../registry";

/**
 * Google OAuth 2.0 web-server flow (Authorization Code + PKCE + state), used as an INTEGRATION grant for bot tools.
 * It is deliberately separate from the app login (better-auth): signing in to Zetta never grants Gmail/Calendar/Drive access.
 *
 * Endpoints and parameters were checked against developers.google.com/identity/protocols/oauth2/web-server:
 *   auth    https://accounts.google.com/o/oauth2/v2/auth   (access_type=offline, prompt=consent, include_granted_scopes=true, state, PKCE S256)
 *   token   https://oauth2.googleapis.com/token             (authorization_code and refresh_token grants)
 *   revoke  https://oauth2.googleapis.com/revoke            (POST, form field `token`)
 *
 * Server-side state: the pending authorization (sha256(state), PKCE verifier, expiry, requested scopes) is kept INSIDE the user's own sealed
 * plugin config. That binds it to the signed-in user (the callback loads the config of the session's user), makes it single-use (it is
 * deleted before the code is exchanged) and keeps it off the browser. A wrong `state` is rejected without consuming the pending flow, so a
 * forged callback cannot cancel a real one. Tokens never leave the server: the refresh token lives only in the sealed config.
 *
 * Config keys (strings): clientId, clientSecret (the user's own Google Cloud OAuth client, entered when installing; kept across disconnects),
 * accounts (JSON list of GoogleAccount: one entry per connected Google account, keyed by lowercase email), pending (JSON).
 * None of them is ever returned to the browser or to a bot.
 *
 * Several accounts share one install and one OAuth client. `accountCtx(ctx, email)` gives one account the flat view the tools were written
 * against (refreshToken, accessToken, expiresAt, scopes, allowSend), so gfetch, needScope and the Gmail/Calendar/Drive/Docs/Sheets tools
 * work on a single account unchanged. A config saved before accounts existed (flat keys, no `accounts`) reads as one account and is
 * rewritten in the new shape on its next write.
 */

export const SCOPES = {
  "gmail.readonly": {
    url: "https://www.googleapis.com/auth/gmail.readonly",
    label: "Gmail: read messages",
  },
  "gmail.compose": {
    url: "https://www.googleapis.com/auth/gmail.compose",
    label: "Gmail: create drafts (never sent by Zetta)",
  },
  "gmail.send": {
    url: "https://www.googleapis.com/auth/gmail.send",
    label: "Gmail: send email (also needs the Allow sending switch)",
  },
  "calendar.events.readonly": {
    url: "https://www.googleapis.com/auth/calendar.events.readonly",
    label: "Calendar: read events",
  },
  "calendar.events": {
    url: "https://www.googleapis.com/auth/calendar.events",
    label: "Calendar: create and edit events",
  },
  "drive.readonly": {
    url: "https://www.googleapis.com/auth/drive.readonly",
    label: "Drive: read all files",
  },
  "drive.file": {
    url: "https://www.googleapis.com/auth/drive.file",
    label: "Drive: only files created or opened with Zetta",
  },
  "documents.readonly": {
    url: "https://www.googleapis.com/auth/documents.readonly",
    label: "Docs: read documents",
  },
  documents: {
    url: "https://www.googleapis.com/auth/documents",
    label: "Docs: create and edit documents",
  },
  "spreadsheets.readonly": {
    url: "https://www.googleapis.com/auth/spreadsheets.readonly",
    label: "Sheets: read spreadsheets",
  },
  spreadsheets: {
    url: "https://www.googleapis.com/auth/spreadsheets",
    label: "Sheets: create and edit spreadsheets",
  },
} as const;
export type ScopeId = keyof typeof SCOPES;
export const SCOPE_IDS = Object.keys(SCOPES) as ScopeId[];
const IDENTITY_SCOPES = ["openid", "email"];

export type GoogleSettings = {
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  userinfoUrl: string;
  gmailBase: string;
  calendarBase: string;
  driveBase: string;
  docsBase: string;
  sheetsBase: string;
  clientId?: string;
  clientSecret?: string;
  redirectBase?: string;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  now: () => number;
};
const defaults: GoogleSettings = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  gmailBase: "https://gmail.googleapis.com/gmail/v1",
  calendarBase: "https://www.googleapis.com/calendar/v3",
  driveBase: "https://www.googleapis.com/drive/v3",
  docsBase: "https://docs.googleapis.com/v1",
  sheetsBase: "https://sheets.googleapis.com/v4",
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
};
let overrides: Partial<GoogleSettings> = {};
/** Test hook: point the plugin at a fake Google. Pass `{}` to reset. */
export const configureGoogleForTests = (o: Partial<GoogleSettings>) => {
  overrides = o;
  refreshing.clear();
  callbacks.clear();
};
/** The OAuth client comes from the installing user's sealed config, so every user (and the bots they bind) uses their own Google project. */
export const settings = (config: Readonly<Record<string, string>> = {}): GoogleSettings => ({
  ...defaults,
  clientId: config.clientId || undefined,
  clientSecret: config.clientSecret || undefined,
  redirectBase: process.env.GOOGLE_OAUTH_REDIRECT_BASE || process.env.BETTER_AUTH_URL || undefined,
  ...overrides,
});
export const redirectUri = (s = settings()) =>
  `${(s.redirectBase ?? "").replace(/\/+$/, "")}/api/plugins/google/callback`;
export const KEEP_ON_DISCONNECT = ["clientId", "clientSecret"] as const;
const NOT_CONFIGURED = () =>
  new PluginError(
    "NOT_CONFIGURED",
    "Google has no OAuth client yet.",
    `Create an OAuth client (Web application) in Google Cloud Console with ${redirectUri()} as an authorised redirect URI, then enter its client ID and secret in Studio > Plugins > Google > Settings.`,
  );
const requireConfigured = (config: Readonly<Record<string, string>>) => {
  const s = settings(config);
  if (!s.clientId || !s.clientSecret || !s.redirectBase) throw NOT_CONFIGURED();
  return s as GoogleSettings & { clientId: string; clientSecret: string; redirectBase: string };
};

const b64u = (b: Buffer) => b.toString("base64url");
const sha = (v: string) => createHash("sha256").update(v).digest();
const STATE_TTL_MS = 10 * 60_000,
  SKEW_MS = 60_000,
  HTTP_MS = 15_000;

export const grantedScopes = (c: { readonly scopes?: string }) =>
  new Set((c.scopes ?? "").split(" ").filter(Boolean));
const idFromUrl = (u: string) => SCOPE_IDS.find((k) => SCOPES[k].url === u);

/** One connected Google account. The keys are the flat ones the plugin used before accounts existed. A missing refreshToken means "reconnect this account". */
export type GoogleAccount = {
  email: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: string;
  scopes?: string;
  allowSend?: string;
};
const ACCOUNT_KEYS = ["refreshToken", "accessToken", "expiresAt", "scopes", "allowSend"] as const;
const FLAT_KEYS = new Set<string>(["email", "accounts", ...ACCOUNT_KEYS]);
/** Name of the account of a legacy config that never stored its email. */
const LEGACY_EMAIL = "unknown";
export const MAX_ACCOUNTS = 10;
export const accountLabel = (email: string) =>
  email === LEGACY_EMAIL ? "your Google account" : email;

export function readAccounts(config: Readonly<Record<string, string>>): GoogleAccount[] {
  if (config.accounts) {
    try {
      const list = JSON.parse(config.accounts) as unknown;
      return Array.isArray(list)
        ? list
            .filter(
              (a): a is GoogleAccount =>
                Boolean(a) && typeof a.email === "string" && a.email !== "",
            )
            .slice(0, MAX_ACCOUNTS)
        : [];
    } catch {
      return [];
    }
  }
  if (!config.refreshToken) return [];
  const legacy: GoogleAccount = { email: (config.email || LEGACY_EMAIL).toLowerCase() };
  for (const k of ACCOUNT_KEYS) if (config[k]) legacy[k] = config[k];
  return [legacy];
}
/** `config` with its account list replaced. The flat single-account keys are dropped: this is where a legacy config migrates. */
function withAccounts(
  config: Readonly<Record<string, string>>,
  accounts: GoogleAccount[],
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) if (!FLAT_KEYS.has(k)) next[k] = v;
  if (accounts.length) next.accounts = JSON.stringify(accounts);
  return next;
}
/** The optional `account` argument every Google tool accepts. */
export const ACCOUNT_ARG = {
  type: "string",
  description:
    "Google account email. Needed only when several connected accounts can do this; see google_accounts.",
} as const;
/** The Google API behind each service base URL. Enabling it in the user's own Cloud project is a setup step Zetta cannot do for them. */
const APIS = [
  ["gmailBase", "Gmail API", "gmail.googleapis.com"],
  ["calendarBase", "Google Calendar API", "calendar-json.googleapis.com"],
  ["driveBase", "Google Drive API", "drive.googleapis.com"],
  ["docsBase", "Google Docs API", "docs.googleapis.com"],
  ["sheetsBase", "Google Sheets API", "sheets.googleapis.com"],
] as const;
export const apiLibraryUrl = (host: string) =>
  `https://console.cloud.google.com/apis/library/${host}`;
export const API_PAGES = APIS.map(([, name, host]) => ({ name, url: apiLibraryUrl(host) }));
/** The API a 403 is about when Google says the API is switched off for the project. Names and links come from the table above, never from Google's reply. */
async function disabledApi(res: Response, url: string) {
  let raw = "";
  try {
    raw = JSON.stringify(await res.clone().json());
  } catch {
    return undefined;
  }
  if (!/SERVICE_DISABLED|accessNotConfigured/.test(raw)) return undefined;
  const s = settings();
  return APIS.find(([key]) => url.startsWith(s[key]));
}
const unknownAccount = (accounts: GoogleAccount[]) =>
  new PluginError(
    "UNKNOWN_ACCOUNT",
    "That Google account is not connected.",
    accounts.length
      ? `Connected accounts: ${accounts.map((a) => accountLabel(a.email)).join(", ")}.`
      : "Connect it in Studio > Plugins.",
  );

/**
 * One account seen as a plain single-account context. Reads always look at the parent's latest config; `setConfig` writes the account
 * back into the parent's list (and ignores the write when the account was removed meanwhile, so a late token refresh never revives it).
 * Its userId is `<user>:<email>`, which keeps refresh single-flight and the send rate limit per account.
 */
export function accountCtx(ctx: PluginContext, email: string): PluginContext {
  return {
    userId: `${ctx.userId}:${email}`,
    botId: ctx.botId,
    get config() {
      const out: Record<string, string> = {};
      for (const k of ["clientId", "clientSecret"]) if (ctx.config[k]) out[k] = ctx.config[k]!;
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
      const account: GoogleAccount = { email };
      for (const k of ACCOUNT_KEYS) if (next[k]) account[k] = next[k];
      list[i] = account;
      await ctx.setConfig(withAccounts(ctx.config, list));
    },
  };
}

/**
 * The account a tool call acts on, as a single-account context. `requested` is the tool's optional `account` (an email).
 * Without it the call goes to the only account that has one of `scopes`; with several candidates the bot must say which (ACCOUNT_REQUIRED).
 */
export function pickAccount(
  ctx: PluginContext,
  requested: unknown,
  ...scopes: ScopeId[]
): PluginContext {
  const all = readAccounts(ctx.config);
  if (!all.length)
    throw new PluginError("NEEDS_AUTH", "Google is not connected. Connect it in Studio > Plugins.");
  if (requested !== undefined && requested !== null && requested !== "") {
    const hit =
      typeof requested === "string"
        ? all.find((a) => a.email === requested.trim().toLowerCase())
        : undefined;
    if (!hit) throw unknownAccount(all);
    const view = accountCtx(ctx, hit.email);
    needScope(view, ...scopes);
    return view;
  }
  const connected = all.filter((a) => a.refreshToken);
  const fit = connected.filter((a) => scopes.some((s) => grantedScopes(a).has(s)));
  if (fit.length === 1) return accountCtx(ctx, fit[0]!.email);
  if (fit.length > 1)
    throw new PluginError(
      "ACCOUNT_REQUIRED",
      `Several Google accounts can do that (${fit.map((a) => accountLabel(a.email)).join(", ")}). Say which one to use.`,
      "Repeat the call with the account argument set to one of these emails.",
    );
  needScope(accountCtx(ctx, (connected[0] ?? all[0]!).email), ...scopes); // throws NEEDS_AUTH or SCOPE_MISSING in the usual words
  throw new PluginError("SCOPE_MISSING", "That needs Google access that was not granted.");
}

/** Throws SCOPE_MISSING unless at least one of `any` was granted. */
export function needScope(ctx: PluginContext, ...any: ScopeId[]) {
  if (!ctx.config.refreshToken)
    throw new PluginError("NEEDS_AUTH", "Google is not connected. Connect it in Studio > Plugins.");
  const g = grantedScopes(ctx.config);
  if (!any.some((s) => g.has(s)))
    throw new PluginError(
      "SCOPE_MISSING",
      `That needs Google access that was not granted (${any.map((s) => SCOPES[s].label).join(" / ")}).`,
      "Open Studio > Plugins > Google, choose Change permissions on that account, tick it and sign in with Google again.",
    );
}

const post = async (url: string, form: Record<string, string>) => {
  const res = await settings().fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
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

/**
 * connect(): validates the user's choices, stores the pending flow and returns the Google consent URL.
 * `options.account` (an email) updates that account; without it a new account is added.
 */
export async function startConnect(
  ctx: PluginContext,
  options: Record<string, unknown> = {},
): Promise<{ authorizeUrl?: string }> {
  const s = requireConfigured(ctx.config);
  const raw = Array.isArray(options.scopes) ? options.scopes : [];
  if (raw.some((x) => typeof x !== "string" || !(x in SCOPES)))
    throw new PluginError("INVALID_SCOPE", "Unknown Google permission.");
  const want = [...new Set(raw as ScopeId[])];
  const accounts = readAccounts(ctx.config);
  let target: GoogleAccount | undefined;
  if (options.account !== undefined) {
    target =
      typeof options.account === "string"
        ? accounts.find((a) => a.email === (options.account as string).trim().toLowerCase())
        : undefined;
    if (!target) throw unknownAccount(accounts);
  } else if (accounts.length >= MAX_ACCOUNTS)
    throw new PluginError(
      "TOO_MANY_ACCOUNTS",
      `At most ${MAX_ACCOUNTS} Google accounts can be connected.`,
      "Disconnect one first.",
    );
  const connected = Boolean(target?.refreshToken);
  if (!want.length && !connected)
    throw new PluginError("INVALID_SCOPE", "Pick at least one permission.");
  const allowSend = options.allowSend === true;
  const have = grantedScopes(target ?? {});
  if (allowSend && !want.includes("gmail.send") && !have.has("gmail.send"))
    throw new PluginError("INVALID_SCOPE", "Allow sending needs the Gmail send permission.");
  // Nothing new to ask Google for: only the allowSend preference of that account changes.
  if (target && connected && want.every((w) => have.has(w))) {
    const next = { ...target };
    if (allowSend && have.has("gmail.send")) next.allowSend = "true";
    else delete next.allowSend;
    const { pending: _drop, ...rest } = ctx.config;
    await ctx.setConfig(
      withAccounts(
        rest,
        accounts.map((a) => (a === target ? next : a)),
      ),
    );
    return {};
  }
  const state = b64u(randomBytes(32)),
    verifier = b64u(randomBytes(32));
  const pending = {
    s: b64u(sha(state)),
    v: verifier,
    exp: s.now() + STATE_TTL_MS,
    scopes: want,
    allowSend,
    account: target?.email ?? null,
  };
  await ctx.setConfig({ ...ctx.config, pending: JSON.stringify(pending) });
  const u = new URL(s.authUrl);
  const q: Record<string, string> = {
    client_id: s.clientId,
    redirect_uri: redirectUri(s),
    response_type: "code",
    scope: [...IDENTITY_SCOPES, ...want.map((w) => SCOPES[w].url)].join(" "),
    access_type: "offline",
    prompt: target ? "consent" : "consent select_account",
    include_granted_scopes: "true",
    state,
    code_challenge: b64u(sha(verifier)),
    code_challenge_method: "S256",
  };
  if (target && target.email !== LEGACY_EMAIL) q.login_hint = target.email;
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return { authorizeUrl: u.toString() };
}

const callbacks = new Set<string>();
/** The redirect target of Google. Validates state, consumes it, exchanges the code and seals the tokens. Throws PluginError on every failure. */
export async function finishConnect(ctx: PluginContext, params: URLSearchParams): Promise<void> {
  const s = requireConfigured(ctx.config);
  let pending:
    | {
        s: string;
        v: string;
        exp: number;
        scopes: string[];
        allowSend: boolean;
        account?: string | null;
      }
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
        params.get("error") === "access_denied" ? "ACCESS_DENIED" : "GOOGLE_ERROR",
        params.get("error") === "access_denied"
          ? "Google access was declined."
          : "Google refused the request.",
      );
    const code = params.get("code");
    if (!code || code.length > 2000)
      throw new PluginError("INVALID_STATE", "Google did not return a code.");
    const r = await post(s.tokenUrl, {
      client_id: s.clientId,
      client_secret: s.clientSecret,
      code,
      code_verifier: pending.v,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(s),
    });
    const t = r.body;
    if (!r.ok || typeof t.access_token !== "string")
      throw new PluginError("EXCHANGE_FAILED", "Google rejected the sign-in. Start again.");
    const email = (await fetchEmail(t.access_token))?.toLowerCase();
    if (!email)
      throw new PluginError("NO_EMAIL", "Google did not say which account signed in. Start again.");
    const accounts = readAccounts(rest);
    const existing = accounts.find((a) => a.email === email);
    const refresh = typeof t.refresh_token === "string" ? t.refresh_token : existing?.refreshToken;
    if (!refresh)
      throw new PluginError(
        "NO_REFRESH_TOKEN",
        "Google did not grant offline access. Remove Zetta from your Google account permissions and connect again.",
      );
    const granted = String(t.scope ?? "")
      .split(" ")
      .map(idFromUrl)
      .filter((x): x is ScopeId => Boolean(x));
    const account: GoogleAccount = {
      email,
      refreshToken: refresh,
      accessToken: t.access_token,
      expiresAt: String(s.now() + Number(t.expires_in ?? 3600) * 1000),
      scopes: granted.join(" "),
    };
    if (pending.allowSend && granted.includes("gmail.send")) account.allowSend = "true";
    // Google may sign in another account than the one that was hinted. A legacy account without an email is replaced by the real one.
    const merged = existing
      ? accounts.map((a) => (a.email === email ? account : a))
      : [...accounts, account];
    const list = merged.filter(
      (a) => !(a.email === LEGACY_EMAIL && pending.account === LEGACY_EMAIL && a.email !== email),
    );
    if (list.length > MAX_ACCOUNTS)
      throw new PluginError(
        "TOO_MANY_ACCOUNTS",
        `At most ${MAX_ACCOUNTS} Google accounts can be connected.`,
        "Disconnect one first.",
      );
    await ctx.setConfig(withAccounts(rest, list));
  } finally {
    callbacks.delete(ctx.userId);
  }
}

async function fetchEmail(token: string): Promise<string | undefined> {
  try {
    const res = await settings().fetch(settings().userinfoUrl, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(HTTP_MS),
    });
    const j = (await res.json()) as { email?: unknown };
    return res.ok && typeof j.email === "string" ? j.email.slice(0, 254) : undefined;
  } catch {
    return undefined;
  }
}

const refreshing = new Map<string, Promise<string>>();
/** A valid access token. Refreshes with expiry skew; concurrent callers of one user share a single refresh request. */
export async function accessToken(ctx: PluginContext, force = false): Promise<string> {
  const c = ctx.config;
  const s = settings();
  if (!c.refreshToken)
    throw new PluginError("NEEDS_AUTH", "Google is not connected. Connect it in Studio > Plugins.");
  if (!force && c.accessToken && Number(c.expiresAt) - SKEW_MS > s.now()) return c.accessToken;
  const hit = refreshing.get(ctx.userId);
  if (hit) return hit;
  const work = (async () => {
    const cfg = requireConfigured(ctx.config);
    const r = await post(cfg.tokenUrl, {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: c.refreshToken!,
      grant_type: "refresh_token",
    });
    if (!r.ok) {
      if (r.body.error === "invalid_grant") {
        // revoked, expired (7 days in "testing" mode) or password changed
        const {
          refreshToken: _r,
          accessToken: _a,
          expiresAt: _e,
          scopes: _s,
          allowSend: _w,
          ...rest
        } = ctx.config;
        await ctx.setConfig(rest).catch(() => {});
        throw new PluginError(
          "NEEDS_AUTH",
          "Google access was revoked or expired. Reconnect Google in Studio > Plugins.",
        );
      }
      throw new PluginError("GOOGLE_UNAVAILABLE", "Google could not refresh access right now.");
    }
    const token = r.body.access_token;
    if (typeof token !== "string")
      throw new PluginError("GOOGLE_UNAVAILABLE", "Google could not refresh access right now.");
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

/** Authenticated call to a Google API. Retries once with a forced refresh on 401. Errors are mapped to safe messages (no upstream text). */
export async function gfetch(
  ctx: PluginContext,
  url: string,
  init: { method?: string; json?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const go = async (force: boolean) =>
    settings().fetch(url, {
      method: init.method ?? "GET",
      signal: AbortSignal.timeout(HTTP_MS),
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
    throw new PluginError("GOOGLE_UNAVAILABLE", "Google could not be reached.");
  }
  if (res.ok) return res;
  if (res.status === 401)
    throw new PluginError(
      "NEEDS_AUTH",
      "Google access was revoked or expired. Reconnect Google in Studio > Plugins.",
    );
  if (res.status === 403) {
    const api = await disabledApi(res, url);
    if (api)
      throw new PluginError(
        "API_NOT_ENABLED",
        `The ${api[1]} is not enabled in your Google Cloud project.`,
        `Open ${apiLibraryUrl(api[2])}, press Enable, wait a minute and try again.`,
      );
    throw new PluginError(
      "FORBIDDEN",
      "Google denied that (permission or API not enabled for this project).",
    );
  }
  if (res.status === 404) throw new PluginError("NOT_FOUND", "Google could not find that item.");
  if (res.status === 410)
    throw new PluginError("GONE", "Google no longer has that item or sync position.");
  if (res.status === 412)
    throw new PluginError("PRECONDITION_FAILED", "That item changed on Google in the meantime.");
  if (res.status === 429)
    throw new PluginError("RATE_LIMITED", "Google is rate limiting requests. Try again later.");
  throw new PluginError("GOOGLE_ERROR", "Google could not complete that.");
}

/** Without `options.account` every account is revoked and removed (only the OAuth client stays); with it, only that account. */
export async function disconnect(
  ctx: PluginContext,
  options: Record<string, unknown> = {},
): Promise<void> {
  const accounts = readAccounts(ctx.config);
  const only =
    typeof options.account === "string" ? options.account.trim().toLowerCase() : undefined;
  const gone = only ? accounts.filter((a) => a.email === only) : accounts;
  if (only && !gone.length) throw unknownAccount(accounts);
  for (const a of gone) {
    const tok = a.refreshToken ?? a.accessToken;
    if (tok) await post(settings().revokeUrl, { token: tok }).catch(() => {});
  } // best effort; an already revoked token is fine
  if (only) {
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

export async function status(ctx: PluginContext): Promise<PluginStatus> {
  const s = settings(ctx.config);
  if (!s.clientId || !s.clientSecret || !s.redirectBase) {
    const e = NOT_CONFIGURED();
    return { state: "error", detail: `${e.safe} ${e.fix}` };
  }
  const before = readAccounts(ctx.config);
  if (!before.some((a) => a.refreshToken))
    return { state: "needs-auth", detail: "Not connected yet. Choose permissions and connect." };
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
    return { state: "needs-auth", detail: why || "Reconnect Google in Studio > Plugins." };
  return {
    state: "connected",
    detail: `Connected as ${live.map((a) => accountLabel(a.email)).join(", ")}`,
    info: {
      accounts: accounts.map((a) => ({
        email: a.email,
        state: ok.has(a.email) ? "connected" : "needs-auth",
        scopes: [...grantedScopes(a)],
        allowSend: a.allowSend === "true",
      })),
      // Totals over the working accounts, for callers that only need to know whether some account can do something.
      email: live[0]!.email === LEGACY_EMAIL ? null : live[0]!.email,
      scopes: [...new Set(live.flatMap((a) => [...grantedScopes(a)]))],
      allowSend: live.some((a) => a.allowSend === "true"),
    },
  };
}

// Output helpers live in ../untrusted.ts (shared with other native plugins); re-exported so the Google tools keep importing from here.
export { clip, MAX_OUT, num, str, untrustedDoc, untrustedList } from "../untrusted";
