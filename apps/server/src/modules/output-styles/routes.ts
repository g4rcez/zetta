import { OUTPUT_STYLE_SCOPES } from "@zetta/db/schema/output-styles";
import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { STYLE_LIMITS } from "./format";
import { OutputStyleError, type OutputStyles } from "./service";

export type OutputStyleServices = {
  access: ReturnType<typeof createIdentityAccess>;
  styles: OutputStyles;
};

const out = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) =>
  out({ error: { code, message } }, status);
const STATUS: Record<OutputStyleError["code"], [number, string]> = {
  NOT_FOUND: [404, "No such output style."],
  CONFLICT: [409, "This style changed. Reload and try again."],
  INVALID: [400, "The file needs a name and instructions, inside the size limits."],
  SECRET_REJECTED: [400, "The style looks like it holds a secret. Remove it and save again."],
  FULL: [409, `You reached ${STYLE_LIMITS.perOwner} styles. Delete some first.`],
};

const name = z.string().trim().min(1).max(STYLE_LIMITS.name);
const description = z.string().trim().max(STYLE_LIMITS.description);
const body = z.string().trim().min(1).max(STYLE_LIMITS.body);
const scope = z.enum(OUTPUT_STYLE_SCOPES);
const create = z.strictObject({
  name,
  description: description.default(""),
  body,
  scope: scope.optional(),
});
const update = z.strictObject({
  expectedVersion: z.number().int().positive(),
  name: name.optional(),
  description: description.optional(),
  body: body.optional(),
  scope: scope.optional(),
});
const importFile = z.strictObject({ markdown: z.string().max(STYLE_LIMITS.file) });
const uuid = z.string().uuid();

const attachment = ({ filename, markdown }: { filename: string; markdown: string }) =>
  new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

/** Typed as a bare Elysia on purpose: app.ts chains every module and TypeScript gives up on the combined route type past this size. */
export function createOutputStyleRoutes(
  { access, styles }: OutputStyleServices,
  trustedOrigins: readonly string[],
): Elysia<"/api"> {
  const g =
    (
      work: (c: {
        owner: string;
        params: Record<string, string>;
        body: unknown;
      }) => Promise<unknown>,
      status = 200,
    ) =>
    async ({
      request,
      params,
      body,
    }: {
      request: Request;
      params: Record<string, string>;
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
        const result = await work({
          owner: (await access.requireActive(request.headers)).userId,
          params,
          body,
        });
        return result instanceof Response ? result : out(result, status);
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
        if (e instanceof OutputStyleError)
          return fail(STATUS[e.code][0], e.code, STATUS[e.code][1]);
        if (e instanceof z.ZodError)
          return fail(400, "INVALID_REQUEST", "Check the details and try again.");
        return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
      }
    };
  const id = (c: { params: Record<string, string> }) => uuid.parse(c.params.id);
  const routes = new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/output-styles",
      g(({ owner }) => styles.list(owner)),
    )
    .post(
      "/output-styles",
      g(async (c) => ({ style: await styles.create(c.owner, create.parse(c.body)) }), 201),
    )
    .post(
      "/output-styles/import",
      g(
        async (c) => ({
          style: await styles.importMarkdown(c.owner, importFile.parse(c.body).markdown),
        }),
        201,
      ),
    )
    .get(
      "/output-styles/builtin/:key/export",
      g(async ({ params }) => attachment(styles.exportBuiltin(params.key ?? ""))),
    )
    .get(
      "/output-styles/:id/export",
      g(async (c) => attachment(await styles.exportStyle(c.owner, id(c)))),
    )
    .patch(
      "/output-styles/:id",
      g(async (c) => {
        const { expectedVersion, ...v } = update.parse(c.body);
        return { style: await styles.update(c.owner, id(c), expectedVersion, v) };
      }),
    )
    .delete(
      "/output-styles/:id",
      g(async (c) => styles.archive(c.owner, id(c))),
    );
  return routes as never;
}
