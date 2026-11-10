import { UNTRUSTED_BYTES_HEADERS, UNTRUSTED_HTML_HEADERS } from "@zetta/core/artifact-csp";
import { Elysia } from "elysia";
import { z } from "zod";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { PlaygroundError, playgroundFields, playgroundPatch, type Playground } from "./service";
import { PLAYGROUND_ERRORS } from "./types";

export type PlaygroundServices = {
  access: ReturnType<typeof createIdentityAccess>;
  playground: Playground;
};
const uuid = z.string().uuid();
const patch = playgroundPatch.extend({ expectedVersion: z.number().int().positive() });
const buildBody = z.strictObject({
  files: playgroundFields.shape.files.optional(),
  entry: playgroundFields.shape.entry,
  inputs: z.record(z.string(), z.unknown()).optional(),
});
const runBody = z.strictObject({
  inputs: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.number().int().min(1000).optional(),
});

/** What the browser may show inline from `out/`. Anything else downloads. The type is ours, never the script's word. */
const INLINE =
  /^(image\/(png|jpeg|gif|webp|avif|svg\+xml)|text\/(html|plain|csv|markdown)|application\/json)$/;

/** The Playground API. Typed as a bare Elysia on purpose: app.ts chains every module and TypeScript gives up on the combined route type. */
export function createPlaygroundRoutes(
  { access, playground }: PlaygroundServices,
  trustedOrigins: readonly string[],
): Elysia<"/api"> {
  const mapError = (e: unknown) => {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof PlaygroundError)
      return fail(PLAYGROUND_ERRORS[e.code][0], e.code, e.detail ?? PLAYGROUND_ERRORS[e.code][1]);
    if (e instanceof z.ZodError)
      return fail(
        400,
        "INVALID_REQUEST",
        e.issues[0]?.message ?? "Check the details and try again.",
      );
    console.error(`playground: unhandled error name=${(e as Error | undefined)?.name ?? typeof e}`);
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  };
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  const id = (params: Record<string, string>) => uuid.parse(params.id);
  const runId = (params: Record<string, string>) => uuid.parse(params.runId);

  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/playgrounds/languages",
      g(async () => ({ languages: await playground.languages() })),
    )
    .get(
      "/playgrounds",
      g(async ({ actor, query }) => ({
        playgrounds: await playground.list(
          actor,
          z.enum(["mine", "team"]).parse(query.scope ?? "mine"),
          z.string().max(200).optional().parse(query.q),
        ),
      })),
    )
    .post(
      "/playgrounds",
      g(
        async ({ actor, body }) => ({
          playground: await playground.create(actor, playgroundFields.parse(body)),
        }),
        201,
      ),
    )
    .get(
      "/playgrounds/:id",
      g(async ({ actor, params }) => ({ playground: await playground.get(actor, id(params)) })),
    )
    .patch(
      "/playgrounds/:id",
      g(async ({ actor, body, params }) => {
        const { expectedVersion, ...fields } = patch.parse(body);
        return { playground: await playground.update(actor, id(params), expectedVersion, fields) };
      }),
    )
    .delete(
      "/playgrounds/:id",
      g(async ({ actor, params }) => {
        await playground.archive(actor, id(params));
        return { removed: true };
      }),
    )
    .post(
      "/playgrounds/:id/fork",
      g(
        async ({ actor, params }) => ({ playground: await playground.fork(actor, id(params)) }),
        201,
      ),
    )
    .post(
      "/playgrounds/:id/runs",
      g(async ({ actor, body, params }) => {
        const input = runBody.parse(body ?? {});
        return { run: (await playground.run(actor, id(params), input)).run };
      }, 202),
    )
    .post(
      "/playgrounds/:id/build",
      g(async ({ actor, body, params }) =>
        playground.build(actor, id(params), buildBody.parse(body ?? {})),
      ),
    )
    .get(
      "/playgrounds/:id/runs",
      g(async ({ actor, params }) => ({ runs: await playground.runs(actor, id(params)) })),
    )
    .get(
      "/playground-runs/:runId",
      g(async ({ actor, params }) => ({ run: await playground.getRun(actor, runId(params)) })),
    )
    .post(
      "/playground-runs/:runId/cancel",
      g(async ({ actor, params }) => playground.cancel(actor, runId(params))),
    )
    .get("/playground-runs/:runId/outputs/*", async ({ request, params }) => {
      try {
        const actor = await access.requireActive(request.headers);
        const path = decodeURIComponent(params["*"] ?? "");
        const file = await playground.output(actor, runId(params), path);
        const inline = INLINE.test(file.mimeType);
        const download = new URL(request.url).searchParams.get("download") === "1";
        const name = path.split("/").pop() ?? "file";
        return new Response(new Uint8Array(file.content), {
          headers: {
            ...(file.mimeType === "text/html" ? UNTRUSTED_HTML_HEADERS : UNTRUSTED_BYTES_HEADERS),
            "content-type": inline
              ? /^(text\/|application\/json)/.test(file.mimeType)
                ? `${file.mimeType}; charset=utf-8`
                : file.mimeType
              : "application/octet-stream",
            "content-disposition": `${inline && !download ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
            // A run is immutable, so its files are too.
            "cache-control": "private, max-age=31536000, immutable",
          },
        });
      } catch (e) {
        return mapError(e);
      }
    }) as unknown as Elysia<"/api">;
}
