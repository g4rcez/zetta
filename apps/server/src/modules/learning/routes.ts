import { Elysia } from "elysia";

// The app imports route modules by the name `routes` only (see app.test.ts): the lesson routes live in their own file and come out here.
export { createLessonRoutes, type LessonServices } from "./lesson-routes";
import { z } from "zod";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { bulkItems, LearningError, usefulnessQuery, type Usefulness } from "./usefulness";

export type LearningServices = {
  access: ReturnType<typeof createIdentityAccess>;
  usefulness: Usefulness;
};

/** Which memory items and skills are worth keeping, and bulk archive and restore of the ones that are not (docs/decisions/lessons.md). */
export function createLearningRoutes(
  { access, usefulness }: LearningServices,
  trustedOrigins: readonly string[],
) {
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof LearningError) return fail(e.code === "NOT_FOUND" ? 404 : 400, e.code, e.safe);
    if (e instanceof z.ZodError)
      return fail(
        400,
        "INVALID_REQUEST",
        e.issues[0]?.message ?? "Check the details and try again.",
      );
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/learning/usefulness",
      g(async (c) => usefulness.list(c.actor, usefulnessQuery.parse(c.query))),
    )
    .post(
      "/learning/archive",
      g(async (c) => usefulness.archive(c.actor, bulkItems.parse(c.body))),
    )
    .post(
      "/learning/restore",
      g(async (c) => usefulness.restore(c.actor, bulkItems.parse(c.body))),
    );
}
