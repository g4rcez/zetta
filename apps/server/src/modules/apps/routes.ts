import { Elysia } from "elysia";
import { z } from "zod";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { APP_ERRORS, AppError, type Apps } from "./service";

export type AppsServices = {
  access: ReturnType<typeof createIdentityAccess>;
  apps: Apps;
};
const uuid = z.string().uuid();
const ref = z.string().min(1).max(64);
const publishBody = z.strictObject({
  playgroundId: uuid,
  slug: z.string().max(40).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  note: z.string().max(500).optional(),
});
const patchBody = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  visibility: z.enum(["private", "team"]).optional(),
});
const callBody = z.strictObject({
  tool: z.string().min(1).max(200),
  input: z.record(z.string(), z.unknown()).optional(),
});

/** The Apps API (see docs/decisions/apps.md). Typed as a bare Elysia on purpose: app.ts chains every module and TypeScript gives up on the combined route type. */
export function createAppsRoutes(
  { access, apps }: AppsServices,
  trustedOrigins: readonly string[],
): Elysia<"/api"> {
  const mapError = (e: unknown) => {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof AppError)
      return fail(APP_ERRORS[e.code][0], e.code, e.detail ?? APP_ERRORS[e.code][1]);
    if (e instanceof z.ZodError)
      return fail(
        400,
        "INVALID_REQUEST",
        e.issues[0]?.message ?? "Check the details and try again.",
      );
    console.error(`apps: unhandled error name=${(e as Error | undefined)?.name ?? typeof e}`);
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  };
  const g = createGuardedRoute({ access, trustedOrigins, mapError });

  const routes = new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/apps",
      g(async ({ actor }) => ({ apps: await apps.list(actor) })),
    )
    .get(
      "/apps/tools",
      g(async ({ actor, query }) => ({
        tools: await apps.search(
          actor,
          z.string().max(200).optional().parse(query.q) ?? "",
          query.app ? [(await apps.get(actor, ref.parse(query.app))).id] : undefined,
        ),
      })),
    )
    .post(
      "/apps/publish",
      g(
        async ({ actor, body }) => ({
          published: await apps.publish(actor, publishBody.parse(body)),
        }),
        201,
      ),
    )
    .post(
      "/app-calls/:id/answer",
      g(async ({ actor, params, body }) => ({
        result: await apps.answer(
          actor,
          uuid.parse(params.id),
          z.strictObject({ action: z.enum(["accept", "decline", "cancel"]) }).parse(body).action,
        ),
      })),
    )
    .get(
      "/apps/:ref",
      g(async ({ actor, params }) => ({ app: await apps.get(actor, ref.parse(params.ref)) })),
    )
    .patch(
      "/apps/:ref",
      g(async ({ actor, params, body }) => ({
        app: await apps.update(actor, ref.parse(params.ref), patchBody.parse(body)),
      })),
    )
    .delete(
      "/apps/:ref",
      g(async ({ actor, params }) => {
        await apps.archive(actor, ref.parse(params.ref));
        return { archived: true };
      }),
    )
    .post(
      "/apps/:ref/rollback",
      g(async ({ actor, params, body }) => ({
        app: await apps.rollback(
          actor,
          ref.parse(params.ref),
          z.strictObject({ n: z.number().int().positive() }).parse(body).n,
        ),
      })),
    )
    .put(
      "/apps/:ref/tools/:tool/policy",
      g(async ({ actor, params, body }) => ({
        app: await apps.setToolPolicy(
          actor,
          ref.parse(params.ref),
          z.string().min(1).max(200).parse(params.tool),
          z.strictObject({ policy: z.enum(["ask", "auto", "block"]).nullable() }).parse(body)
            .policy,
        ),
      })),
    )
    .post(
      "/apps/:ref/call",
      g(async ({ actor, params, body }) => {
        const b = callBody.parse(body);
        return {
          result: await apps.call(actor, {
            app: ref.parse(params.ref),
            tool: b.tool,
            input: b.input ?? {},
            source: "ui",
          }),
        };
      }),
    )
    .get(
      "/apps/:ref/ui",
      g(async ({ actor, params }) => ({ page: await apps.page(actor, ref.parse(params.ref)) })),
    )
    .get(
      "/apps/:ref/data",
      g(async ({ actor, params }) => ({ data: await apps.data(actor, ref.parse(params.ref)) })),
    )
    .delete(
      "/apps/:ref/data",
      g(async ({ actor, params, query }) =>
        apps.clearData(
          actor,
          ref.parse(params.ref),
          z.enum(["mine", "all"]).parse(query.scope ?? "mine"),
        ),
      ),
    )
    .get(
      "/apps/:ref/calls",
      g(async ({ actor, params }) => ({ calls: await apps.calls(actor, ref.parse(params.ref)) })),
    )
    .get(
      "/apps/:ref/bots",
      g(async ({ actor, params }) => ({
        botIds: await apps.appBots(actor, ref.parse(params.ref)),
      })),
    )
    .put(
      "/apps/:ref/bots",
      g(async ({ actor, params, body }) => ({
        botIds: await apps.setAppBots(
          actor,
          ref.parse(params.ref),
          z.strictObject({ botIds: z.array(uuid).max(25) }).parse(body).botIds,
        ),
      })),
    )
    .get(
      "/bots/:id/apps",
      g(async ({ actor, params }) => ({
        appIds: await apps.botApps(actor, uuid.parse(params.id)),
      })),
    )
    .put(
      "/bots/:id/apps",
      g(async ({ actor, params, body }) => ({
        appIds: await apps.setBotApps(
          actor,
          uuid.parse(params.id),
          z.strictObject({ appIds: z.array(uuid).max(25) }).parse(body).appIds,
        ),
      })),
    );
  // Typed as a bare Elysia on purpose, like the playground routes: the full route type is too large for app.ts to chain.
  return routes as unknown as Elysia<"/api">;
}
