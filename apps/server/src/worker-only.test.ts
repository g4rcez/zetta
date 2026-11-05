import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { createApp } from "./app";
import { parseRole } from "./role";
import { isWorkerOnly } from "./worker-only";

describe("parseRole", () => {
  test("defaults to all and accepts the three roles", () => {
    expect(parseRole(undefined)).toBe("all");
    expect(parseRole(" api ")).toBe("api");
    expect(parseRole("worker")).toBe("worker");
  });
  test("refuses anything else, so a typo never starts the wrong process", () => {
    expect(() => parseRole("apii")).toThrow('ZETTA_ROLE must be all, api or worker (got "apii").');
  });
});

describe("isWorkerOnly", () => {
  test.each([
    ["POST", "/api/conversations/c1/chat"],
    ["POST", "/api/conversations/c1/stream"],
    ["GET", "/api/conversations/c1/chat/stream"],
    ["GET", "/api/conversations/c1/turn"],
    ["POST", "/api/conversations/c1/queue/m1/retry"],
    ["POST", "/api/routines/r1/run"],
    ["GET", "/api/computer/vms"],
    ["GET", "/api/bots/b1/database/tables/t"],
    ["POST", "/api/proposals/p1/decision"],
    ["GET", "/api/harnesses"],
    ["GET", "/api/connections/transport-key"],
    ["POST", "/api/plugins"],
    ["PUT", "/api/plugins/telegram/config"],
    ["POST", "/api/plugins/telegram/connect"],
  ])("%s %s needs the worker", (method, path) => {
    expect(isWorkerOnly(method, path)).toBe(true);
  });
  test.each([
    ["GET", "/api/conversations/c1/messages"],
    ["GET", "/api/conversations"],
    ["GET", "/api/bots"],
    ["GET", "/api/events"],
    ["GET", "/api/routines"],
    ["DELETE", "/api/conversations/c1/queue/m1"],
    ["GET", "/api/proposals"],
  ])("%s %s can be served by any instance", (method, path) => {
    expect(isWorkerOnly(method, path)).toBe(false);
  });
});

const auth = { api: { getSession: async () => null }, handler: () => new Response("auth") };
const make = (extra: { role?: "all" | "api"; ready?: () => Promise<boolean> }) =>
  createApp({ auth, webOrigin: "https://app.example.invalid", desktopOrigins: [], ...extra });

describe("roles on the app", () => {
  test("an api process answers 421 for a worker-only request, and serves the rest", async () => {
    const api = make({ role: "api" });
    const refused = await api.handle(
      new Request("http://localhost/api/conversations/c1/chat", { method: "POST" }),
    );
    expect(refused.status).toBe(421);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("WORKER_ROUTE");
    expect(await (await api.handle(new Request("http://localhost/healthz"))).text()).toBe("OK");
  });

  test("an all process does not refuse worker-only paths", async () => {
    const res = await make({ role: "all" }).handle(
      new Request("http://localhost/api/conversations/c1/chat", { method: "POST" }),
    );
    expect(res.status).not.toBe(421);
  });

  test("readyz is 200 while the database answers, 503 when it fails or is slow", async () => {
    const get = (ready: () => Promise<boolean>) =>
      make({ ready }).handle(new Request("http://localhost/readyz"));
    expect((await get(async () => true)).status).toBe(200);
    expect(
      (
        await get(async () => {
          throw new Error("db down");
        })
      ).status,
    ).toBe(503);
    expect((await get(() => new Promise(() => {}))).status).toBe(503);
  });
});

// docker/scale/Caddyfile routes by these patterns; the server and the balancer must agree on what needs the worker.
describe("docker/scale/Caddyfile", () => {
  const text = readFileSync(new URL("../../../docker/scale/Caddyfile", import.meta.url), "utf8");
  const section = (name: string) => {
    const start = text.indexOf(`@${name}`);
    const block = text.slice(
      start,
      text.indexOf("\n\t@", start + 1) > 0
        ? text.indexOf("\n\t@", start + 1)
        : text.indexOf("\n\n", start),
    );
    const pattern = /path_regexp\s+(\S+)/.exec(block)![1]!;
    const method = /method\s+(\w+)/.exec(block)?.[1];
    return { re: new RegExp(pattern), method };
  };
  const rules = [
    section("worker_any"),
    section("worker_post"),
    section("worker_put"),
    section("worker_get"),
  ];
  const balancerSaysWorker = (method: string, path: string) =>
    rules.some((r) => (!r.method || r.method === method) && r.re.test(path));

  test.each([
    ["POST", "/api/conversations/c1/chat"],
    ["POST", "/api/conversations/c1/stream"],
    ["GET", "/api/conversations/c1/chat/stream"],
    ["GET", "/api/conversations/c1/turn"],
    ["POST", "/api/conversations/c1/queue/m1/retry"],
    ["POST", "/api/routines/r1/run"],
    ["GET", "/api/computer/vms"],
    ["GET", "/api/bots/b1/database/tables/t"],
    ["POST", "/api/proposals/p1/decision"],
    ["GET", "/api/harnesses"],
    ["GET", "/api/conversations/c1/messages"],
    ["GET", "/api/conversations"],
    ["GET", "/api/bots"],
    ["GET", "/api/events"],
    ["DELETE", "/api/conversations/c1/queue/m1"],
    ["GET", "/api/proposals"],
    ["POST", "/api/bots/b1/onboarding/question"],
    ["POST", "/api/memory-assist"],
    ["POST", "/api/wiki-assist"], // the old name of the route
    ["GET", "/api/connections/transport-key"],
    ["POST", "/api/connections"],
    ["POST", "/api/plugins"],
    ["PUT", "/api/plugins/telegram/config"],
    ["POST", "/api/plugins/telegram/connect"],
    ["GET", "/api/plugins/google/callback"],
    ["GET", "/api/plugins/catalog"],
    ["GET", "/api/plugins"],
    ["GET", "/api/connections"],
  ])("%s %s is routed the same by the balancer and the server", (method, path) => {
    expect(balancerSaysWorker(method, path)).toBe(isWorkerOnly(method, path));
  });
});
