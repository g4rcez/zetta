import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { resolveWebFile, webStaticRoutes } from "./routes";

let dir = "";
const app = () =>
  new Elysia()
    .get("/api/meta", () => ({ name: "zetta" }))
    // A route for every method, like the sign-in API: the page must not take its GET requests.
    .all("/api/auth/*", () => ({ handled: "auth" }))
    .use(webStaticRoutes(dir) as unknown as Elysia);
const get = (path: string) => app().handle(new Request(`http://127.0.0.1:1${path}`));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "zetta-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>zetta</title>");
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(dir, "secret.txt"), "not served from outside");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("web static", () => {
  test("serves the page at / and for a client-side route", async () => {
    for (const path of ["/", "/chat/rooms/42", "/login"]) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<title>zetta</title>");
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
  });

  test("hashed assets are cached for a year, other files are revalidated", async () => {
    const asset = await get("/assets/app-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await get("/secret.txt")).headers.get("cache-control")).toBe("no-cache");
  });

  test("a missing file with an extension and a wrong API path are 404, never the page", async () => {
    expect((await get("/assets/missing.js")).status).toBe(404);
    expect((await get("/api/nope")).status).toBe(404);
    expect((await get("/api")).status).toBe(404);
  });

  test("real API routes still win", async () => {
    expect(await (await get("/api/meta")).json()).toEqual({ name: "zetta" });
  });

  test("a route registered for all methods keeps its GET requests (the sign-in API)", async () => {
    expect(await (await get("/api/auth/jwks")).json()).toEqual({ handled: "auth" });
    expect(await (await get("/api/auth/oauth2/authorize?client_id=x")).json()).toEqual({
      handled: "auth",
    });
  });

  test("a path cannot leave the folder", () => {
    // A leading `..` is collapsed against the folder's own root, so what comes back is inside the folder (or null); never outside it.
    for (const attack of [
      "/../etc/passwd",
      "/%2e%2e/etc/passwd",
      "/assets/../../etc/passwd",
      "/..%2f..%2fetc/passwd",
    ]) {
      const target = resolveWebFile(dir, attack);
      expect(target === null || target.startsWith(`${dir}/`)).toBe(true);
    }
    expect(resolveWebFile(dir, "/a%00b")).toBeNull();
    expect(resolveWebFile(dir, "/%E0%A4%A")).toBeNull();
    expect(resolveWebFile(dir, "/assets/app-abc123.js")).toBe(join(dir, "assets", "app-abc123.js"));
  });

  test("a folder with no index.html is refused at start", () => {
    const empty = mkdtempSync(join(tmpdir(), "zetta-web-empty-"));
    try {
      expect(() => webStaticRoutes(empty)).toThrow("index.html");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
