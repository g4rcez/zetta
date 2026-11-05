import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { SEARCH_KINDS, type SearchService } from "./service";
import { accessFail, fail, out } from "../http-response";

export type SearchServices = {
  access: ReturnType<typeof createIdentityAccess>;
  search: SearchService;
};
const query = z.object({
  q: z.string().max(200),
  kinds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((k) => (k === "wiki" ? "memory" : k)) : undefined)) // `wiki` is the old name of `memory`
    .pipe(z.array(z.enum(SEARCH_KINDS)).max(SEARCH_KINDS.length).optional()),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** Typed as a bare Elysia on purpose: app.ts chains every module and TypeScript gives up on the combined route type past this size. */
export function createSearchRoutes({ access, search }: SearchServices): Elysia<"/api"> {
  const routes = new Elysia({ prefix: "/api", normalize: false }).get(
    "/search",
    async ({ request }) => {
      try {
        const actor = await access.requireActive(request.headers);
        const p = query.parse(Object.fromEntries(new URL(request.url).searchParams));
        return out({ hits: await search.search(actor, p.q, { kinds: p.kinds, limit: p.limit }) });
      } catch (e) {
        if (e instanceof AccessError) return accessFail(e);
        if (e instanceof z.ZodError)
          return fail(400, "INVALID_REQUEST", "Check the details and try again.");
        return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
      }
    },
  );
  return routes as never;
}
