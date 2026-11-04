import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import {
  createInsufficientScopeError,
  isInsufficientScopeError,
  verifyJwsAccessToken,
} from "better-auth/oauth2";

type JwksFetch = Extract<Parameters<typeof verifyJwsAccessToken>[1]["jwksFetch"], () => unknown>;
type Claims = Awaited<ReturnType<typeof verifyJwsAccessToken>>;

/** The part of the better-auth instance the guard uses. Its `jwt()` plugin signs the tokens and holds their public keys. */
export type McpGuardAuth = {
  $context: Promise<{ baseURL?: string }>;
  api: { getJwks: JwksFetch };
};

/** A failure to read the signing keys is a server fault (500), never a reason to tell the client its token is bad. */
class JwksUnavailable extends Error {
  constructor(readonly original: unknown) {
    super("signing keys unavailable");
  }
}

const unauthorized = (message: string, error?: "invalid_token") =>
  new APIError(
    "UNAUTHORIZED",
    error ? { message, error, error_description: message } : { message },
  );

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (!header) throw unauthorized("missing authorization header");
  // DPoP-bound tokens need a proof check that this guard does not do, so only the plain Bearer scheme is accepted.
  const match = /^Bearer +(\S+)$/i.exec(header);
  if (!match?.[1]) throw unauthorized("authorization scheme must be Bearer", "invalid_token");
  return match[1];
}

function toUnauthorized(error: unknown): unknown {
  if (error instanceof APIError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "JWTExpired") return unauthorized("token expired");
  // jose errors (bad signature, wrong issuer or audience, unknown key) and malformed tokens: the client sent a bad token.
  if (
    error instanceof TypeError ||
    (error as { code?: unknown })?.code?.toString().startsWith("ERR_J")
  )
    return unauthorized("invalid access token");
  return error;
}

function challengeResponse(error: unknown, resource: string, scopes: readonly string[]): Response {
  const challenge = createResourceServerChallenge(error, resource, {
    challengeScopes: [...scopes],
  });
  if (!challenge) throw error;
  const headers = new Headers(challenge.headers);
  headers.set("Content-Type", "application/json");
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: challenge.message },
      id: null,
    }),
    { status: challenge.statusCode, headers },
  );
}

/**
 * Protects an MCP resource with an OAuth access token issued by `auth`, checked in this process: the signing keys come from
 * `auth.api.getJwks()`, not from an HTTP call to the server's own `/jwks` URL (what `requireMcpAuth` of @better-auth/mcp does).
 * Failures answer like that library: 401 or 403 with an RFC 9728 `WWW-Authenticate` challenge and a JSON-RPC error body.
 * Checks: Bearer scheme, signature, issuer (the auth base URL), audience (`resource`), expiry, required scopes, and no DPoP binding.
 */
export function requireMcpAuth(
  auth: McpGuardAuth,
  handler: (request: Request, claims: Claims) => Response | Promise<Response>,
  opts: { resource: string; requiredScopes: readonly string[] },
): (request: Request) => Promise<Response> {
  // Stable key: lets the verifier cache the key set (5 minutes, refetched on an unknown kid) instead of reading it on every request.
  const jwksCacheKey = {};
  const jwksFetch: JwksFetch = async () => {
    try {
      return await auth.api.getJwks();
    } catch (error) {
      throw new JwksUnavailable(error);
    }
  };
  return async (request) => {
    const { baseURL } = await auth.$context;
    if (!baseURL) throw new Error("requireMcpAuth requires the auth base URL");
    let claims: Claims;
    try {
      claims = await verifyJwsAccessToken(bearerToken(request), {
        jwksFetch,
        jwksCacheKey,
        verifyOptions: { issuer: baseURL, audience: opts.resource },
      });
      if ((claims.cnf as { jkt?: unknown } | undefined)?.jkt)
        throw unauthorized("DPoP-bound access tokens are not accepted", "invalid_token");
      const granted = new Set(typeof claims.scope === "string" ? claims.scope.split(" ") : []);
      const missing = opts.requiredScopes.filter((scope) => !granted.has(scope));
      if (missing.length > 0) throw createInsufficientScopeError(missing);
    } catch (error) {
      if (error instanceof JwksUnavailable) throw error.original;
      return challengeResponse(toUnauthorized(error), opts.resource, opts.requiredScopes);
    }
    try {
      return await handler(request, claims);
    } catch (error) {
      if (isInsufficientScopeError(error))
        return challengeResponse(error, opts.resource, opts.requiredScopes);
      throw error;
    }
  };
}
