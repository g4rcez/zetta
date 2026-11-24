import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });
const realEvent = globalThis.Event;
globalThis.Event = win.Event as unknown as typeof Event;
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.Event = realEvent;
  globalThis.FormData = bunFormData;
});

const meta = (id: string, name: string, over: object = {}) => ({
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
  tools: [],
  ...over,
});
const CATALOG = [
  meta("whatsapp", "WhatsApp"),
  meta("botmail", "Bot e-mail address", {
    builtin: true,
    notes: "Gives a bot its own e-mail address.",
  }),
  meta("telegram", "Telegram"),
];
const INSTALLATION = {
  networkMode: "local",
  publicUrl: null,
  onboarding: "done",
  laya: "on",
  layaLanguages: ["en"],
  layaModel: "english",
  restartRequired: false,
  transcribeProvider: "local",
  transcribeModel: "",
  transcribeLanguage: "",
  transcribeBaseUrl: "",
  transcribeKey: "none",
  wahaKey: "none",
  mailProvider: "resend",
  mailDomain: "",
  mailKey: "none",
  pushPublicKey: null,
};
const requests: string[] = [];
let admin = true;
globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? "GET";
  requests.push(`${method} ${url.pathname}`);
  if (url.pathname === "/api/plugins/catalog") return Response.json({ plugins: CATALOG });
  if (url.pathname === "/api/plugins") return Response.json({ plugins: [] });
  if (url.pathname === "/api/bots") return Response.json({ bots: [] });
  if (url.pathname === "/api/identity/status")
    return Response.json({ state: "active", userId: "u1", isAdmin: admin });
  if (url.pathname === "/api/installation") return Response.json(INSTALLATION);
  if (url.pathname === "/api/settings")
    return Response.json({
      groups: {},
      settings: [{ key: "wahaUrl", value: "", default: "", source: "default", type: "text" }],
    });
  if (url.pathname === "/api/settings/wahaUrl" && method === "PUT")
    return Response.json({ key: "wahaUrl", value: "http://waha.example.invalid:3010" });
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${url.pathname}` } },
    { status: 500 },
  );
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of mounted.splice(0)) await u();
  win.document.body.replaceChildren();
  requests.length = 0;
});
const settle = (ms = 100) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const text = () => win.document.body.textContent ?? "";
const section = (label: string) => win.document.querySelector(`section[aria-label="${label}"]`);

async function mount(pluginId: string, isAdmin: boolean) {
  admin = isAdmin;
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { PluginPage } = await import("./plugin-page");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider client={client}>
          <PluginPage pluginId={pluginId} isAdmin={isAdmin} />
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
  await settle();
  mounted.push(() => act(async () => root.unmount()));
}
const asked = (part: string) => requests.filter((r) => r.includes(part));

describe("Plugins > WhatsApp", () => {
  test("an administrator sees Server for everyone with the WAHA card, and the address saves", async () => {
    await mount("whatsapp", true);
    const server = section("Server for everyone")!;
    expect(server).not.toBeNull();
    expect(server.textContent).toContain("WhatsApp server (WAHA)");
    const address = win.document.querySelector('[name="wahaUrl"]') as unknown as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
        address,
        "http://waha.example.invalid:3010",
      );
      address.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
    });
    await act(async () => {
      win.document
        .querySelector('form[aria-label="WhatsApp server (WAHA)"]')!
        .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never);
    });
    await settle();
    expect(asked("PUT /api/settings/wahaUrl")).toHaveLength(1);
  });
  test("a member does not see the section and nothing of it is asked of the server", async () => {
    await mount("whatsapp", false);
    expect(text()).toContain("WhatsApp");
    expect(section("Server for everyone")).toBeNull();
    expect(text()).not.toContain("WhatsApp server (WAHA)");
    expect(asked("/api/settings")).toEqual([]);
    expect(asked("/api/installation")).toEqual([]);
  });
  test("other plugins do not carry it", async () => {
    await mount("telegram", true);
    expect(section("Server for everyone")).toBeNull();
  });
});

describe("Plugins > Bot e-mail address", () => {
  const activation = () =>
    win.document.querySelector('form[aria-label="Activate Bot e-mail address"]');
  test("an administrator sees the server setup, and a built-in plugin to activate with nothing to fill in", async () => {
    await mount("botmail", true);
    expect(text()).toContain("Gives a bot its own e-mail address.");
    expect(text()).toContain("Built in");
    const form = activation()!;
    expect(form).not.toBeNull();
    expect(form.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(form.textContent).toContain("Activate");
    expect(form.textContent).not.toContain("Install");
    const server = section("Server setup")!;
    expect(server).not.toBeNull();
    expect(server.textContent).toContain("Bot e-mail addresses");
    expect(win.document.querySelector('[name="mailDomain"]')).not.toBeNull();
  });
  test("a member can activate it too, sees no server setup, and nothing of the setup is asked of the server", async () => {
    await mount("botmail", false);
    expect(text()).toContain("Gives a bot its own e-mail address.");
    expect(activation()).not.toBeNull();
    expect(section("Server setup")).toBeNull();
    expect(win.document.querySelector('[name="mailDomain"]')).toBeNull();
    expect(asked("/api/installation")).toEqual([]);
  });
});
