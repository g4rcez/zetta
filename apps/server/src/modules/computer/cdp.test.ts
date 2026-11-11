import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { CONTENT_JS, LINKS_JS, NavigationError, navigatePage, pageLinks, settlePage } from "./cdp";

/** A stand-in for Chromium's DevTools: /json/list names the port inside a container, and the page answers one Runtime.evaluate. */
const evaluated: unknown[] = [];
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req, srv) {
    const path = new URL(req.url).pathname;
    if (path === "/json/list")
      return Response.json([
        { type: "service_worker", webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/worker/W1" },
        { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/P1" },
        { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/P2" },
      ]);
    if (path === "/devtools/page/P1" && srv.upgrade(req)) return;
    return new Response("not found", { status: 404 });
  },
  websocket: {
    message(ws, data) {
      const m = JSON.parse(String(data));
      evaluated.push(m.params);
      ws.send(JSON.stringify({ id: 999, method: "Runtime.consoleAPICalled", params: {} }));
      ws.send(
        JSON.stringify({
          id: m.id,
          result: {
            result: {
              value: {
                url: "https://www.reddit.com/r/neovim/top/?t=day",
                links: [
                  {
                    text: "Inspect your LSP config",
                    href: "https://www.reddit.com/r/neovim/comments/1xi0kzm/x/",
                  },
                ],
              },
            },
          },
        }),
      );
    },
  },
});
afterAll(() => server.stop(true));

describe("pageLinks", () => {
  test("reads the most recently active page through the published port and runs only the link script", async () => {
    expect(await pageLinks(server.port!)).toEqual({
      url: "https://www.reddit.com/r/neovim/top/?t=day",
      links: [
        {
          text: "Inspect your LSP config",
          href: "https://www.reddit.com/r/neovim/comments/1xi0kzm/x/",
        },
      ],
    });
    expect(evaluated).toEqual([{ expression: LINKS_JS, returnByValue: true }]);
  });
  test("a port with nothing listening fails instead of hanging", async () => {
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = closed.port!;
    closed.stop(true);
    await expect(pageLinks(port, 1000)).rejects.toThrow();
  });
});

/** A stand-in for a page that loads what it is told to: the address of the last Page.navigate is what location.href answers. */
const navigated: string[] = [];
let current = "about:blank";
let contentPolls = 0;
const nav = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req, srv) {
    const path = new URL(req.url).pathname;
    if (path === "/json/list")
      return Response.json([
        { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/N1" },
      ]);
    if (path === "/devtools/page/N1" && srv.upgrade(req)) return;
    return new Response("not found", { status: 404 });
  },
  websocket: {
    message(ws, data) {
      const m = JSON.parse(String(data));
      const answer = (result: object) => ws.send(JSON.stringify({ id: m.id, result }));
      if (m.method === "Page.navigate") {
        const url = String(m.params.url);
        navigated.push(url);
        if (url.includes("unreachable.invalid")) {
          answer({ frameId: "F", errorText: "net::ERR_NAME_NOT_RESOLVED" });
          return;
        }
        current = url;
        answer({ frameId: "F" });
        if (!url.includes("slow.example"))
          ws.send(JSON.stringify({ method: "Page.loadEventFired", params: { timestamp: 1 } }));
      } else if (m.method === "Runtime.evaluate" && m.params.expression === CONTENT_JS) {
        // A single-page app: the shell has no text, then the posts arrive, then it stays as it is. "endless.example" never stops growing.
        contentPolls++;
        const grow = current.includes("endless.example")
          ? contentPolls * 50
          : ([0, 0, 120, 900][contentPolls - 1] ?? 900);
        answer({ result: { type: "object", value: { ready: "complete", len: grow } } });
      } else if (m.method === "Runtime.evaluate")
        answer({ result: { type: "string", value: current } });
      else answer({});
    },
  },
});
afterAll(() => nav.stop(true));

describe("navigatePage", () => {
  beforeEach(() => {
    contentPolls = 0;
    navigated.length = 0;
  });
  test("opens the address in the active tab, waits for the load and answers the address the tab ends on", async () => {
    expect(await navigatePage(nav.port!, "https://example.com/")).toEqual({
      url: "https://example.com/",
      loaded: true,
      settled: true,
    });
    expect(navigated).toEqual(["https://example.com/"]);
  });
  test("an address that does not resolve fails with the browser's own error", async () => {
    const e = await navigatePage(nav.port!, "https://unreachable.invalid/").catch((x) => x);
    expect(e).toBeInstanceOf(NavigationError);
    expect(e.message).toBe("net::ERR_NAME_NOT_RESOLVED");
  });
  test("a page that has not finished loading still answers its address, marked as not loaded", async () => {
    expect(await navigatePage(nav.port!, "https://slow.example/", { loadMs: 300 })).toEqual({
      url: "https://slow.example/",
      loaded: false,
      settled: false,
    });
  });
  test("it answers only after the page's text stops growing, so a single-page app is read with its content", async () => {
    const r = await navigatePage(nav.port!, "https://spa.example/status/1");
    expect(r).toEqual({ url: "https://spa.example/status/1", loaded: true, settled: true });
    // empty shell (0), still empty (0), posts arrive (120), full (900), unchanged (900), unchanged (900)
    expect(contentPolls).toBeGreaterThanOrEqual(5);
  });
  test("a page that never stops changing answers within contentMs, marked as not settled", async () => {
    const t = Date.now();
    const r = await navigatePage(nav.port!, "https://endless.example/feed", { contentMs: 900 });
    expect(r).toMatchObject({ loaded: true, settled: false });
    expect(Date.now() - t).toBeLessThan(3000);
  });
  test("a page that never fired load is not waited on for content", async () => {
    const r = await navigatePage(nav.port!, "https://slow.example/", { loadMs: 200 });
    expect(r).toMatchObject({ loaded: false, settled: false });
    expect(contentPolls).toBe(0);
  });
  test("a port with nothing listening fails instead of hanging", async () => {
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = closed.port!;
    closed.stop(true);
    await expect(navigatePage(port, "https://example.com/", { timeoutMs: 1000 })).rejects.toThrow();
  });
});

describe("settlePage", () => {
  beforeEach(() => {
    contentPolls = 0;
    navigated.length = 0;
    current = "https://spa.example/status/1";
  });
  test("waits for the page on screen to stop changing and never navigates", async () => {
    expect(await settlePage(nav.port!)).toBe(true);
    expect(navigated).toEqual([]);
    expect(contentPolls).toBeGreaterThanOrEqual(5);
  });
  test("a page that keeps changing is reported as not settled after maxMs", async () => {
    current = "https://endless.example/feed";
    expect(await settlePage(nav.port!, { maxMs: 900 })).toBe(false);
  });
  test("a port with nothing listening fails instead of hanging", async () => {
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = closed.port!;
    closed.stop(true);
    await expect(settlePage(port)).rejects.toThrow();
  });
});
