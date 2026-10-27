import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { TASK_STATUSES, type TaskStore } from "./store";

export type TaskServices = { access: ReturnType<typeof createIdentityAccess>; tasks: TaskStore };
const status = z.enum(TASK_STATUSES);
const create = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  status: status.optional(),
});
const patch = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  status: status.optional(),
});
const out = (body: unknown, code = 200) =>
  Response.json(body, { status: code, headers: { "cache-control": "no-store" } });
const fail = (code: number, error: string, message: string) =>
  out({ error: { code: error, message } }, code);

export function createTaskRoutes(
  { access, tasks }: TaskServices,
  trustedOrigins: readonly string[],
) {
  type Ctx = {
    actor: Awaited<ReturnType<typeof access.requireActive>>;
    body: unknown;
    params: Record<string, string>;
  };
  const g =
    (work: (c: Ctx) => Promise<unknown>, code = 200) =>
    async ({
      request,
      body,
      params,
    }: {
      request: Request;
      body: unknown;
      params: Record<string, string>;
    }) => {
      try {
        if (request.method !== "GET") {
          const origin = request.headers.get("origin");
          if (!origin || !trustedOrigins.includes(origin))
            return fail(
              403,
              "UNTRUSTED_ORIGIN",
              "Open Zetta from its trusted application and try again.",
            );
        }
        return out(
          await work({ actor: await access.requireActive(request.headers), body, params }),
          code,
        );
      } catch (e) {
        if (e instanceof AccessError)
          return fail(
            e.code === "SIGN_IN_REQUIRED"
              ? 401
              : e.code === "NOT_FOUND"
                ? 404
                : e.code === "IDENTITY_UNAVAILABLE"
                  ? 503
                  : 403,
            e.code,
            e.message,
          );
        if (e instanceof z.ZodError)
          return fail(400, "INVALID_REQUEST", "Check the details and try again.");
        return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
      }
    };
  const id = (c: Ctx) => z.string().uuid().parse(c.params.id);
  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/tasks",
      g(async (c) => ({ tasks: await tasks.list(c.actor) })),
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
