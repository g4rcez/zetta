import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { PluginError } from "../integrations/plugins/registry";
import type { Knowledge } from "./service";

export type KnowledgeServices = {
  access: ReturnType<typeof createIdentityAccess>;
  knowledge: Knowledge;
};
const out = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) =>
  out({ error: { code, message } }, status);
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
        if (request.method !== "GET") {
          const o = request.headers.get("origin");
          if (!o || !trustedOrigins.includes(o))
            return fail(
              403,
              "UNTRUSTED_ORIGIN",
              "Open Zetta from its trusted application and try again.",
            );
        }
        return out(await work({ actor: await access.requireActive(request.headers), params }));
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
