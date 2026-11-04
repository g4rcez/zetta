import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskStore } from "./store";
import { accessFail, createGuardedRoute, fail } from "../http-response";

export type TaskServices = { access: ReturnType<typeof createIdentityAccess>; tasks: TaskStore };
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
});
const patch = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  status: status.optional(),
  priority: priority.optional(),
  labels: labels.optional(),
});

export function createTaskRoutes(
  { access, tasks }: TaskServices,
  trustedOrigins: readonly string[],
) {
  type Ctx = {
    actor: Awaited<ReturnType<typeof access.requireActive>>;
    body: unknown;
    params: Record<string, string>;
  };
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
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
    .delete(
      "/tasks/:id",
      g(async (c) => ({ task: await tasks.remove(c.actor, id(c)) })),
    );
}
