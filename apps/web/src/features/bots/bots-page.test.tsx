import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });

const DEV = "01a19da2-3c92-783a-b90d-c35975f3c60c";
const ANA = "01a19da2-3c92-783a-b90d-c35975f3c60d";
const bot = (id: string, name: string, over: object = {}) => ({
  id,
  name,
  kind: "specialist",
  description: `${name} helps`,
  visibility: "private",
  canEdit: true,
  version: 1,
  onboarded: true,
  harness: "claude",
  model: null,
  personality: "",
  instructions: "",
  ...over,
});

const CHIEF = "01a19da2-3c92-783a-b90d-c35975f3c60e";
const defaultBots = () => [bot(DEV, "Dev Bot"), bot(ANA, "Ana", { canEdit: false })];
let bots: object[] = defaultBots();
let pinned: string[] = [];
let saved: unknown[] = [];
let calls: string[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  calls.push(`${method} ${url.pathname}`);
  if (url.pathname === "/api/preferences") {
    if (method === "PATCH") saved.push(JSON.parse(String(init?.body)));
    return Response.json({ preferences: { sidebarBots: pinned, botOrder: [] } });
  }
  if (method === "DELETE") return Response.json({ bot: bot(ANA, "Ana") });
  if (url.pathname === "/api/bots") return Response.json({ bots });
  if (url.pathname === "/api/conversations")
    return Response.json({
      conversations: [{ id: "c1", botId: DEV, title: "Hi", updatedAt: "2026-11-10T00:00:00Z" }],
    });
  if (url.pathname === "/api/bot-statuses") return Response.json({ statuses: [] });
  return Response.json({ folders: [], statuses: [], teams: [] });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  calls = [];
  bots = defaultBots();
  pinned = [];
  saved = [];
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 80))));
const mount = async (search: object) => {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { SidebarDataProvider } = await import("../chat/sidebar-data");
  const { BotsPage } = await import("./bots-page");
  const { PreferencesProvider } = await import("../preferences/preferences");
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <PreferencesProvider>
            <SidebarDataProvider>
              <BotsPage search={search} onSearch={() => {}} />
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
const text = (host: HTMLElement) => host.textContent ?? "";
const buttons = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].filter((b) => b.textContent?.includes(label));

test("every bot is a card with a way to its chat and a New chat button", async () => {
  const host = await mount({});
  expect(host.querySelectorAll("li").length).toBe(2);
  expect(text(host)).toContain("Dev Bot");
  expect(text(host)).toContain("Ana");
  // Dev Bot has a chat, Ana has none yet.
  expect(buttons(host, "Go to chat")).toHaveLength(1);
  expect(buttons(host, "Start chatting")).toHaveLength(1);
  expect(buttons(host, "New chat")).toHaveLength(2);
});

test("the search from the address filters the grid with no click", async () => {
  const host = await mount({ q: "ana" });
  expect(host.querySelectorAll("li").length).toBe(1);
  expect(text(host)).not.toContain("Dev Bot");
});

test("a bot the person cannot edit has no menu to edit or delete it", async () => {
  const host = await mount({});
  expect(host.querySelector('button[aria-label="Actions for Dev Bot"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Actions for Ana"]')).toBeNull();
});

test("no bot matches: the page says so instead of showing an empty grid", async () => {
  const host = await mount({ q: "zzz" });
  expect(host.querySelectorAll("li").length).toBe(0);
  expect(text(host)).toContain("No bot matches");
});

const pin = (host: HTMLElement, name: string) =>
  host.querySelector(
    `button[aria-label$="${name} in the chat sidebar"], button[aria-label$="${name} from the chat sidebar"]`,
  ) as HTMLButtonElement | null;
const click = async (el: Element | null) => {
  await act(
    async () => void el!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  // The preference is saved after a short pause.
  await act(async () => void (await new Promise((r) => setTimeout(r, 520))));
};

test("every bot has a pin for the chat sidebar, even one the person cannot edit, but the chief has none", async () => {
  bots = [bot(CHIEF, "Zetta", { kind: "chief" }), ...defaultBots()];
  const host = await mount({});
  expect(pin(host, "Dev Bot")).not.toBeNull();
  // Ana cannot be edited, so she has no menu, and still can be pinned: it only changes this person's sidebar.
  expect(pin(host, "Ana")).not.toBeNull();
  expect(
    host.querySelector('button[aria-label^="Remove Zetta"], button[aria-label^="Show Zetta"]'),
  ).toBeNull();
});

test("with nothing pinned the bots the sidebar already shows read as pinned", async () => {
  const host = await mount({});
  expect(pin(host, "Dev Bot")!.getAttribute("aria-pressed")).toBe("true");
  expect(pin(host, "Ana")!.getAttribute("aria-pressed")).toBe("true");
});

test("removing one bot keeps the others: the pins start from what the sidebar shows", async () => {
  const host = await mount({});
  await click(pin(host, "Dev Bot"));
  expect(saved).toEqual([{ sidebarBots: [ANA] }]);
});

test("pins that were saved decide which cards read as pinned, and pinning adds to them", async () => {
  pinned = [ANA];
  const host = await mount({});
  expect(pin(host, "Ana")!.getAttribute("aria-pressed")).toBe("true");
  expect(pin(host, "Dev Bot")!.getAttribute("aria-pressed")).toBe("false");
  await click(pin(host, "Dev Bot"));
  expect(saved).toEqual([{ sidebarBots: [ANA, DEV] }]);
});
