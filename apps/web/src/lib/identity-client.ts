import z from "zod";

import { ENV } from "../env";
import { invalidateAuthGuard } from "./auth-guard";

const identifier = z.string().min(1);
export const identityStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("anonymous") }).strict(),
  z.object({ state: z.literal("unenrolled"), userId: identifier }).strict(),
  z.object({ state: z.literal("active"), userId: identifier, isAdmin: z.boolean() }).strict(),
]);
const invitationSchema = z
  .object({
    invitationId: identifier,
    expiresAt: z.iso.datetime(),
    token: identifier,
  })
  .strict();
const pendingInvitationsSchema = z
  .object({
    invitations: z.array(
      z
        .object({
          invitationId: identifier,
          intendedEmail: z.string(),
          createdAt: z.iso.datetime(),
          expiresAt: z.iso.datetime(),
        })
        .strict(),
    ),
  })
  .strict();
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export type IdentityStatus = z.infer<typeof identityStatusSchema>;
export type IssuedInvitation = z.infer<typeof invitationSchema>;
export type PendingInvitation = z.infer<typeof pendingInvitationsSchema>["invitations"][number];
export type InvitationInput = { intendedEmail: string; intendedUserId?: string };
export type SignUpInput = {
  name: string;
  email: string;
  password: string;
  invitationToken?: string;
  /** First-run onboarding only: the server's setup key (ZETTA_SETUP_KEY, or ZETTA_CONNECTION_KEY when unset), proof that the caller owns the installation. */
  setupKey?: string;
};
export type IdentityFetch = (input: URL, init: RequestInit) => Promise<Response>;

export class IdentityRequestError extends Error {
  constructor(public readonly code: string) {
    super(identityErrorMessage(code));
    this.name = "IdentityRequestError";
  }
}

export function identityErrorMessage(code: string): string {
  switch (code) {
    case "INVALID_REQUEST":
      return "Check the information and try again.";
    case "SIGN_IN_REQUIRED":
      return "Your session ended. Sign out, then sign in again.";
    case "ACCESS_DENIED":
      return "This action is unavailable for this account. Check your invitation or contact the installation operator.";
    case "UNTRUSTED_ORIGIN":
      return "This app address is not authorized. Contact the installation operator.";
    case "ENROLLMENT_UNAVAILABLE":
      return "This invitation cannot be used. Ask the installation operator for a new invitation.";
    case "SETUP_KEY_MISMATCH":
      return "That key does not match this server's setup key. Copy it again from the server settings.";
    case "SETUP_CLOSED":
      return "Zetta is already set up. Sign in instead.";
    case "SIGNUP_FAILED":
      return "The account could not be created. Check your invitation and account details, or try signing in if you already have an account.";
    case "INVALID_RESPONSE":
      return "The server returned an unexpected response. Check your status before trying again.";
    default:
      return "Zetta could not connect to the identity service. Check your connection and retry your status.";
  }
}

export function getIdentityError(error: unknown): string {
  return error instanceof IdentityRequestError
    ? error.message
    : identityErrorMessage("IDENTITY_UNAVAILABLE");
}

export function createIdentityClient(
  serverUrl: string,
  fetcher: IdentityFetch = fetch,
  options: { timeoutMs?: number } = {},
) {
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: object,
    signUp = false,
  ): Promise<T> {
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    async function execute(): Promise<T> {
      let response: Response;
      try {
        response = await fetcher(new URL(path, serverUrl), {
          method: body ? "POST" : "GET",
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new IdentityRequestError("IDENTITY_UNAVAILABLE");
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new IdentityRequestError("INVALID_RESPONSE");
      }
      if (!response.ok) {
        const parsed = errorSchema.safeParse(data);
        throw new IdentityRequestError(
          signUp
            ? "SIGNUP_FAILED"
            : parsed.success
              ? parsed.data.error.code
              : "IDENTITY_UNAVAILABLE",
        );
      }
      const parsed = schema.safeParse(data);
      if (!parsed.success) throw new IdentityRequestError("INVALID_RESPONSE");
      return parsed.data;
    }
    try {
      return await Promise.race([
        execute(),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => {
            controller.abort();
            reject(new IdentityRequestError("IDENTITY_UNAVAILABLE"));
          }, options.timeoutMs ?? 20_000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
  }
  return {
    status: () => request("/api/identity/status", identityStatusSchema),
    setup: () => request("/api/identity/setup", z.object({ required: z.boolean() }).strict()),
    verifySetupKey: (key: string) =>
      request("/api/identity/setup/key", z.object({ ok: z.literal(true) }).strict(), { key }),
    issue: (input: InvitationInput) =>
      request("/api/identity/invitations", invitationSchema, input),
    pending: () =>
      request("/api/identity/invitations", pendingInvitationsSchema).then((r) => r.invitations),
    accept: (token: string) =>
      request("/api/identity/invitations/accept", z.object({ userId: identifier }).strict(), {
        token,
      }),
    revoke: (invitationId: string) =>
      request("/api/identity/invitations/revoke", z.object({ invitationId: identifier }).strict(), {
        invitationId,
      }),
    signUp: (input: SignUpInput) =>
      request(
        "/api/auth/sign-up/email",
        z.object({ user: z.object({ id: identifier }) }),
        input,
        true,
      ),
  };
}

function configuredClient() {
  const processEnv = typeof process === "undefined" ? undefined : process.env;
  const serverUrl =
    typeof window === "undefined" && processEnv?.SERVER_URL
      ? processEnv.SERVER_URL
      : ENV.VITE_SERVER_URL;
  // A write (sign-up, accepting an invitation, setup) changes what the `_auth` guard should answer: drop its cache.
  return createIdentityClient(serverUrl, async (input, init) => {
    if (init.method !== "GET") invalidateAuthGuard();
    try {
      return await fetch(input, init);
    } finally {
      if (init.method !== "GET") invalidateAuthGuard();
    }
  });
}

export const identityClient = {
  status: () => configuredClient().status(),
  setup: () => configuredClient().setup(),
  verifySetupKey: (key: string) => configuredClient().verifySetupKey(key),
  issue: (input: InvitationInput) => configuredClient().issue(input),
  pending: () => configuredClient().pending(),
  accept: (token: string) => configuredClient().accept(token),
  revoke: (invitationId: string) => configuredClient().revoke(invitationId),
  signUp: (input: SignUpInput) => configuredClient().signUp(input),
};
