import { WIKI_PAGE_STATUSES, WIKI_PAGE_TYPES, WIKI_SCOPES } from "@zetta/db/schema/wiki";
import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import type { WikiJobs } from "./jobs";
import { WIKI_LIMITS, WikiError, type Wiki } from "./service";

export type WikiServices = {
  access: ReturnType<typeof createIdentityAccess>;
  wiki: Wiki;
  jobs?: WikiJobs;
};
const out = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) =>
  out({ error: { code, message } }, status);
const STATUS: Record<WikiError["code"], [number, string]> = {
  SECRET_REJECTED: [400, "The page looks like it holds a secret. Remove it and save again."],
  UNSAFE: [400, "The page looks like an instruction aimed at an AI."],
  CONFLICT: [409, "Someone saved this page in between. Reload it and try again."],
  NOT_FOUND: [404, "No such page, version or suggestion."],
  AMBIGUOUS: [400, "The text is in the page more than once."],
  FULL: [400, `The wiki holds ${WIKI_LIMITS.pages} pages. Archive some first.`],
  INVALID: [400, "A page needs a title and a body, inside the size limits."],
  SLUG_TAKEN: [
    409,
    "Another member already shares a page with this name. Rename yours to share it.",
  ],
};
const text = {
  title: z.string().trim().min(1).max(WIKI_LIMITS.title),
  type: z.enum(WIKI_PAGE_TYPES),
  summary: z.string().trim().max(WIKI_LIMITS.summary).default(""),
  body: z.string().trim().min(1).max(WIKI_LIMITS.body),
};
/** `expectedVersion` is the version the editor started from; 0 for a new page. */
const page = z.strictObject({ ...text, expectedVersion: z.number().int().min(0) });
const suggestion = z.strictObject({ ...text, reason: z.string().trim().max(500).default("") });
const change = z.union([
  z.strictObject({ status: z.enum(WIKI_PAGE_STATUSES) }),
  z.strictObject({ scope: z.enum(WIKI_SCOPES) }),
]);
const slug = z.string().trim().min(1).max(WIKI_LIMITS.slug);
const uuid = z.string().uuid();
const user = { by: "user" } as const;

/** Typed as a bare Elysia on purpose: app.ts chains every module and TypeScript gives up on the combined route type past this size. */
export function createWikiRoutes(
  { access, wiki, jobs }: WikiServices,
  trustedOrigins: readonly string[],
): Elysia<"/api"> {
  const g =
    (
      work: (c: {
        owner: string;
        params: Record<string, string>;
        query: Record<string, string | undefined>;
        body: unknown;
      }) => Promise<unknown>,
    ) =>
    async ({
      request,
      params,
      query,
      body,
    }: {
      request: Request;
      params: Record<string, string>;
      query: Record<string, string | undefined>;
      body: unknown;
    }) => {
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
        return out(
          await work({
            owner: (await access.requireActive(request.headers)).userId,
            params,
            query,
            body,
          }),
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
        if (e instanceof WikiError) return fail(STATUS[e.code][0], e.code, STATUS[e.code][1]);
        if (e instanceof z.ZodError)
          return fail(400, "INVALID_REQUEST", "Check the details and try again.");
        return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
      }
    };
  const routes = new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/wiki",
      g(async (c) =>
        c.query.q?.trim()
          ? { pages: await wiki.search(c.owner, c.query.q, 50) }
          : { pages: await wiki.list(c.owner), shared: await wiki.listShared(c.owner) },
      ),
    )
    .get(
      "/wiki/:slug",
      g(async (c) => {
        const r = await wiki.read(c.owner, slug.parse(c.params.slug));
        if (!r) throw new WikiError("NOT_FOUND");
        const { embedding: _, ...p } = r.page;
        if (r.access === "shared")
          return { access: r.access, ownerName: r.ownerName, page: p, linkedFrom: r.linkedFrom };
        return {
          access: r.access,
          page: p,
          linkedFrom: r.linkedFrom,
          history: await wiki.history(c.owner, p.slug),
          sources: await wiki.sources(c.owner, p.slug),
        };
      }),
    )
    .put(
      "/wiki/:slug",
      g(async (c) => {
        const v = page.parse(c.body);
        const r = await wiki.write(c.owner, { slug: slug.parse(c.params.slug), ...v }, user);
        return { slug: r.page.slug, version: r.page.version, created: r.created };
      }),
    )
    .patch(
      "/wiki/:slug",
      g(async (c) => {
        const v = change.parse(c.body);
        const key = slug.parse(c.params.slug);
        if ("scope" in v) {
          const p = await wiki.setScope(c.owner, key, v.scope);
          return { slug: p.slug, version: p.version, scope: p.scope };
        }
        const r = await wiki.setStatus(c.owner, key, v.status, user);
        return { slug: r.page.slug, version: r.page.version, status: r.page.status };
      }),
    )
    .post(
      "/wiki/:slug/restore",
      g(async (c) => {
        const v = z.strictObject({ version: z.number().int().min(1) }).parse(c.body);
        const r = await wiki.restore(c.owner, slug.parse(c.params.slug), v.version, user);
        return { slug: r.page.slug, version: r.page.version };
      }),
    )
    .post(
      "/wiki/:slug/suggestions",
      g(async (c) => {
        const v = suggestion.parse(c.body);
        const r = await wiki.suggest(c.owner, slug.parse(c.params.slug), v, user);
        return { id: r.suggestion.id, status: r.suggestion.status };
      }),
    )
    .get(
      "/wiki-suggestions",
      g(async (c) => wiki.suggestions(c.owner)),
    )
    .post(
      "/wiki-suggestions/:id/decision",
      g(async (c) => {
        const v = z.strictObject({ decision: z.enum(["accept", "reject"]) }).parse(c.body);
        return wiki.decide(c.owner, uuid.parse(c.params.id), v.decision);
      }),
    )
    .delete(
      "/wiki-suggestions/:id",
      g(async (c) => {
        await wiki.withdraw(c.owner, uuid.parse(c.params.id));
        return { status: "withdrawn" };
      }),
    )
    .get(
      "/wiki-checks",
      g(async (c) => ({
        checks: await wiki.checks(c.owner),
        jobs: jobs ? await jobs.recent(c.owner) : [],
      })),
    )
    .post(
      "/wiki-review",
      g(async (c) => {
        if (!jobs) throw new WikiError("NOT_FOUND");
        const j = await jobs.requestReview(c.owner);
        return { id: j.id, status: j.status };
      }),
    );
  return routes as never;
}
