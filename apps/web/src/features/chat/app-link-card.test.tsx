import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { APP_FRAME_SANDBOX } from "../apps/app-frame";
import { setupDom } from "../skills/dom-env";

const win = setupDom();
(globalThis as { scrollTo?: () => void }).scrollTo = () => {};
afterAll(() => {
  delete (globalThis as { scrollTo?: () => void }).scrollTo;
});

const detail = (over: Record<string, unknown> = {}) => ({
  id: "01a1b8f9-aa56-7bc6-8a1a-f6d455841811",
  slug: "lista-de-tarefas",
  name: "Lista de tarefas",
  description: "Keeps a to-do list",
  visibility: "private",
  ownerUserId: "me",
  sourcePlaygroundId: null,
  version: 1,
  tools: 2,
  accounts: [],
  ui: { entry: "ui/index.html", bytes: 40 },
  updatedAt: new Date().toISOString(),
  isOwner: true,
  settings: {},
  versions: [],
  manifest: null,
  policies: {},
  ...over,
});
let apps: Record<string, object | null> = {};
const requests: string[] = [];
globalThis.fetch = (async (input: URL | string) => {
  const path = new URL(String(input)).pathname;
  requests.push(path);
  const ui = /^\/api\/apps\/([^/]+)\/ui$/.exec(path);
  if (ui)
    return Response.json({
      page: { app: ui[1], name: "Lista de tarefas", version: 1, html: "<p>hi</p>", tools: [] },
    });
  const one = /^\/api\/apps\/([^/]+)$/.exec(path);
  const hit = one && apps[one[1]!];
  if (hit) return Response.json({ app: hit });
  return Response.json({ error: { code: "NOT_FOUND", message: "No such app" } }, { status: 404 });
}) as typeof fetch;

const settle = () => act(async () => await new Promise((r) => setTimeout(r, 20)));
const mount = async (data: { app: string; name?: string }) => {
  const { AppLinkCard } = await import("./app-link-card");
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <AppLinkCard data={data} />
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<RouterProvider router={router} />));
  await settle();
  await settle();
  return { host, unmount: () => act(async () => root.unmount()) };
};

test("an app with a page shows its name, an inert preview and a link that opens it", async () => {
  apps = { "lista-de-tarefas": detail() };
  requests.length = 0;
  const { host, unmount } = await mount({ app: "lista-de-tarefas" });
  expect(host.textContent).toContain("Lista de tarefas");
  expect(host.textContent).toContain("Keeps a to-do list");
  expect(host.textContent).toContain("2 tools");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/apps/lista-de-tarefas");
  const frame = host.querySelector("iframe");
  expect(frame?.getAttribute("sandbox")).toBe(APP_FRAME_SANDBOX);
  expect(frame?.getAttribute("tabindex")).toBe("-1");
  expect(frame?.getAttribute("srcdoc")).toBe("<p>hi</p>");
  await unmount();
});

test("an app without a page draws no frame and never asks for one", async () => {
  apps = { quiet: detail({ slug: "quiet", name: "Quiet", ui: null }) };
  requests.length = 0;
  const { host, unmount } = await mount({ app: "quiet" });
  expect(host.querySelector("iframe")).toBeNull();
  expect(requests.some((p) => p.endsWith("/ui"))).toBe(false);
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/apps/quiet");
  await unmount();
});

test("an app that cannot be read says so with the name the block carried, and has no link", async () => {
  apps = {};
  const { host, unmount } = await mount({ app: "gone", name: "Old app" });
  expect(host.textContent).toContain("Old app");
  expect(host.textContent).toContain("no longer available");
  expect(host.querySelector("a")).toBeNull();
  await unmount();
});
