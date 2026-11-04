import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { PluginError } from "../integrations/plugins/registry";
import type { Knowledge } from "./service";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";

export type KnowledgeServices = {
  access: ReturnType<typeof createIdentityAccess>;
  knowledge: Knowledge;
};
const uuid = z.string().uuid();

/** Typed as a bare Elysia on purpose: app.ts chains every module and TypeScript gives up on the combined route type past this size. */
export function createKnowledgeRoutes(
  { access, knowledge }: KnowledgeServices,
  trustedOrigins: readonly string[],
): Elysia<"/api"> {
  const g =
    (
      work: (c: {
        actor: Awaited<ReturnType<typeof access.requireActive>>;
        params: Record<string, string>;
      }) => Promise<unknown>,
    ) =>
    async ({ request, params }: { request: Request; params: Record<string, string> }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        return out(await work({ actor: await access.requireActive(request.headers), params }));
      } catch (e) {
        if (e instanceof AccessError) return accessFail(e);
        // The plugin's own words: they say what is missing (connect Google, tick Drive access) and never carry provider text.
        if (e instanceof PluginError)
          return fail(
            e.code === "NOT_ENABLED" ? 404 : 400,
            e.code,
            e.fix ? `${e.safe} ${e.fix}` : e.safe,
          );
        if (e instanceof z.ZodError)
          return fail(400, "INVALID_REQUEST", "Check the details and try again.");
        return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
      }
    };
  const routes = new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/knowledge",
      g(async (c) => knowledge.status(c.actor)),
    )
    .put(
      "/knowledge",
      g(async (c) => knowledge.enable(c.actor)),
    )
    .delete(
      "/knowledge",
      g(async (c) => knowledge.disable(c.actor)),
    )
    .post(
      "/knowledge/sync",
      g(async (c) => knowledge.syncUser(c.actor)),
    )
    .get(
      "/messages/:id/sources",
      g(async (c) => ({ sources: await knowledge.cited(c.actor, uuid.parse(c.params.id)) })),
    );
  return routes as never;
}
