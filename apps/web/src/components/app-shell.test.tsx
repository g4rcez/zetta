import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();
// The router restores scroll on load; the test DOM has no `scrollTo`.
Object.assign(globalThis, { scrollTo: () => {} });
// The shell shows its sidebar from 768px up.
Object.assign(win, {
  matchMedia: (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }),
});

let sidebarSide: "left" | "right" = "left";
// The auth client keeps the first `fetch` it sees for the whole test process, and this file loads it before the others. So once this
// file is done the fake hands every request to whatever `fetch` the next file installed (or the real one), and cannot hijack it.
const realFetch = globalThis.fetch;
let finished = false;
afterAll(() => void (finished = true));
const fake = (async (input: URL | Request | string, init?: RequestInit) => {
  if (finished) return (globalThis.fetch === fake ? realFetch : globalThis.fetch)(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === "/api/preferences")
    return Response.json({
      preferences: {
        railMode: "expanded",
        sidebarSide,
        railWidth: 224,
        listWidth: 320,
        timeFormat: "24h",
        approvalMode: "hold",
        theme: null,
        primaryColor: null,
        botOrder: [],
      },
    });
  return Response.json({ error: { code: "TEST", message: "offline" } }, { status: 500 });
}) as typeof fetch;
globalThis.fetch = fake;

async function mountShell(side: "left" | "right") {
  sidebarSide = side;
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { ThemeProvider } = await import("../components/theme-provider");
  const { PreferencesProvider } = await import("../features/preferences/preferences");
  const { SidebarDataProvider } = await import("../features/chat/sidebar-data");
  const { AppShell } = await import("./app-shell");
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ThemeProvider attribute="class" defaultTheme="light">
            <PreferencesProvider>
              <SidebarDataProvider>
                <AppShell>
                  <p>page</p>
                </AppShell>
              </SidebarDataProvider>
            </PreferencesProvider>
          </ThemeProvider>
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
  return { host, unmount: () => act(async () => root.unmount()) };
}

test("the sidebar is laid out on the left by default, with its resize handle on its right edge", async () => {
  const { host, unmount } = await mountShell("left");
  const frame = host.querySelector("aside")!.parentElement!;
  expect(frame.className).toContain("md:flex-row");
  expect(frame.className).not.toContain("md:flex-row-reverse");
  expect(host.querySelector("main")!.className).toContain("md:mr-2");
  const handle = host.querySelector('[role="separator"]')!;
  expect(handle.className).toContain("right-0");
  expect(handle.className).not.toContain("left-0");
  await unmount();
});

test("on the right the frame is reversed, the panel keeps its gap, and the resize handle moves to the left edge", async () => {
  const { host, unmount } = await mountShell("right");
  const aside = host.querySelector("aside")!;
  // Still first in the DOM, so the tab order and screen readers do not change.
  expect(aside.nextElementSibling?.tagName).toBe("MAIN");
  expect(aside.parentElement!.className).toContain("md:flex-row-reverse");
  const main = host.querySelector("main")!;
  expect(main.className).toContain("md:ml-2");
  expect(main.className).not.toContain("md:mr-2");
  const handle = host.querySelector('[role="separator"]')!;
  expect(handle.className).toContain("left-0");
  expect(handle.className).not.toContain("right-0");
  await unmount();
});
