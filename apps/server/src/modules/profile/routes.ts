import { isAvatarValue, type AvatarValue } from "@zetta/core/avatar";
import { Elysia } from "elysia";
import { z } from "zod";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import type { ProfileStore } from "./store";

export type ProfileServices = {
  access: ReturnType<typeof createIdentityAccess>;
  profile: ProfileStore;
  /** The id of the session the request belongs to, so the list can say "this device". */
  currentSessionId: (headers: Headers) => Promise<string | undefined>;
};

// Only the name and the picture change here. The email is not part of it: changing it needs a verification the app does not have.
const patch = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((s) => !/\p{Cc}/u.test(s))
    .optional(),
  avatar: z.custom<AvatarValue>(isAvatarValue).nullable().optional(),
});

function mapError(e: unknown) {
  if (e instanceof AccessError) return accessFail(e);
  if (e instanceof z.ZodError)
    return fail(400, "INVALID_REQUEST", "Check the details and try again.");
  return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
}

export function createProfileRoutes(
  { access, profile, currentSessionId }: ProfileServices,
  trustedOrigins: readonly string[],
): Elysia {
  const g = createGuardedRoute({
    access: {
      requireActive: async (headers) => ({
        actor: await access.requireActive(headers),
        sessionId: await currentSessionId(headers),
      }),
    },
    trustedOrigins,
    mapError,
  });
  // Typed as a plain Elysia: one more typed route group makes the chain in app.ts too large for TypeScript to represent.
  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/profile",
      g(async ({ actor: { actor } }) => ({ profile: await profile.get(actor) })),
    )
    .patch(
      "/profile",
      g(async ({ actor: { actor }, body }) => ({
        profile: await profile.update(actor, patch.parse(body)),
      })),
    )
    .get(
      "/profile/sessions",
      g(async ({ actor: { actor, sessionId } }) => ({
        sessions: await profile.sessions(actor, sessionId),
      })),
    ) as unknown as Elysia;
}
