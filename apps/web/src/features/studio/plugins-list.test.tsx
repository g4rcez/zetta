import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type { PluginsSearch } from "./plugins-filters";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });

const meta = (id: string, name: string, builtin = false) => ({
  id,
  name,
  description: `${name} plugin.`,
  icon: "chat",
  category: "messaging",
  auth: "none",
  kind: "native",
  transport: null,
  fields: [],
  docsUrl: null,
  verified: true,
  notes: null,
  guide: [],
  credentials: false,
  builtin,
  tools: [],
});
let admin = true;
/** What the person has installed or activated. */
let installedPlugins: { id: string; sharing: "private" | "team"; hasSecret: boolean }[] = [];
globalThis.fetch = (async (input: URL | Request | string) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === "/api/plugins/catalog")
    return Response.json({
      plugins: [
        meta("botmail", "Bot e-mail address", true),
        meta("memory", "Memory notes", true),
        meta("whatsapp", "WhatsApp"),
      ],
    });
  if (url.pathname === "/api/plugins") return Response.json({ plugins: installedPlugins });
  if (url.pathname === "/api/identity/status")
    return Response.json({ state: "active", userId: "u1", isAdmin: admin });
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
const changes: PluginsSearch[] = [];
afterEach(async () => {
  installedPlugins = [];
  for (const u of mounted.splice(0)) await u();
  win.document.body.replaceChildren();
});
async function mount(isAdmin: boolean, search: PluginsSearch = { status: "builtin" }) {
  admin = isAdmin;
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { Plugins } = await import("./plugins");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider client={client}>
          <Plugins onError={() => {}} search={search} setSearch={(next) => changes.push(next)} />
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<RouterProvider router={router} />));
  await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
  mounted.push(() => act(async () => root.unmount()));
  return host;
}
const buttons = (card: Element) =>
  [...card.querySelectorAll("button")].map((b) => b.textContent?.trim());
const card = (host: Element, name: string) =>
  [...host.querySelectorAll("div.rounded-lg")].find((c) => c.textContent?.includes(name))!;

test("a built-in plugin is not on by default: it says Built in and offers to activate it", async () => {
  const host = await mount(true);
  const memory = card(host, "Memory notes");
  expect(memory.textContent).toContain("Built in");
  expect(memory.textContent).not.toContain("On for every bot");
  expect(buttons(memory)).toEqual(["Activate"]);
});

test("an administrator can also open the built-in Bot e-mail address page before activating it, for its server settings", async () => {
  const host = await mount(true);
  expect(buttons(card(host, "Bot e-mail address"))).toEqual(["Manage", "Activate"]);
  expect(buttons(card(host, "Memory notes"))).toEqual(["Activate"]);
});

test("a member can activate a built-in plugin but has no button to a page that holds only administrator settings", async () => {
  const host = await mount(false);
  expect(buttons(card(host, "Bot e-mail address"))).toEqual(["Activate"]);
});

test("once activated, a built-in plugin is Active and is managed like any other", async () => {
  installedPlugins = [{ id: "memory", sharing: "private", hasSecret: false }];
  const host = await mount(true, {});
  expect(names(host)).toEqual(["Memory notes"]);
  const memory = card(host, "Memory notes");
  expect(memory.textContent).toContain("Built in");
  expect(memory.textContent).toContain("Active");
  expect(buttons(memory)).toEqual(["Manage"]);
});

const names = (host: Element) =>
  [...host.querySelectorAll("div.rounded-lg")].map(
    (c) => c.querySelector("span.font-medium")?.textContent,
  );
const pressed = (host: Element) =>
  [...host.querySelectorAll('[role="group"][aria-label="Status"] button')]
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent?.replace(/\d+$/, "").trim());

test("the Built in filter lists the plugins that ship with Zetta, activated or not", async () => {
  const host = await mount(true, { status: "builtin" });
  expect(names(host)).toEqual(["Bot e-mail address", "Memory notes"]);
  expect(pressed(host)).toEqual(["Built in"]);
});

test("nothing is installed until something is activated; Available holds the built-in ones too", async () => {
  expect(names(await mount(true, {}))).toEqual([]);
  expect(names(await mount(true, { status: "available" }))).toEqual([
    "Bot e-mail address",
    "Memory notes",
    "WhatsApp",
  ]);
});

test("each status button shows its count, and choosing Built in asks for the address to change", async () => {
  changes.length = 0;
  const host = await mount(true, {});
  const buttons = [...host.querySelectorAll('[role="group"][aria-label="Status"] button')];
  expect(buttons.map((b) => b.textContent?.replace(/\s+/g, " ").trim())).toEqual([
    "Installed 0",
    "Available 3",
    "Built in 2",
    "All 3",
  ]);
  await act(async () => (buttons[2] as HTMLElement).click());
  expect(changes).toEqual([{ status: "builtin" }]);
});
