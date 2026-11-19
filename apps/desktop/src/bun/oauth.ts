import { createHash, randomBytes } from "node:crypto";
import { normalizeOrigin } from "@zetta/core/server-meta";

/**
 * Signs this app in to a Zetta server the way any desktop OAuth client does (RFC 8252 + PKCE): the system browser shows the server's own
 * sign-in and consent pages, and the answer comes back to a one-shot listener on this computer's loopback address. The app is identified to
 * the server by the address of a public client document (a "client id metadata document") that names the loopback redirect, so the server
 * needs no registration and a person approves exactly what the document says.
 */

/** The document that identifies this app (apps/landing/public/oauth/zetta-desktop.json). `ZETTA_DESKTOP_CLIENT_ID` replaces it. */
export const DEFAULT_CLIENT_ID = "https://zettabot.app/oauth/zetta-desktop.json";
export const SCOPES = ["openid", "offline_access", "mcp:read", "mcp:write"] as const;

export type OAuthEndpoints = {
  issuer: string;
  authorization: string;
  token: string;
  revocation: string | null;
  /** The resource the tokens are for: the server's MCP address. */
  resource: string;
};

export type Tokens = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
};

export class OAuthError extends Error {
  constructor(
    readonly code:
      | "DISCOVERY_FAILED"
      | "DENIED"
      | "STATE_MISMATCH"
      | "TIMEOUT"
      | "EXCHANGE_FAILED"
      | "REFRESH_FAILED"
      | "NO_REFRESH",
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export function createPkce(random: (size: number) => Uint8Array = (n) => randomBytes(n)) {
  const verifier = b64url(random(32));
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: b64url(random(16)),
  };
}

async function getJson(fetcher: Fetcher, url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetcher(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Finds where to sign in. Starts from the server's MCP address (the protected resource) and follows its metadata to the authorization
 * server's. Every endpoint must be on the server's own origins: a server cannot send this app to another site to sign in.
 */
export async function discoverEndpoints(
  origins: { webOrigin: string; apiOrigin: string },
  fetcher: Fetcher = fetch,
): Promise<OAuthEndpoints> {
  const api = normalizeOrigin(origins.apiOrigin);
  const web = normalizeOrigin(origins.webOrigin);
  if (!api || !web) throw new OAuthError("DISCOVERY_FAILED", "invalid origin");
  const own = new Set([api, web]);
  const resource = `${api}/api/mcp`;

  const protectedResource =
    (await getJson(fetcher, `${api}/.well-known/oauth-protected-resource/api/mcp`)) ??
    (await getJson(fetcher, `${api}/.well-known/oauth-protected-resource`));
  const servers = protectedResource?.authorization_servers;
  const issuer = normalizeIssuer(
    Array.isArray(servers) && typeof servers[0] === "string" ? servers[0] : `${api}/api/auth`,
  );
  if (!issuer || !own.has(new URL(issuer).origin))
    throw new OAuthError("DISCOVERY_FAILED", "issuer is not on the server");

  const url = new URL(issuer);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  const metadata =
    (await getJson(fetcher, `${url.origin}/.well-known/oauth-authorization-server${path}`)) ??
    (await getJson(fetcher, `${url.origin}${path}/.well-known/oauth-authorization-server`)) ??
    (await getJson(fetcher, `${url.origin}${path}/.well-known/openid-configuration`));
  if (!metadata) throw new OAuthError("DISCOVERY_FAILED", "no authorization server metadata");

  const endpoint = (key: string): string | null => {
    const value = metadata[key];
    if (typeof value !== "string") return null;
    try {
      const parsed = new URL(value);
      return own.has(parsed.origin) ? parsed.toString() : null;
    } catch {
      return null;
    }
  };
  const authorization = endpoint("authorization_endpoint");
  const token = endpoint("token_endpoint");
  if (!authorization || !token)
    throw new OAuthError("DISCOVERY_FAILED", "endpoints are missing or on another site");
  const methods = metadata.code_challenge_methods_supported;
  if (Array.isArray(methods) && !methods.includes("S256"))
    throw new OAuthError("DISCOVERY_FAILED", "server does not support S256");
  return { issuer, authorization, token, revocation: endpoint("revocation_endpoint"), resource };
}

const normalizeIssuer = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString().replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
};

export type LoopbackListener = {
  redirectUri: string;
  /** Resolves with the query the browser came back with; rejects on timeout. */
  result: Promise<URLSearchParams>;
  close(): void;
};

/** A one-shot listener on 127.0.0.1 and a port the system picks. It answers exactly one request to `/callback`. */
export function listenForCallback(timeoutMs = 5 * 60_000): LoopbackListener {
  let settle!: (params: URLSearchParams) => void;
  let fail!: (error: Error) => void;
  const result = new Promise<URLSearchParams>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  let done = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/callback" || done) return new Response("Not found", { status: 404 });
      done = true;
      settle(url.searchParams);
      return new Response(
        '<!doctype html><meta charset=utf-8><title>Zetta</title><body style="font:16px system-ui;margin:3em"><h1>You can close this tab</h1><p>Go back to the Zetta app.</p>',
        { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
      );
    },
  });
  const timer = setTimeout(() => fail(new OAuthError("TIMEOUT")), timeoutMs);
  return {
    redirectUri: `http://127.0.0.1:${server.port}/callback`,
    result,
    close() {
      clearTimeout(timer);
      setTimeout(() => server.stop(true), 100);
    },
  };
}

const tokensFrom = (
  body: Record<string, unknown>,
  now: number,
  previousRefresh: string | null = null,
): Tokens | null => {
  if (typeof body.access_token !== "string" || !body.access_token) return null;
  const seconds =
    typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : previousRefresh,
    expiresAt: now + seconds * 1000,
    scope: typeof body.scope === "string" ? body.scope : SCOPES.join(" "),
  };
};

async function postForm(fetcher: Fetcher, url: string, form: Record<string, string>) {
  const res = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  const body: unknown = await res.json().catch(() => null);
  return {
    ok: res.ok,
    body: (body && typeof body === "object" ? body : {}) as Record<string, unknown>,
  };
}

/** The whole sign-in: open the browser, wait for the answer, trade the code for tokens. */
export async function authorize(options: {
  endpoints: OAuthEndpoints;
  clientId?: string;
  /** Opens the address in the person's browser. */
  open(url: string): void;
  fetcher?: Fetcher;
  listener?: LoopbackListener;
  now?: () => number;
}): Promise<Tokens> {
  const { endpoints, clientId = DEFAULT_CLIENT_ID, fetcher = fetch, now = Date.now } = options;
  const listener = options.listener ?? listenForCallback();
  const pkce = createPkce();
  const url = new URL(endpoints.authorization);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: listener.redirectUri,
    scope: SCOPES.join(" "),
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    resource: endpoints.resource,
  }).toString();
  try {
    options.open(url.toString());
    const answer = await listener.result;
    if (answer.get("error")) throw new OAuthError("DENIED", answer.get("error") ?? undefined);
    if (answer.get("state") !== pkce.state) throw new OAuthError("STATE_MISMATCH");
    const code = answer.get("code");
    if (!code) throw new OAuthError("EXCHANGE_FAILED", "no code");
    const exchanged = await postForm(fetcher, endpoints.token, {
      grant_type: "authorization_code",
      code,
      redirect_uri: listener.redirectUri,
      client_id: clientId,
      code_verifier: pkce.verifier,
      resource: endpoints.resource,
    });
    const tokens = exchanged.ok ? tokensFrom(exchanged.body, now()) : null;
    if (!tokens) throw new OAuthError("EXCHANGE_FAILED");
    return tokens;
  } finally {
    listener.close();
  }
}

/** A new access token from the refresh token. The server may rotate the refresh token; the one that comes back is the one to keep. */
export async function refresh(options: {
  endpoints: OAuthEndpoints;
  tokens: Tokens;
  clientId?: string;
  fetcher?: Fetcher;
  now?: () => number;
}): Promise<Tokens> {
  const {
    endpoints,
    tokens,
    clientId = DEFAULT_CLIENT_ID,
    fetcher = fetch,
    now = Date.now,
  } = options;
  if (!tokens.refreshToken) throw new OAuthError("NO_REFRESH");
  const answer = await postForm(fetcher, endpoints.token, {
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: clientId,
    resource: endpoints.resource,
  }).catch(() => null);
  const next = answer?.ok ? tokensFrom(answer.body, now(), tokens.refreshToken) : null;
  if (!next) throw new OAuthError("REFRESH_FAILED");
  return next;
}

/** Tells the server the tokens are not wanted any more. Best effort: a server without a revocation endpoint is skipped. */
export async function revoke(options: {
  endpoints: OAuthEndpoints;
  tokens: Tokens;
  clientId?: string;
  fetcher?: Fetcher;
}): Promise<boolean> {
  const { endpoints, tokens, clientId = DEFAULT_CLIENT_ID, fetcher = fetch } = options;
  if (!endpoints.revocation) return false;
  let ok = true;
  for (const [hint, token] of [
    ["refresh_token", tokens.refreshToken],
    ["access_token", tokens.accessToken],
  ] as const) {
    if (!token) continue;
    const answer = await postForm(fetcher, endpoints.revocation, {
      token,
      token_type_hint: hint,
      client_id: clientId,
    }).catch(() => null);
    if (!answer?.ok) ok = false;
  }
  return ok;
}

/** True when the access token should be replaced now (it is within a minute of its end). */
export const needsRefresh = (tokens: Tokens, now = Date.now()) => tokens.expiresAt - now < 60_000;
