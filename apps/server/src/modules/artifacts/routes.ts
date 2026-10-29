import { Elysia } from "elysia";
import { z } from "zod";
import { ARTIFACT_KINDS } from "@zetta/db/schema/artifacts";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { ARTIFACT_SORTS, type ArtifactStore } from "./store";

export type ArtifactServices = {
  access: ReturnType<typeof createIdentityAccess>;
  artifacts: ArtifactStore;
};
const query = z.object({
  botId: z.string().uuid().optional(),
  kind: z.enum(ARTIFACT_KINDS).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(ARTIFACT_SORTS).optional(),
});
const pin = z.strictObject({ pinned: z.boolean() });
const out = (body: unknown, code = 200) =>
  Response.json(body, { status: code, headers: { "cache-control": "no-store" } });
const fail = (code: number, error: string, message: string) =>
  out({ error: { code: error, message } }, code);

/** Untrusted bytes: HTML may run scripts but only in an opaque origin (no cookies, no API); everything else runs nothing. */
const SECURITY: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};
const HTML_SECURITY = {
  ...SECURITY,
  "content-security-policy": "sandbox allow-scripts allow-popups allow-forms",
};
// Chrome's PDF viewer does not start inside a sandboxed document.
const PDF_SECURITY = {
  ...SECURITY,
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
};

/** Parses a single `bytes=a-b` range. Returns undefined for no/unsupported range and null when it cannot be satisfied. */
function byteRange(header: string | null, size: number) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return undefined;
  let start = m[1] === "" ? Math.max(size - Number(m[2]), 0) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return null;
  start = Math.max(start, 0);
  return { start, end };
}

export function createArtifactRoutes(
  { access, artifacts }: ArtifactServices,
  trustedOrigins: readonly string[],
) {
  const guard = async (request: Request) => {
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (!origin || !trustedOrigins.includes(origin))
        throw Object.assign(new Error("UNTRUSTED_ORIGIN"), { untrusted: true });
    }
    return access.requireActive(request.headers);
  };
  const mapError = (e: unknown) => {
    if ((e as { untrusted?: boolean }).untrusted)
      return fail(
        403,
        "UNTRUSTED_ORIGIN",
        "Open Zetta from its trusted application and try again.",
      );
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
  };
  const id = (params: Record<string, string>) => z.string().uuid().parse(params.id);
  const run =
    (
      work: (
        c: { request: Request; params: Record<string, string> },
        actor: Awaited<ReturnType<typeof guard>>,
      ) => Promise<unknown>,
    ) =>
    async (c: { request: Request; params: Record<string, string> }) => {
      try {
        return out(await work(c, await guard(c.request)));
      } catch (e) {
        return mapError(e);
      }
    };
  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/artifacts",
      run(async ({ request }, actor) => {
        const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
        return { artifacts: await artifacts.list(actor, q) };
      }),
    )
    .get(
      "/artifacts/usage",
      run(async (_c, actor) => artifacts.usage(actor)),
    )
    .get(
      "/artifacts/:id",
      run(async ({ params }, actor) => ({ artifact: await artifacts.get(actor, id(params)) })),
    )
    .patch("/artifacts/:id", async (c) => {
      try {
        const actor = await guard(c.request);
        const body = pin.parse(await c.request.json().catch(() => undefined));
        return out({ artifact: await artifacts.setPinned(actor, id(c.params), body.pinned) });
      } catch (e) {
        return mapError(e);
      }
    })
    .delete(
      "/artifacts/:id",
      run(async ({ params }, actor) => ({ artifact: await artifacts.remove(actor, id(params)) })),
    )
    .get("/artifacts/:id/content", async ({ request, params }) => {
      try {
        const actor = await guard(request);
        const { row, path } = await artifacts.file(actor, id(params));
        const file = Bun.file(path);
        if (!(await file.exists())) return fail(404, "NOT_FOUND", "That file is not available.");
        const download = new URL(request.url).searchParams.get("download") === "1";
        const inline =
          row.kind === "html" ||
          row.kind === "pdf" ||
          row.kind === "image" ||
          row.kind === "video" ||
          row.kind === "audio";
        const headers: Record<string, string> = {
          ...(row.kind === "html" ? HTML_SECURITY : row.kind === "pdf" ? PDF_SECURITY : SECURITY),
          "content-type": row.kind === "binary" ? "application/octet-stream" : row.mimeType,
          "content-disposition": `${download || !inline ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
          "cache-control": "private, max-age=31536000, immutable",
          "accept-ranges": "bytes",
        };
        const range = byteRange(request.headers.get("range"), file.size);
        if (range === null)
          return new Response(null, {
            status: 416,
            headers: { ...headers, "content-range": `bytes */${file.size}` },
          });
        if (!range) return new Response(file, { headers });
        return new Response(file.slice(range.start, range.end + 1), {
          status: 206,
          headers: {
            ...headers,
            "content-range": `bytes ${range.start}-${range.end}/${file.size}`,
            "content-length": String(range.end - range.start + 1),
          },
        });
      } catch (e) {
        return mapError(e);
      }
    });
}
