import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { act } from "react";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// Browser features this page uses that the test window lacks. They are set while this file runs only: other files
// read the same globals to decide what to draw.
const globals = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const fakes: Record<string, unknown> = {
  scrollTo: () => {},
  matchMedia: () => ({ matches: true }),
  IntersectionObserver: class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
};
beforeAll(() => {
  for (const [key, value] of Object.entries(fakes)) {
    saved[key] = globals[key];
    globals[key] = value;
  }
});
afterAll(() => {
  for (const key of Object.keys(fakes)) {
    if (saved[key] === undefined) delete globals[key];
    else globals[key] = saved[key];
  }
});

let navMode: "simple" | "full" = "simple";
const BOT = {
  id: "00000000-0000-7000-8000-0000000000a1",
  kind: "specialist",
  name: "Tess",
  role: "",
  description: "Answers billing questions.",
  harness: "claude-code",
  model: null,
  fallbackHarness: null,
  fallbackModel: null,
  version: 1,
  canEdit: true,
  visibility: "team",
  onboarded: true,
  contextBytes: null,
  summaryMode: "chief",
};
// Before anything that loads the auth client: it keeps the `fetch` it finds at load time.
globalThis.fetch = (async (input: URL | string) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname === "/api/bots") return Response.json({ bots: [BOT] });
  if (url.pathname.includes("preferences")) return Response.json({ preferences: { navMode } });
  if (url.pathname === "/api/folders") return Response.json({ folders: [] });
  // Every other section loads its own data; an error keeps each one on its loading line.
  return Response.json({ error: { code: "TEST", message: "not mocked" } }, { status: 500 });
}) as unknown as typeof fetch;

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.replaceChildren();
  win.localStorage.clear();
});
const settle = (ms = 120) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

async function mount(mode: "simple" | "full") {
  navMode = mode;
  const { createRoot } = await import("react-dom/client");
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { SidebarDataProvider } = await import("./sidebar-data");
  const { PreferencesProvider } = await import("../preferences/preferences");
  const { BotSettingsPage } = await import("./bot-settings");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider client={client}>
          <PreferencesProvider>
            <SidebarDataProvider>
              <BotSettingsPage botId={BOT.id} />
            </SidebarDataProvider>
          </PreferencesProvider>
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () => root.render(<RouterProvider router={router} />));
  await settle();
  return host as unknown as Element;
}

const anchor = (host: Element, id: string) =>
  host.querySelector(`#${id}`) as unknown as HTMLElement;
const foldIn = (el: HTMLElement) =>
  Array.from(el.children).find((c) => c.tagName === "DETAILS") as unknown as
    | HTMLDetailsElement
    | undefined;

test("simple view: Chat memory starts folded under Advanced; the everyday sections do not", async () => {
  const host = await mount("simple");
  const memory = foldIn(anchor(host, "chat-memory"));
  expect(memory).toBeDefined();
  expect(memory!.open).toBe(false);
  expect(memory!.querySelector("summary")!.textContent).toContain("Advanced: Chat memory");
  // The section is still in the page: one click opens it.
  expect(memory!.textContent).toContain("How far back the bot remembers a chat.");
  expect(foldIn(anchor(host, "general"))).toBeUndefined();
  expect(foldIn(anchor(host, "personality"))).toBeUndefined();
});

test("a jump from the left list opens the folded section it lands on", async () => {
  const host = await mount("simple");
  const link = host.querySelector('a[href="#chat-memory"]') as unknown as HTMLElement;
  expect(link).not.toBeNull();
  await act(async () => {
    link.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }) as never);
  });
  await settle(40);
  expect(foldIn(anchor(host, "chat-memory"))!.open).toBe(true);
});

test("full view: the same section shows as before, with no fold around it", async () => {
  const host = await mount("full");
  expect(foldIn(anchor(host, "chat-memory"))).toBeUndefined();
  expect(anchor(host, "chat-memory").textContent).toContain(
    "How far back the bot remembers a chat.",
  );
});
