import { describe, expect, test } from "bun:test";
import { buildServerMeta, buildWellKnown } from "@zetta/core/server-meta";

import { addressToOrigin, discoverServer, type FetchLike } from "./discovery";

const web = "https://zetta.example.invalid";
const api = "https://api.example.invalid";

/** A fetch that answers from a table of url → body; any other url is unreachable. */
const site =
  (table: Record<string, unknown>): FetchLike =>
  async (url) => {
    if (!(url in table)) throw new Error("ECONNREFUSED");
    return { ok: true, json: async () => table[url] };
  };

describe("addressToOrigin", () => {
  test("adds https to a bare host and http to this computer", () => {
    expect(addressToOrigin("zetta.example.invalid")).toBe(web);
    expect(addressToOrigin("localhost:3000/x")).toBe("http://localhost:3000");
    expect(addressToOrigin("127.0.0.1:6000")).toBe("http://127.0.0.1:6000");
    expect(addressToOrigin("https://zetta.example.invalid/chat")).toBe(web);
  });

  test("refuses anything that is not http(s)", () => {
    for (const bad of [
      "",
      "   ",
      "javascript://x",
      "file:///etc/passwd",
      "views://mainview",
      "a b c",
    ])
      expect(addressToOrigin(bad)).toBeNull();
  });
});

describe("discoverServer", () => {
  test("finds a server that serves both the web UI and the API", async () => {
    const meta = buildServerMeta(web, web);
    expect(await discoverServer(web, site({ [`${web}/api/meta`]: meta }))).toEqual({
      status: "found",
      meta,
    });
  });

  test("finds the API of a web UI that is served on its own", async () => {
    const meta = buildServerMeta(web, api);
    const fetcher = site({
      [`${web}/.well-known/zetta.json`]: buildWellKnown(api),
      [`${api}/api/meta`]: meta,
    });
    expect(await discoverServer(web, fetcher)).toEqual({ status: "found", meta });
  });

  test("accepts the API address too and opens the web origin it reports", async () => {
    const meta = buildServerMeta(web, api);
    const result = await discoverServer(api, site({ [`${api}/api/meta`]: meta }));
    expect(result).toEqual({ status: "found", meta });
  });

  test("refuses a server that reports origins other than the one that was typed", async () => {
    const hostile = buildServerMeta("https://evil.example.invalid", "https://evil.example.invalid");
    expect(await discoverServer(web, site({ [`${web}/api/meta`]: hostile }))).toEqual({
      status: "not-zetta",
    });
  });

  test("says what is wrong", async () => {
    expect(await discoverServer("javascript://x", site({}))).toEqual({ status: "invalid-address" });
    expect(await discoverServer(web, site({}))).toEqual({ status: "unreachable" });
    expect(await discoverServer(web, site({ [`${web}/api/meta`]: { hello: "world" } }))).toEqual({
      status: "not-zetta",
    });
    expect(
      await discoverServer(
        web,
        site({ [`${web}/api/meta`]: { ...buildServerMeta(web, web), protocol: 99 } }),
      ),
    ).toEqual({ status: "newer-protocol" });
  });

  test("gives up on a server that does not answer in time", async () => {
    const slow: FetchLike = (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    expect(await discoverServer(web, slow, 20)).toEqual({ status: "unreachable" });
  });
});
