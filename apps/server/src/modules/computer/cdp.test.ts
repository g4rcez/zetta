import { afterAll, describe, expect, test } from "bun:test";
import { LINKS_JS, NavigationError, navigatePage, pageLinks } from "./cdp";

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
      } else if (m.method === "Runtime.evaluate")
        answer({ result: { type: "string", value: current } });
      else answer({});
    },
  },
});
afterAll(() => nav.stop(true));

describe("navigatePage", () => {
  test("opens the address in the active tab, waits for the load and answers the address the tab ends on", async () => {
    expect(await navigatePage(nav.port!, "https://example.com/")).toEqual({
      url: "https://example.com/",
      loaded: true,
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
    });
  });
  test("a port with nothing listening fails instead of hanging", async () => {
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = closed.port!;
    closed.stop(true);
    await expect(navigatePage(port, "https://example.com/", { timeoutMs: 1000 })).rejects.toThrow();
  });
});
