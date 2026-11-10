import { describe, expect, test } from "bun:test";
import { parseServerMeta } from "@zetta/core/server-meta";

import { metaRoutes } from "./routes";

describe("GET /api/meta", () => {
  const app = metaRoutes("https://zetta.example.invalid", "https://api.example.invalid");

  test("answers the two origins without a session", async () => {
    const res = await app.handle(new Request("http://localhost/api/meta"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(parseServerMeta(await res.json())).toEqual({
      name: "zetta",
      protocol: 1,
      webOrigin: "https://zetta.example.invalid",
      apiOrigin: "https://api.example.invalid",
    });
  });

  test("shows nothing else", async () => {
    const body = (await (
      await app.handle(new Request("http://localhost/api/meta"))
    ).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["apiOrigin", "name", "protocol", "webOrigin"]);
  });
});
