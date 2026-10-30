import { afterAll, describe, expect, test } from "bun:test";
import { LINKS_JS, pageLinks } from "./cdp";

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
