import { Elysia } from "elysia";

/**
 * Smaller JSON answers for the polled reads of the web app.
 * - gzip for every `/api` JSON GET of 1 KB or more, when the client accepts it.
 * - `ETag` and `If-None-Match` (answer 304) for the lists below: the browser keeps a private copy and checks it before each use.
 *   Only lists that hold no secrets are here. Every other route keeps its `no-store`.
 */
const REVALIDATE = [
  /^\/api\/conversations$/,
  /^\/api\/conversations\/[^/]+\/(messages|loops)$/,
  /^\/api\/discussions(\/[^/]+(\/steps)?)?$/,
  /^\/api\/bots(\/status)?$/,
  /^\/api\/attention(\/summary)?$/,
  /^\/api\/routines(\/unread)?$/,
  /^\/api\/teams$/,
  /^\/api\/preferences$/,
];
export const MIN_GZIP_BYTES = 1024;

const matches = (header: string | null, etag: string) =>
  header?.split(",").some((v) => v.trim() === etag) ?? false;

export const responseEncoding = () =>
  new Elysia({ name: "response-encoding" }).mapResponse({ as: "global" }, async (ctx) => {
    const { request, response, set } = ctx;
    if (!(response instanceof Response) || request.method !== "GET") return;
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/") || response.status !== 200) return;
    if (!response.headers.get("content-type")?.includes("application/json")) return;
    if (response.headers.has("content-encoding")) return;

    const body = new Uint8Array(await response.arrayBuffer());
    const headers = new Headers(response.headers);
    // A new Response replaces the handler's one, so the headers other plugins put in `set` (CORS) go in here.
    for (const [name, value] of Object.entries(set.headers))
      if (value !== undefined && !headers.has(name)) headers.set(name, String(value));
    headers.delete("content-length");
    headers.append("vary", "Accept-Encoding");

    if (REVALIDATE.some((r) => r.test(path))) {
      const etag = `W/"${Bun.hash(body).toString(36)}"`;
      headers.set("etag", etag);
      headers.set("cache-control", "private, no-cache");
      if (matches(request.headers.get("if-none-match"), etag))
        return new Response(null, { status: 304, headers });
    }
    if (
      body.length >= MIN_GZIP_BYTES &&
      /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")
    ) {
      headers.set("content-encoding", "gzip");
      return new Response(Bun.gzipSync(body), { status: 200, headers });
    }
    return new Response(body, { status: 200, headers });
  });
