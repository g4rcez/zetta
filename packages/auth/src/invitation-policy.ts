import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

export type InvitationSignupBefore = NonNullable<NonNullable<NonNullable<
  NonNullable<BetterAuthOptions["databaseHooks"]>["user"]
>["create"]>["before"]>;

/** Preflight only. A true result grants neither membership nor invitation consumption. */
export type InvitationSignupVerifier = (input: Readonly<{ token: string; email: string }>) => Promise<boolean>;

const signupFields = ["name", "email", "password", "image", "callbackURL", "rememberMe", "invitationToken"];
const userFields = ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function email(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+$/.test(value);
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
export function createInvitationSignupGate(verify: InvitationSignupVerifier) {
  return createAuthMiddleware(async (context) => {
    if (context.path !== "/sign-up/email") return;
    if (!await invited(context.body, verify)) {
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
export function createInvitationSignupPolicy(verify: InvitationSignupVerifier): InvitationSignupBefore {
  return async (user, context) => {
    try {
      if (typeof verify !== "function" || !context || context.path !== "/sign-up/email") return false;
      const body: unknown = context.body;
      if (!record(body) || Object.keys(body).some((key) => !signupFields.includes(key))) return false;
      if (!record(user) || Object.keys(user).some((key) => !userFields.includes(key)) || user.emailVerified !== false) return false;
      if (!email(user.email) || !email(body.email) || body.email.toLowerCase() !== user.email.toLowerCase()) return false;
      if (!await invited(body, verify)) return false;
      // No replacement data: leave account creation to Better Auth. Acceptance
      // must later recheck/consume atomically in authenticated enrollment (004b).
      return;
    } catch {
      return false;
    }
  };
}
