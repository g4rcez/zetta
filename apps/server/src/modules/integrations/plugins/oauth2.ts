import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { PluginError, type PluginContext } from "./registry";

/**
 * Authorization-code + PKCE for plugins whose service signs people in with OAuth 2 (Canva, and new ones). The person registers their
 * own app with the service (client id and secret in the plugin's sealed config), so nothing depends on a Zetta-wide app. The pending
 * state is single use, kept hashed in the same sealed config, and expires after 10 minutes. Tokens are sealed there too and refreshed
 * before they expire. Same rules as the Google flow (google/oauth.ts), in one place for the plugins that follow it.
 */
export type OAuthProvider = {
  /** Plugin id: the callback is /api/plugins/<id>/callback. */
  id: string;
  service: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Client credentials sent as HTTP Basic (Canva) instead of in the body. */
  basicAuth?: boolean;
};

const STATE_TTL_MS = 10 * 60_000;
const b64u = (b: Buffer) => b.toString("base64url");
const sha = (s: string) => createHash("sha256").update(s).digest();

export const redirectBase = () =>
  (process.env.ZETTA_OAUTH_REDIRECT_BASE || process.env.BETTER_AUTH_URL || "").replace(/\/+$/, "");
export const redirectUri = (p: OAuthProvider) => `${redirectBase()}/api/plugins/${p.id}/callback`;

function client(p: OAuthProvider, ctx: PluginContext) {
  const id = (ctx.config.clientId ?? "").trim();
  const secret = (ctx.config.clientSecret ?? "").trim();
  if (!id || !secret)
    throw new PluginError(
      "NOT_CONFIGURED",
      `${p.service} has no app yet.`,
      `Create an app (integration) in ${p.service}'s developer portal with ${redirectUri(p)} as its redirect URL, then enter its client ID and secret in the plugin settings.`,
    );
  return { id, secret };
}

export async function startOAuth(p: OAuthProvider, ctx: PluginContext) {
  const c = client(p, ctx);
  const state = b64u(randomBytes(32));
  const verifier = b64u(randomBytes(48));
  await ctx.setConfig({
    ...ctx.config,
    pending: JSON.stringify({ s: b64u(sha(state)), v: verifier, exp: Date.now() + STATE_TTL_MS }),
  });
  const u = new URL(p.authUrl);
  for (const [k, v] of Object.entries({
    client_id: c.id,
    redirect_uri: redirectUri(p),
    response_type: "code",
    scope: p.scopes.join(" "),
    state,
    code_challenge: b64u(sha(verifier)),
    code_challenge_method: "S256",
  }))
    u.searchParams.set(k, v);
  return { authorizeUrl: u.toString() };
}

async function tokenRequest(p: OAuthProvider, ctx: PluginContext, form: Record<string, string>) {
  const c = client(p, ctx);
  const body = new URLSearchParams(
    p.basicAuth ? form : { ...form, client_id: c.id, client_secret: c.secret },
  );
  const res = await fetch(p.tokenUrl, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(p.basicAuth
        ? { Authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString("base64")}` }
        : {}),
    },
    body,
  }).catch(() => undefined);
  const t = (await res?.json().catch(() => undefined)) as
    | { access_token?: string; refresh_token?: string; expires_in?: number }
    | undefined;
  if (!res?.ok || typeof t?.access_token !== "string")
    throw new PluginError(
      "EXCHANGE_FAILED",
      `${p.service} refused the sign-in.`,
      "Connect again from the plugin page.",
    );
  return t as { access_token: string; refresh_token?: string; expires_in?: number };
}

/** The service redirected back: check and consume the state, exchange the code, seal the tokens. */
export async function finishOAuth(p: OAuthProvider, ctx: PluginContext, params: URLSearchParams) {
  let pending: { s: string; v: string; exp: number } | undefined;
  try {
    pending = ctx.config.pending ? JSON.parse(ctx.config.pending) : undefined;
  } catch {
    pending = undefined;
  }
  const state = params.get("state") ?? "";
  const a = Buffer.from(b64u(sha(state)));
  const b = Buffer.from(pending?.s ?? "");
  if (!pending || !state || a.length !== b.length || !timingSafeEqual(a, b))
    throw new PluginError("INVALID_STATE", "That sign-in link is no longer valid. Start again.");
  const { pending: _drop, ...rest } = ctx.config;
  await ctx.setConfig(rest); // single use, gone before the code is exchanged
  if (Date.now() > pending.exp)
    throw new PluginError("STATE_EXPIRED", "That sign-in took too long. Start again.");
  if (params.get("error"))
    throw new PluginError("ACCESS_DENIED", `${p.service} access was declined.`);
  const code = params.get("code");
  if (!code || code.length > 4000)
    throw new PluginError("INVALID_STATE", `${p.service} did not return a code.`);
  const t = await tokenRequest(
    p,
    { ...ctx, config: rest },
    {
      grant_type: "authorization_code",
      code,
      code_verifier: pending.v,
      redirect_uri: redirectUri(p),
    },
  );
  await ctx.setConfig({
    ...rest,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? rest.refreshToken ?? "",
    expiresAt: String(Date.now() + (t.expires_in ?? 3600) * 1000),
  });
}

/** A usable access token, refreshed when it is about to expire. */
export async function accessToken(p: OAuthProvider, ctx: PluginContext) {
  const token = ctx.config.accessToken;
  if (!token)
    throw new PluginError(
      "NEEDS_AUTH",
      `${p.service} is not connected.`,
      "Open the plugin and click Connect.",
    );
  if (Number(ctx.config.expiresAt ?? 0) - Date.now() > 60_000) return token;
  if (!ctx.config.refreshToken)
    throw new PluginError(
      "NEEDS_AUTH",
      `The ${p.service} sign-in expired.`,
      "Open the plugin and connect again.",
    );
  const t = await tokenRequest(p, ctx, {
    grant_type: "refresh_token",
    refresh_token: ctx.config.refreshToken,
  });
  await ctx.setConfig({
    ...ctx.config,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? ctx.config.refreshToken,
    expiresAt: String(Date.now() + (t.expires_in ?? 3600) * 1000),
  });
  return t.access_token;
}

/** Forgets the tokens and keeps the app (client id and secret), so connecting again needs no new setup. */
export async function disconnectOAuth(ctx: PluginContext) {
  const { accessToken: _a, refreshToken: _r, expiresAt: _e, pending: _p, ...keep } = ctx.config;
  await ctx.setConfig(keep);
}
