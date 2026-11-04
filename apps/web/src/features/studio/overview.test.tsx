import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// The router restores scroll on load; the test DOM has no `scrollTo`.
Object.assign(globalThis, { scrollTo: () => {} });

const harness = (name: string, status: string) => ({
  harness: name,
  label: name,
  installed: true,
  status,
  perUserLogin: false,
});
const GET: Record<string, unknown> = {
  "/api/output-styles": {
    builtins: [{ key: "concise" }, { key: "friendly" }, { key: "formal" }],
    styles: [{ id: "s1" }],
  },
  "/api/workflows": { workflows: [] },
  "/api/decisions/status": { state: "ready" },
  "/api/harnesses": {
    harnesses: [harness("Claude Code", "ready"), harness("Codex", "needs_login")],
  },
  "/api/connections": {
    configured: true,
    providers: ["anthropic"],
    connections: [{ id: "c1", provider: "anthropic", label: "Work", state: "active", revision: 1 }],
  },
  "/api/snapshots": { snapshots: [{ id: "n1" }, { id: "n2" }] },
  "/api/activity?limit=50": {
    events: [{ outcome: "ok" }, { outcome: "failed" }, { outcome: "ok" }],
  },
};
globalThis.fetch = (async (input: URL | string) => {
  const url = new URL(String(input));
  const body = GET[`${url.pathname}${url.search}`];
  return body === undefined
    ? Response.json(
        { error: { code: "TEST", message: `unexpected ${url.pathname}` } },
        { status: 500 },
      )
    : Response.json(body);
}) as typeof fetch;

test("each Studio section shows what it is for and its state now, as a link to the section", async () => {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { Overview } = await import("./overview");
  const errors: string[] = [];
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <Overview onError={(m) => errors.push(m)} />
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<RouterProvider router={router} />));
  await act(async () => void (await new Promise((r) => setTimeout(r, 80))));

  const rows = [...host.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.textContent]);
  expect(rows).toEqual([
    ["/studio/output-styles", expect.stringContaining("4 styles")],
    ["/studio/workflows", expect.stringContaining("None yet")],
    ["/studio/decisions", expect.stringContaining("Ready")],
    [
      "/studio/accounts",
      expect.stringContaining("1 engine needs sign-in · 1 of 2 engines ready · 1 account"),
    ],
    ["/studio/snapshots", expect.stringContaining("2 shared")],
    ["/studio/activity", expect.stringContaining("1 of the last 3 failed")],
  ]);
  expect(errors).toEqual([]);
  await act(async () => root.unmount());
});
