import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { AgentsPausedError } from "../preferences/agents-state";
import { WorkError, type WorkActions } from "../work/actions";
import { TaskRuleError } from "./follow-up";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskStore } from "./store";
import { accessFail, createGuardedRoute, fail } from "../http-response";

export type TaskServices = {
  access: ReturnType<typeof createIdentityAccess>;
  tasks: TaskStore;
  /** "Tell them…": the owner writes to whoever does a task (modules/work). Absent in tests of the board alone. */
  work?: Pick<WorkActions, "tellAbout">;
};
const status = z.enum(TASK_STATUSES);
const priority = z.enum(TASK_PRIORITIES);
/** Labels are free text: lowercase, trimmed, no repeats. */
const labels = z
  .array(z.string().trim().min(1).max(32))
  .max(10)
  .transform((all) => [...new Set(all.map((l) => l.toLowerCase()))]);
const create = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  status: status.optional(),
  priority: priority.optional(),
  labels: labels.optional(),
  /** Makes it a subtask of this task (one level). */
  parentTaskId: z.string().uuid().optional(),
  /** Files it under this project of the owner. Without it the task joins no project. */
  projectId: z.string().uuid().nullable().optional(),
});
const tell = z.strictObject({ text: z.string().trim().min(1).max(4000) });
const patch = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  status: status.optional(),
  priority: priority.optional(),
  labels: labels.optional(),
  /** "auto" resumes a paused follow-up, "off" stops it. The server sets "paused" itself. */
  followUp: z.enum(["auto", "off"]).optional(),
  /** Where the task stands in the worker's words. The person a task is assigned to sends it with Blocked: what is in the way. */
  progress: z.string().trim().max(2000).optional(),
  /** Moves the task (and its steps) to this project; null takes it out of its project. */
  projectId: z.string().uuid().nullable().optional(),
});

export function createTaskRoutes(
  { access, tasks, work }: TaskServices,
  trustedOrigins: readonly string[],
) {
  type Ctx = {
    actor: Awaited<ReturnType<typeof access.requireActive>>;
    body: unknown;
    params: Record<string, string>;
  };
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof TaskRuleError) return fail(409, e.code, e.message);
    if (e instanceof WorkError)
      return fail(e.code === "INPUT_REQUIRED" ? 400 : 409, e.code, e.message);
    if (e instanceof AgentsPausedError)
      return fail(409, "AGENTS_PAUSED", "Your agents are paused. Resume them first.");
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  const id = (c: Ctx) => z.string().uuid().parse(c.params.id);
  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/tasks",
      g(async (c) => ({ tasks: await tasks.list(c.actor) })),
    )
    .get(
      "/tasks/:id",
      g(async (c) => ({ task: await tasks.get(c.actor, id(c)) })),
    )
    .post(
      "/tasks",
      g(async (c) => ({ task: await tasks.create(c.actor, create.parse(c.body)) }), 201),
    )
    .patch(
      "/tasks/:id",
      g(async (c) => ({ task: await tasks.update(c.actor, id(c), patch.parse(c.body)) })),
    )
    .post(
      "/tasks/:id/tell",
      g(async (c) => {
        const { text } = tell.parse(c.body);
        if (!work) throw new AccessError("NOT_FOUND");
        return work.tellAbout(c.actor, id(c), text);
      }),
    )
    .delete(
      "/tasks/:id",
      g(async (c) => ({ task: await tasks.remove(c.actor, id(c)) })),
    );
}
