import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

export type InvitationSignupBefore = NonNullable<NonNullable<NonNullable<
  NonNullable<BetterAuthOptions["databaseHooks"]>["user"]
>["create"]>["before"]>;

/** Preflight only. A true result grants neither membership nor invitation consumption. */
export type InvitationSignupVerifier = (input: Readonly<{ token: string; email: string }>) => Promise<boolean>;

/** First-account setup: while no installation exists, a signup without an invitation
 * is allowed and `claim` must atomically make it the admin. `discard` removes the
 * account again when the claim fails (e.g. a concurrent first signup won). */
export type FirstAccountSetup = Readonly<{
  isOpen: () => Promise<boolean>;
  claim: (userId: string) => Promise<void>;
  discard: (userId: string) => Promise<void>;
}>;

const signupFields = ["name", "email", "password", "image", "callbackURL", "rememberMe", "invitationToken"];
const userFields = ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function email(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+$/.test(value);
}

function tokenShaped(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

async function setupSignup(body: unknown, setup?: FirstAccountSetup): Promise<boolean> {
  try {
    if (!setup || !record(body) || !email(body.email) || Object.keys(body).some((key) => !signupFields.includes(key))) return false;
    return await setup.isOpen() === true;
  } catch {
    return false;
  }
}

async function invited(body: unknown, verify: InvitationSignupVerifier): Promise<boolean> {
  try {
    if (typeof verify !== "function" || !record(body) || !email(body.email)
      || Object.keys(body).some((key) => !signupFields.includes(key))) return false;
    const token = body.invitationToken;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)
      || Buffer.from(token, "base64url").toString("base64url") !== token) return false;
    return await verify({ token, email: body.email.toLowerCase() }) === true;
  } catch {
    return false;
  }
}

/** Run before the endpoint can disclose whether an account already exists. */
export function createInvitationSignupGate(verify: InvitationSignupVerifier, setup?: FirstAccountSetup) {
  return createAuthMiddleware(async (context) => {
    if (context.path !== "/sign-up/email") return;
    if (!await invited(context.body, verify) && !await setupSignup(context.body, setup)) {
      throw new APIError("BAD_REQUEST", { code: "FAILED_TO_CREATE_USER", message: "Failed to create user" });
    }
  });
}

/** Inactive until explicitly injected as databaseHooks.user.create.before.
 * Better Auth 1.7.7 preserves extra /sign-up/email body fields in context.body;
 * invitationToken is body-only, not a user.additionalFields/schema attribute.
 * Return false for every denial (including absent runtime context/verifier), so
 * Better Auth aborts creation without receiving sensitive verifier errors.
 */
export function createInvitationSignupPolicy(verify: InvitationSignupVerifier, setup?: FirstAccountSetup): InvitationSignupBefore {
  return async (user, context) => {
    try {
      if (typeof verify !== "function" || !context || context.path !== "/sign-up/email") return false;
      const body: unknown = context.body;
      if (!record(body) || Object.keys(body).some((key) => !signupFields.includes(key))) return false;
      if (!record(user) || Object.keys(user).some((key) => !userFields.includes(key)) || user.emailVerified !== false) return false;
      if (!email(user.email) || !email(body.email) || body.email.toLowerCase() !== user.email.toLowerCase()) return false;
      if (!await invited(body, verify) && !await setupSignup(body, setup)) return false;
      // No replacement data: leave account creation to Better Auth. Acceptance
      // must later recheck/consume atomically in authenticated enrollment (004b).
      return;
    } catch {
      return false;
    }
  };
}

type SignupAfter = NonNullable<NonNullable<NonNullable<
  NonNullable<BetterAuthOptions["databaseHooks"]>["user"]
>["create"]>["after"]>;

/** Promotes a tokenless first signup to installation admin; rolls the account back if it cannot. */
export function createFirstAccountClaim(setup: FirstAccountSetup): SignupAfter {
  return async (user, context) => {
    const body: unknown = context?.body;
    if (context?.path !== "/sign-up/email" || !record(body) || tokenShaped(body.invitationToken)) return;
    try {
      await setup.claim(user.id);
    } catch {
      await setup.discard(user.id).catch(() => {});
      throw new APIError("BAD_REQUEST", { code: "FAILED_TO_CREATE_USER", message: "Failed to create user" });
    }
  };
}
