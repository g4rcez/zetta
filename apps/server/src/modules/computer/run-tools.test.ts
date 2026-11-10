import { describe, expect, test } from "bun:test";

import { createRunToolRoutes, mintRunToken } from "./run-tools";

const calls: string[] = [];
const vms = {
  start: async (_u: string, vm?: string) => ({ id: vm ?? "vm-1", name: "Default" }),
  epochOf: () => 0,
  act: async (_u: string, _id: string, _by: "agent", a: { type: string }) => {
    calls.push(`act:${a.type}`);
    return a.type === "navigate" ? { url: "https://example.com/", loaded: true } : {};
  },
  read: async () => "[1] link: More information",
  screenshot: async () => "iVBORw0KGgo=",
};
const app = createRunToolRoutes(vms);
let id = 0;
const rpc = (token: string | undefined, method: string, params: unknown) =>
  app.handle(
    new Request("http://localhost/api/run-tools/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }),
  );
/** The JSON-RPC result, from a JSON body or the first SSE data line. */
const result = async (r: Response) => {
  const t = await r.text();
  const line = t.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : t);
};
const init = (token: string) =>
  rpc(token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });

describe("the computer as tools inside a run", () => {
  test("no token, or a revoked one, is refused", async () => {
    expect((await rpc(undefined, "tools/list", {})).status).toBe(401);
    const { token, revoke } = mintRunToken({ userId: "u1", botId: "b1" });
    revoke();
    expect((await rpc(token, "tools/list", {})).status).toBe(401);
  });

  test("a live turn's token lists the tools, acts and returns a screenshot as an image", async () => {
    const { token, revoke } = mintRunToken({ userId: "u1", botId: "b1" });
    expect((await init(token)).status).toBe(200);
    const list = await result(await rpc(token, "tools/list", {}));
    expect(list.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "computer_act",
      "computer_read",
      "computer_screenshot",
    ]);
    const act = await result(
      await rpc(token, "tools/call", {
        name: "computer_act",
        arguments: { action: { type: "navigate", url: "https://example.com" } },
      }),
    );
    expect(act.result.content[0].text).toContain("now at https://example.com/");
    expect(act.result.content[0].text).toContain("[1] link: More information");
    expect(calls).toContain("act:navigate");
    const shot = await result(
      await rpc(token, "tools/call", { name: "computer_screenshot", arguments: {} }),
    );
    expect(shot.result.content[0]).toEqual({
      type: "image",
      data: "iVBORw0KGgo=",
      mimeType: "image/png",
    });
    revoke();
  });

  test("an aborted turn's token stops working", async () => {
    const ac = new AbortController();
    const { token } = mintRunToken({ userId: "u1", botId: "b1", signal: ac.signal });
    ac.abort();
    expect((await rpc(token, "tools/list", {})).status).toBe(401);
  });
});
