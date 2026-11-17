import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });

const CHIEF = "01a19da2-3c92-783a-b90d-c35975f3c601";
const DEV = "01a19da2-3c92-783a-b90d-c35975f3c602";
const ANA = "01a19da2-3c92-783a-b90d-c35975f3c603";
const bot = (id: string, name: string, over: object = {}) => ({
  id,
  name,
  kind: "specialist",
  description: `${name} helps`,
  visibility: "team",
  canEdit: false,
  version: 1,
  onboarded: true,
  harness: "claude",
  model: null,
  personality: "",
  instructions: "",
  ...over,
});

let pinned: string[] = [];
let saved: unknown[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (url.pathname === "/api/preferences") {
    if (method === "PATCH") saved.push(JSON.parse(String(init?.body)));
    return Response.json({ preferences: { sidebarBots: pinned, botOrder: [] } });
  }
  if (url.pathname === "/api/bots")
    return Response.json({
      bots: [
        bot(CHIEF, "Zetta", { kind: "chief", canEdit: true }),
        bot(DEV, "Dev Bot"),
        bot(ANA, "Ana", { canEdit: true }),
      ],
    });
  if (url.pathname === "/api/conversations") return Response.json({ conversations: [] });
  return Response.json({ folders: [], statuses: [], teams: [], items: [] });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  pinned = [];
  saved = [];
});
const settle = (ms = 80) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const mount = async () => {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { SidebarDataProvider } = await import("./sidebar-data");
  const { SidebarBots } = await import("./sidebar-bots");
  const { PreferencesProvider } = await import("../preferences/preferences");
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <PreferencesProvider>
            <SidebarDataProvider>
              <SidebarBots
                query=""
                botId={undefined}
                onBot={() => {}}
                onNewChat={() => {}}
                onNewBot={() => {}}
                onNewRoom={() => {}}
                newChatBot={undefined}
              />
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
  await act(async () => root.render(<RouterProvider router={router} />));
  await settle();
  mounted.push(() => act(async () => root.unmount()));
  return host as unknown as HTMLElement;
};
const names = (host: HTMLElement) =>
  [...host.querySelectorAll("button[data-chat-row] span.truncate")].map(
    (n) => n.childNodes[0]?.textContent,
  );
const click = async (el: Element | null | undefined) => {
  await act(
    async () => void el!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle(60);
};

test("the sidebar lists the chief and the bots the person pinned, in the order pinned, and nothing else", async () => {
  pinned = [ANA];
  const host = await mount();
  expect(names(host)).toEqual(["Zetta", "Ana"]);
  // Dev Bot is not in the sidebar, so the link to the rest says how many there are.
  expect(host.textContent).toContain("All bots (3)");
});

test("with nothing pinned the sidebar keeps its own pick", async () => {
  const host = await mount();
  expect(names(host)).toEqual(["Zetta", "Dev Bot", "Ana"]);
});

test("a bot row can be taken out of the sidebar, even a bot the person does not own; the chief cannot", async () => {
  const host = await mount();
  // Dev Bot is somebody else's: no settings, but still a menu with the way out.
  expect(host.querySelector('button[aria-label="Actions for Dev Bot"]')).not.toBeNull();
  await click(host.querySelector('button[aria-label="Actions for Dev Bot"]'));
  const remove = [...win.document.querySelectorAll('[role="menuitem"], button, li')].find(
    (e) => e.textContent?.trim() === "Remove from sidebar",
  );
  expect(remove).toBeDefined();
  await click(remove);
  await settle(520);
  // The pins start from what was on screen, minus the bot taken out.
  expect(saved).toEqual([{ sidebarBots: [ANA] }]);
  // The chief's own menu holds Settings only.
  await click(host.querySelector('button[aria-label="Actions for Zetta"]'));
  expect(
    [...win.document.querySelectorAll("*")].filter((e) => e.textContent === "Remove from sidebar")
      .length,
  ).toBeLessThanOrEqual(1);
});
