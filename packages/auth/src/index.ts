import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@zetta/db";
import { uuidv7 } from "@zetta/core/uuid";
import * as schema from "@zetta/db/schema/auth";
import { rateLimit } from "@zetta/db/schema/runtime";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, isAPIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { createProfileWriteGate } from "./account-write-gate";
import { CLIENT_IP_HEADER } from "./client-ip-header";
import { pairPhone } from "./pair-phone";
import {
  createFirstAccountClaim,
  createInvitationSignupGate,
  createInvitationSignupPolicy,
  type FirstAccountSetup,
  type InvitationSignupVerifier,
} from "./invitation-policy";

export { CLIENT_IP_HEADER };
export { requireMcpAuth, type McpGuardAuth } from "./mcp-guard";
export { createInsufficientScopeError } from "better-auth/oauth2";

/** OAuth scopes of Zetta's MCP server: read tools need `mcp:read`, tools that change something need `mcp:write`. */
export const MCP_SCOPES = { read: "mcp:read", write: "mcp:write" } as const;

/** The protected resource MCP access tokens are bound to (their `aud`). OAuth needs HTTPS here, except on loopback. */
export function mcpResource(env: Pick<AuthConfig, "BETTER_AUTH_URL">) {
  return new URL("/api/mcp", env.BETTER_AUTH_URL).toString();
}

/**
 * `none` lets the desktop app (a `views://` origin) call the API with the session cookie. A web-only install should set
 * ZETTA_COOKIE_SAMESITE=lax so other sites cannot make the browser send the session cookie at all.
 */
function cookieSameSite(): "none" | "lax" | "strict" {
  const v = process.env.ZETTA_COOKIE_SAMESITE?.trim().toLowerCase();
  return v === "lax" || v === "strict" ? v : "none";
}

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

/** Trusted server composition only; never derived from client flags or input. */
export type AuthFactoryOptions = {
  invitationSignupVerifier: InvitationSignupVerifier;
  /** Allows the very first (admin) account to sign up without an invitation. */
  firstAccount?: FirstAccountSetup;
};

/** Pure configuration assembly: Better Auth 1.7.7 eagerly initializes its context.
 * Omitted options preserve legacy composition, NOT v1 closed-enrollment activation.
 * Explicit options always install the policy; malformed verifiers deny at the hook.
 */
export function createAuthOptions(
  env: AuthConfig,
  database: Omit<Database, "$client">,
  desktopOrigins: readonly string[] = [],
  options?: AuthFactoryOptions,
) {
  return {
    database: drizzleAdapter(database, {
      provider: "pg",
      transaction: true,
      // `rateLimit` is only read when the counters are stored in the database (`ZETTA_AUTH_RATE_LIMIT_STORAGE=database`).
      schema: { ...schema, rateLimit },
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Sign-in is the password-guessing surface: a longer window than the default (3 per 10 s) that still stops a brute force per client.
    // With several servers the counters live in the database, so the limit is per client and not per server.
    rateLimit: {
      ...(process.env.ZETTA_AUTH_RATE_LIMIT_STORAGE === "database"
        ? { storage: "database" as const, modelName: "rateLimit" }
        : {}),
      // Changing the password asks for the current one, so a stolen cookie could guess it: 10 tries per 15 minutes per client
      // (the default is 3 per 10 s, about 1000 an hour).
      customRules: {
        "/sign-in/email": { window: 15 * 60, max: 20 },
        "/change-password": { window: 15 * 60, max: 10 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: { generateId: () => uuidv7() },
      defaultCookieAttributes: {
        sameSite: cookieSameSite(),
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [
      // Signs MCP access tokens and serves /jwks. requireMcpAuth (./mcp-guard) reads the same keys in process, with no HTTP call.
      jwt(),
      mcp({
        // The sign-in and consent pages are web app routes; the API redirects there with a signed query.
        loginPage: new URL("/login", env.CORS_ORIGIN).toString(),
        consentPage: new URL("/oauth/consent", env.CORS_ORIGIN).toString(),
        resource: mcpResource(env),
        scopes: ["openid", "profile", "email", "offline_access", MCP_SCOPES.read, MCP_SCOPES.write],
        // Clients identify themselves through CIMD only. Without this, any member could create or edit OAuth clients through the API and
        // name one like Zetta itself to phish a teammate's consent.
        clientPrivileges: () => false,
      }),
      // MCP clients identify themselves by a metadata URL instead of registering. The bundled transport resolves the host once, refuses
      // private and special-use addresses, pins the address and never follows redirects (checked on Bun in oauth-transport.test.ts).
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      // Pairing a phone by QR code: the phone gets a session of its own (see ./pair-phone).
      pairPhone(),
    ],
    ...(options === undefined
      ? {}
      : {
          onAPIError: {
            onError(error: unknown) {
              if (isAPIError(error)) throw error;
              throw new APIError("INTERNAL_SERVER_ERROR", {
                code: "AUTHENTICATION_UNAVAILABLE",
                message: "Authentication unavailable",
              });
            },
          },
          hooks: {
            before: createProfileWriteGate(
              createInvitationSignupGate(options?.invitationSignupVerifier, options?.firstAccount),
            ),
          },
          databaseHooks: {
            user: {
              create: {
                before: createInvitationSignupPolicy(
                  options?.invitationSignupVerifier,
                  options?.firstAccount,
                ),
                ...(options?.firstAccount
                  ? { after: createFirstAccountClaim(options.firstAccount) }
                  : {}),
              },
            },
          },
        }),
  } satisfies BetterAuthOptions;
}

export function createAuth(
  env: AuthConfig,
  database: Omit<Database, "$client">,
  desktopOrigins: readonly string[] = [],
  options?: AuthFactoryOptions,
) {
  return betterAuth(createAuthOptions(env, database, desktopOrigins, options));
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
