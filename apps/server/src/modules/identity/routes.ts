import { Elysia, t } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "./access";
import type { createEnrollmentService } from "./enrollment";

export type IdentityServices = {
  access: ReturnType<typeof createIdentityAccess>;
  enrollment: ReturnType<typeof createEnrollmentService>;
  /** True until the first (root/admin) account exists. */
  setupOpen?: () => Promise<boolean>;
  /** Constant-time check of the typed server connection key (first-run onboarding). */
  verifySetupKey?: (key: string) => boolean;
};

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
const invalid = () =>
  errorResponse(400, "INVALID_REQUEST", "Check the invitation details and try again.");

const boundedString = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.trim() === value);
const issueInput = z.strictObject({
  intendedEmail: boundedString.regex(/^[^\s@]+@[^\s@]+$/),
  intendedUserId: boundedString.optional(),
});
const acceptInput = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const setupKeyInput = z.strictObject({ key: z.string().min(1).max(512) });
const revokeInput = z.strictObject({ invitationId: boundedString });

export function createIdentityRoutes(
  { access, enrollment, setupOpen, verifySetupKey }: IdentityServices,
  trustedOrigins: readonly string[],
) {
  return new Elysia({ prefix: "/api/identity", normalize: false })
    .onError(({ error }) => {
      // Parser errors can be produced before the handler. Never expose or log body diagnostics.
      if (error instanceof Error) {
        error.message = "Invalid identity request";
        error.stack = undefined;
      }
      return invalid();
    })
    .get("/status", async ({ request }) => {
      try {
        return Response.json(await access.status(request.headers), {
          headers: { "cache-control": "no-store" },
        });
      } catch {
        return errorResponse(503, "IDENTITY_UNAVAILABLE", "Unable to check access. Please retry.");
      }
    })
    .get("/setup", async () => {
      try {
        return Response.json(
          { required: setupOpen ? await setupOpen() : false },
          { headers: { "cache-control": "no-store" } },
        );
      } catch {
        return errorResponse(503, "IDENTITY_UNAVAILABLE", "Unable to check setup. Please retry.");
      }
    })
    .post(
      "/setup/key",
      async ({ request, body }) => {
        const origin = request.headers.get("origin");
        if (!origin || !trustedOrigins.includes(origin))
          return errorResponse(
            403,
            "UNTRUSTED_ORIGIN",
            "Open Zetta from its trusted application and try again.",
          );
        if (
          new URL(request.url).search ||
          request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json"
        )
          return invalid();
        const parsed = setupKeyInput.safeParse(body);
        if (!parsed.success) return invalid();
        try {
          if (!setupOpen || !verifySetupKey || !(await setupOpen()))
            return errorResponse(409, "SETUP_CLOSED", "Zetta is already set up. Sign in instead.");
          if (!verifySetupKey(parsed.data.key))
            return errorResponse(
              403,
              "SETUP_KEY_MISMATCH",
              "That key does not match this server's setup key.",
            );
          return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
        } catch {
          return errorResponse(503, "IDENTITY_UNAVAILABLE", "Unable to check setup. Please retry.");
        }
      },
      { body: t.Unknown() },
    )
    .post(
      "/invitations/:operation?",
      async ({ request, body, params }) => {
        const origin = request.headers.get("origin");
        const mode = request.headers.get("sec-fetch-mode");
        const site = request.headers.get("sec-fetch-site");
        if (
          !origin ||
          !trustedOrigins.includes(origin) ||
          (mode !== null && mode !== "cors" && mode !== "same-origin") ||
          (site !== null && !["same-origin", "same-site", "cross-site", "none"].includes(site))
        ) {
          return errorResponse(
            403,
            "UNTRUSTED_ORIGIN",
            "Open Zetta from its trusted application and try again.",
          );
        }
        if (
          new URL(request.url).search ||
          request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json"
        )
          return invalid();
        const operation = params.operation;
        if (operation !== undefined && operation !== "accept" && operation !== "revoke")
          return errorResponse(404, "NOT_FOUND", "Resource not found.");
        try {
          const actor =
            operation === "accept"
              ? await access.sessionActor(request.headers)
              : await access.requireActive(request.headers);
          if (operation !== "accept" && !("isAdmin" in actor && actor.isAdmin))
            throw new AccessError("ACCESS_DENIED");
          const enrollmentActor = { userId: actor.userId };
          if (operation === "accept") {
            const parsed = acceptInput.safeParse(body);
            if (!parsed.success) return invalid();
            return Response.json(await enrollment.acceptInvitation(enrollmentActor, parsed.data), {
              headers: { "cache-control": "no-store" },
            });
          }
          if (operation === "revoke") {
            const parsed = revokeInput.safeParse(body);
            if (!parsed.success) return invalid();
            return Response.json(await enrollment.revokeInvitation(enrollmentActor, parsed.data), {
              headers: { "cache-control": "no-store" },
            });
          }
          const parsed = issueInput.safeParse(body);
          if (!parsed.success) return invalid();
          return Response.json(await enrollment.issueInvitation(enrollmentActor, parsed.data), {
            status: 201,
            headers: { "cache-control": "no-store" },
          });
        } catch (error) {
          if (error instanceof AccessError)
            return errorResponse(
              error.code === "SIGN_IN_REQUIRED"
                ? 401
                : error.code === "IDENTITY_UNAVAILABLE"
                  ? 503
                  : 403,
              error.code,
              error.message,
            );
          return errorResponse(
            409,
            "ENROLLMENT_UNAVAILABLE",
            "Enrollment is unavailable. Sign in with the intended account or ask the administrator for a new invitation.",
          );
        }
        // Parse with non-throwing strict schemas above so validation errors never enter evlog.
      },
      { body: t.Unknown() },
    );
}
