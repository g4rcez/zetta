import { existsSync, statSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import { Elysia } from "elysia";

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** What a request path maps to inside `root`, or null when it would leave the folder. */
export function resolveWebFile(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = resolve(root);
  const target = resolve(join(base, normalize(decoded)));
  return target === base || target.startsWith(base + sep) ? target : null;
}

/**
 * Serves a built web app (`apps/web/dist`) from the server itself, so one address holds both the UI and the API: first-party cookies, no
 * CORS. Used by the desktop app's own server; the Docker install keeps its nginx.
 * It is registered for every method at `/*`, the least specific path there is, so any route that names a path (including an
 * `.all("/api/auth/*")`) wins over it; a `GET /*` would win over that one for GET requests and break the sign-in API. `/api/*` is never
 * answered with the page (a wrong API path stays a 404, not HTML). A path with no file, and no extension, gets `index.html` so the web
 * app's own router can handle it.
 */
export function webStaticRoutes(root: string) {
  const dir = resolve(root);
  const index = join(dir, "index.html");
  if (!existsSync(index)) throw new Error(`ZETTA_WEB_DIST has no index.html: ${dir}`);
  return new Elysia({ name: "web-static" }).all("/*", ({ request, set, status }) => {
    if (request.method !== "GET" && request.method !== "HEAD") return status(404);
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) return status(404);
    const target = resolveWebFile(dir, pathname);
    if (!target) return status(404);
    if (isFile(target)) {
      // Built assets carry a content hash in their name: they never change under the same address.
      set.headers["cache-control"] = pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache";
      return Bun.file(target);
    }
    if (/\.[A-Za-z0-9]+$/.test(pathname)) return status(404);
    set.headers["cache-control"] = "no-cache";
    return Bun.file(index);
  });
}
