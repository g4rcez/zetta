import { Elysia } from "elysia";
import { z } from "zod";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { RunError, type Batch } from "./batch";
import { findingAccept, findingsQuery, type Findings } from "./findings";
import type { Progress } from "./progress";
import type { LessonWorkflow } from "./workflow-template";
import { LessonError, lessonEdit, lessonsQuery, policyInput, type Lessons } from "./lessons";

export type LessonServices = {
  access: ReturnType<typeof createIdentityAccess>;
  lessons: Lessons;
  batch: Batch;
  findings: Findings;
  progress: Progress;
  workflow: LessonWorkflow;
};

const uuid = z.string().uuid();
const LESSON_STATUS = { NOT_FOUND: 404, INVALID: 400, CONFLICT: 409 } as const;
const RUN_STATUS = {
  NOT_FOUND: 404,
  OFF: 409,
  COOLDOWN: 429,
  NOTHING_NEW: 409,
  NO_ENGINE: 409,
  BUSY: 409,
} as const;

/**
 * What a bot learned and how it is going: the lessons of a person's bots with their evidence and results, the person's say over each
 * (accept, turn down, keep, drop, bring back, edit), "Run now", and what the learning jobs may do (docs/decisions/lessons.md).
 */
export function createLessonRoutes(
  { access, lessons, batch, findings, progress, workflow }: LessonServices,
  trustedOrigins: readonly string[],
) {
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof LessonError) return fail(LESSON_STATUS[e.code], e.code, e.safe);
    if (e instanceof RunError) return fail(RUN_STATUS[e.code], e.code, e.safe);
    if (e instanceof z.ZodError)
      return fail(
        400,
        "INVALID_REQUEST",
        e.issues[0]?.message ?? "Check the details and try again.",
      );
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  const id = (c: { params: Record<string, string> }) => uuid.parse(c.params.id);
  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/lessons",
      g(async (c) => ({
        lessons: await lessons.list(c.actor.userId, lessonsQuery.parse(c.query)),
      })),
    )
    .post(
      "/lessons/:id/accept",
      g(async (c) => ({ lesson: await lessons.accept(c.actor.userId, id(c)) })),
    )
    .post(
      "/lessons/:id/reject",
      g(async (c) => ({ lesson: await lessons.reject(c.actor.userId, id(c), "person") })),
    )
    .post(
      "/lessons/:id/keep",
      g(async (c) => ({ lesson: await lessons.keep(c.actor.userId, id(c), "person") })),
    )
    .post(
      "/lessons/:id/drop",
      g(async (c) => ({ lesson: await lessons.drop(c.actor.userId, id(c), "person", "person") })),
    )
    .post(
      "/lessons/:id/restore",
      g(async (c) => ({ lesson: await lessons.restore(c.actor.userId, id(c)) })),
    )
    .patch(
      "/lessons/:id",
      g(async (c) => ({
        lesson: await lessons.edit(c.actor.userId, id(c), lessonEdit.parse(c.body)),
      })),
    )
    .get(
      "/bots/:id/learning",
      g(async (c) => batch.overview(c.actor.userId, id(c))),
    )
    .get(
      "/bots/:id/learning/progress",
      g(async (c) => progress.weekly(c.actor.userId, id(c))),
    )
    .post(
      "/bots/:id/learning/run",
      g(async (c) => ({ run: (await batch.runNow(c.actor.userId, id(c))).run }), 202),
    )
    .get(
      "/learning/findings",
      g(async (c) => ({
        findings: await findings.list(c.actor.userId, findingsQuery.parse(c.query)),
      })),
    )
    .post(
      "/learning/findings/:id/accept",
      g(async (c) => findings.accept(c.actor.userId, id(c), findingAccept.parse(c.body ?? {}))),
    )
    .post(
      "/learning/findings/:id/dismiss",
      g(async (c) => findings.dismiss(c.actor.userId, id(c))),
    )
    .post(
      "/learning/workflow-template",
      g(async (c) => workflow.ensure(c.actor), 201),
    )
    .get(
      "/learning/policy",
      g(async (c) => ({ policy: await lessons.policy(c.actor.userId) })),
    )
    .put(
      "/learning/policy",
      g(async (c) => ({
        policy: await lessons.setPolicy(c.actor.userId, policyInput.parse(c.body)),
      })),
    );
}
