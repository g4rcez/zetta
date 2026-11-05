import { APIError, createAuthMiddleware } from "better-auth/api";
import type { createInvitationSignupGate } from "./invitation-policy";

/**
 * Better Auth's own `/update-user` takes any name and any image of any size, and the app never calls it: a person's name and picture
 * change through `/api/profile`, which validates them. It is refused here, in front of the signup gate, for every caller of the handler.
 */
export function createProfileWriteGate(next: ReturnType<typeof createInvitationSignupGate>) {
  return createAuthMiddleware(async (context) => {
    if (context.path === "/update-user")
      throw new APIError("FORBIDDEN", {
        code: "PROFILE_API_ONLY",
        message: "Change your profile in Preferences.",
      });
    await (next as unknown as (context: unknown) => Promise<unknown>)(context);
  });
}
