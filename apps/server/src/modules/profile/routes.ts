import { isAvatarValue, type AvatarValue } from "@zetta/core/avatar";
import { isTimeZone, PROFILE_LIMITS, profileTextProblem } from "@zetta/core/person-profile";
import { Elysia } from "elysia";
import { z } from "zod";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import type { PeopleDirectory } from "../people/directory";
import type { ProfileStore } from "./store";

export type ProfileServices = {
  access: ReturnType<typeof createIdentityAccess>;
  profile: ProfileStore;
  /** What members may read about each other (`GET /api/people`). */
  people: PeopleDirectory;
  /** The id of the session the request belongs to, so the list can say "this device". */
  currentSessionId: (headers: Headers) => Promise<string | undefined>;
};

/** A profile line: trimmed, at most `max` characters, plain text. `multiline` keeps line breaks (the "about" text). */
const line = (max: number, multiline = false) =>
  z
    .string()
    .trim()
    .max(max)
    .superRefine((v, ctx) => {
      const problem = profileTextProblem(v, multiline);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    });

// The name, the picture and the profile lines change here. The email is not part of it: changing it needs a verification the app does not have.
const patch = z.strictObject({
  jobTitle: line(PROFILE_LIMITS.jobTitle).optional(),
  department: line(PROFILE_LIMITS.department).optional(),
  about: line(PROFILE_LIMITS.about, true).optional(),
  // Empty means "the browser's"; anything else must be a real IANA name.
  timezone: z
    .string()
    .trim()
    .max(PROFILE_LIMITS.timezone)
    .refine((v) => v === "" || isTimeZone(v))
    .optional(),
  contact: line(PROFILE_LIMITS.contact).optional(),
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
  { access, profile, people, currentSessionId }: ProfileServices,
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
  return (
    new Elysia({ prefix: "/api", normalize: false })
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
      // The members of this installation, with the lines each one wrote about themselves. No email. `q` narrows by name, title, department.
      .get(
        "/people",
        g(async ({ query }) => {
          const q = (query.q ?? "").trim().toLowerCase().slice(0, 100);
          const all = await people.list();
          const shown = q
            ? all.filter((p) =>
                [p.name, p.title, p.department].some((f) => f.toLowerCase().includes(q)),
              )
            : all;
          return { people: shown };
        }),
      )
      .get(
        "/profile/sessions",
        g(async ({ actor: { actor, sessionId } }) => ({
          sessions: await profile.sessions(actor, sessionId),
        })),
      ) as unknown as Elysia
  );
}
