import { cors } from "@elysiajs/cors";
import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

import { responseEncoding } from "./response-encoding";
import { createAppFixture, fixtureOrigins } from "./test-support/fixtures";

const big = { rows: Array.from({ length: 80 }, (_, i) => ({ id: i, title: `Row number ${i}` })) };
const json = (body: unknown) => Response.json(body, { headers: { "cache-control": "no-store" } });
// Same shape as createApp: the global hook that copies a returned Response's status, then CORS, then the plugin under test.
const bare = () =>
  new Elysia()
    .mapResponse({ as: "global" }, ({ response, set }) => {
      if (response instanceof Response) set.status = response.status;
    })
    .use(cors({ origin: ["https://app.example.invalid"], credentials: true }))
    .use(responseEncoding())
    .get("/api/bots", () => json(big))
    .get("/api/connections", () => json(big))
    .get("/api/small", () => json({ ok: true }))
    .get(
      "/api/stream",
      () => new Response("data: x\n\n", { headers: { "content-type": "text/event-stream" } }),
    )
    .post("/api/bots", () => json(big));
const get = (app: ReturnType<typeof bare>, path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));

describe("responseEncoding", () => {
  test("gzips a large JSON read and keeps the CORS headers", async () => {
    const res = await get(bare(), "/api/connections", {
      "accept-encoding": "gzip, br",
      origin: "https://app.example.invalid",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.invalid");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("etag")).toBeNull();
    expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await res.arrayBuffer())))).toEqual(
      big,
    );
  });

  test("sends plain JSON without Accept-Encoding, for a small body, and for a stream", async () => {
    const app = bare();
    const plain = await get(app, "/api/connections");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.json()).toEqual(big);
    const small = await get(app, "/api/small", { "accept-encoding": "gzip" });
    expect(small.headers.get("content-encoding")).toBeNull();
    expect(await small.json()).toEqual({ ok: true });
    const stream = await get(app, "/api/stream", { "accept-encoding": "gzip" });
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    expect(await stream.text()).toBe("data: x\n\n");
  });

  test("a polled list carries an ETag and answers 304 to the same ETag", async () => {
    const app = bare();
    const first = await get(app, "/api/bots", { "accept-encoding": "gzip" });
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^W\/"/);
    expect(first.headers.get("cache-control")).toBe("private, no-cache");
    const again = await get(app, "/api/bots", {
      "if-none-match": etag,
      origin: "https://app.example.invalid",
    });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("access-control-allow-origin")).toBe("https://app.example.invalid");
    const other = await get(app, "/api/bots", { "if-none-match": 'W/"old"' });
    expect(other.status).toBe(200);
  });

  test("a list outside the allow-list never gets an ETag, and writes are untouched", async () => {
    const app = bare();
    const list = await get(app, "/api/connections", { "if-none-match": "*" });
    expect(list.status).toBe(200);
    const write = await app.handle(new Request("http://localhost/api/bots", { method: "POST" }));
    expect(write.headers.get("etag")).toBeNull();
    expect(write.headers.get("cache-control")).toBe("no-store");
  });

  test("the whole app compresses a large auth answer", async () => {
    const fixture = createAppFixture(() => json(big));
    const res = await fixture.app.handle(
      new Request("http://localhost/api/auth/session", {
        headers: { "accept-encoding": "gzip", origin: fixtureOrigins.webOrigin },
      }),
    );
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("access-control-allow-origin")).toBe(fixtureOrigins.webOrigin);
    expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await res.arrayBuffer())))).toEqual(
      big,
    );
  });
});
