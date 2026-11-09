import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import { parseAppSearch, parseAppsSearch, withAppsSearch, type AppsSearch } from "./apps-search";

const win = setupDom();
// The router scrolls to the top after a navigation; the fake window has no scrollTo.
(globalThis as { scrollTo?: () => void }).scrollTo = () => {};
afterAll(() => {
  delete (globalThis as { scrollTo?: () => void }).scrollTo;
});

const ME = "user-me";
const requests: { path: string; method: string }[] = [];
let apps: object[] = [];
const app = (over: Record<string, unknown> = {}) => ({
  id: "01a1b8f9-aa56-7bc6-8a1a-f6d455841811",
  slug: "github-triage",
  name: "GitHub triage",
  description: "Sort new issues",
  visibility: "private",
  ownerUserId: ME,
  sourcePlaygroundId: null,
  version: 3,
  tools: 5,
  accounts: ["github"],
  ui: null,
  updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  ...over,
});
globalThis.fetch = (async (input: URL | string) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  requests.push({ path, method: "GET" });
  if (path === "/api/apps") return Response.json({ apps });
  if (path.startsWith("/api/apps/tools")) {
    const q = url.searchParams.get("q") ?? "";
    return Response.json({
      tools: [
        {
          path: "apps.github-triage.items.remove",
          app: "github-triage",
          tool: "items.remove",
          kind: "mutation",
          description: `Remove an item (${q || "all"})`,
          policy: "Asks (changes something)",
          needsAccounts: [],
        },
        {
          path: "apps.github-triage.greet",
          app: "github-triage",
          tool: "greet",
          kind: "query",
          description: "Say hello",
          policy: "Never asks (reads)",
          needsAccounts: [],
        },
      ],
    });
  }
  return Response.json({ error: { code: "TEST", message: `unexpected ${path}` } }, { status: 500 });
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const text = () => win.document.body.textContent ?? "";
const buttons = () => [...win.document.querySelectorAll("button")];
const hrefs = () => [...win.document.querySelectorAll("a")].map((a) => a.getAttribute("href"));

const mount = async (initial: AppsSearch) => {
  const { AppsPage } = await import("./apps-page");
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { useState } = await import("react");
  const changes: AppsSearch[] = [];
  function Address() {
    const [search, setAddress] = useState<AppsSearch>(initial);
    return (
      <AppsPage
        userId={ME}
        search={search}
        setSearch={(patch) => {
          const next = withAppsSearch(search, patch);
          changes.push(next);
          setAddress(next);
        }}
      />
    );
  }
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <Address />
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
  return { changes, unmount: () => act(async () => root.unmount()) };
};

test("the address: only known values survive, defaults are left out", () => {
  expect(parseAppsSearch({ tab: "tools", q: "  remove " })).toEqual({ tab: "tools", q: "remove" });
  expect(parseAppsSearch({ tab: "apps", q: "" })).toEqual({});
  expect(parseAppsSearch({ tab: ["x"], q: 5 })).toEqual({});
  expect(withAppsSearch({ tab: "tools", q: "a" }, { q: undefined, tab: undefined })).toEqual({});
  expect(parseAppSearch({ tab: "calls" })).toEqual({ tab: "calls" });
  expect(parseAppSearch({ tab: "nonsense" })).toEqual({});
});

test("with no apps the page says where to write one", async () => {
  apps = [];
  requests.length = 0;
  const { unmount } = await mount({});
  expect(text()).toContain("No apps yet");
  expect(text()).toContain("Playground");
  expect(hrefs()).toContain("/playground");
  await unmount();
});

test("the apps tab shows each app's version, tools, needs and who it belongs to, and loads no tools", async () => {
  apps = [
    app(),
    app({
      id: "01a1b8f9-aa56-7bc6-8a1a-f6d455841822",
      slug: "reports",
      name: "Reports",
      ownerUserId: "someone-else",
      visibility: "team",
      version: 1,
      tools: 1,
      accounts: [],
    }),
    app({
      id: "01a1b8f9-aa56-7bc6-8a1a-f6d455841833",
      slug: "draft",
      name: "Draft",
      visibility: "team",
      version: null,
      tools: 0,
      accounts: [],
    }),
  ];
  requests.length = 0;
  const { unmount } = await mount({});
  expect(text()).toContain("GitHub triage");
  expect(text()).toContain("github-triage · v3 · 5 tools");
  expect(text()).toContain("Needs: github");
  expect(text()).toContain("Private");
  expect(text()).toContain("Team app");
  expect(text()).toContain("Shared");
  expect(text()).toContain("draft · not published · 0 tools");
  expect(text()).toContain("reports · v1 · 1 tool");
  expect(text()).toContain("Updated 3h ago");
  // Your own app is addressed by slug; someone else's team app by id.
  expect(hrefs()).toContain("/apps/github-triage");
  expect(hrefs()).toContain("/apps/01a1b8f9-aa56-7bc6-8a1a-f6d455841822");
  expect(requests.some((r) => r.path.startsWith("/api/apps/tools"))).toBe(false);
  await unmount();
});

test("an app with a page says so on its card", async () => {
  apps = [
    app({ ui: { entry: "ui/index.html", bytes: 900 } }),
    app({ id: "01a1b8f9-aa56-7bc6-8a1a-f6d455841844", slug: "plain", name: "Plain" }),
  ];
  const { unmount } = await mount({});
  expect(text().match(/Has a page/g)).toHaveLength(1);
  await unmount();
});

test("a tools address shows its results with no click, and a search goes into the address", async () => {
  apps = [app()];
  requests.length = 0;
  const { changes, unmount } = await mount({ tab: "tools", q: "remove" });
  expect(requests.map((r) => r.path)).toContain("/api/apps/tools?q=remove");
  expect(text()).toContain("apps.github-triage.items.remove");
  expect(text()).toContain("Remove an item (remove)");
  expect(text()).toContain("Changes something");
  expect(text()).toContain("Asks (changes something)");
  expect(text()).toContain("Never asks (reads)");
  const box = win.document.querySelector("input") as unknown as HTMLInputElement;
  expect(box.value).toBe("remove");
  await act(async () => {
    const form = win.document.querySelector("form")!;
    form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(changes.at(-1)).toEqual({ tab: "tools", q: "remove" });
  await unmount();
});

test("the tabs change the address", async () => {
  apps = [app()];
  const { changes, unmount } = await mount({});
  await act(async () => {
    buttons()
      .find((b) => b.textContent === "Tools")!
      .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  });
  await settle();
  expect(changes.at(-1)).toEqual({ tab: "tools" });
  await act(async () => {
    buttons()
      .find((b) => b.textContent === "Apps")!
      .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  });
  expect(changes.at(-1)).toEqual({});
  await unmount();
});
