import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@zetta/db";
import * as schema from "@zetta/db/schema/auth";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, isAPIError } from "better-auth/api";
import { createInvitationSignupGate, createInvitationSignupPolicy, type InvitationSignupVerifier } from "./invitation-policy";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

/** Trusted server composition only; never derived from client flags or input. */
export type AuthFactoryOptions = {
  invitationSignupVerifier: InvitationSignupVerifier;
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
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [],
    ...(options === undefined ? {} : {
      onAPIError: {
        onError(error: unknown) {
          if (isAPIError(error)) throw error;
          throw new APIError("INTERNAL_SERVER_ERROR", { code: "AUTHENTICATION_UNAVAILABLE", message: "Authentication unavailable" });
        },
      },
      hooks: { before: createInvitationSignupGate(options?.invitationSignupVerifier) },
      databaseHooks: {
        user: {
          create: {
            before: createInvitationSignupPolicy(options?.invitationSignupVerifier),
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
