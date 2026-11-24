import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import { studioTabs } from "./studio-tabs";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });
const realEvent = globalThis.Event;
globalThis.Event = win.Event as unknown as typeof Event;
afterAll(() => {
  globalThis.Event = realEvent;
});

const INSTALLATION = {
  networkMode: "local",
  publicUrl: null,
  onboarding: "done",
  laya: "on",
  layaLanguages: ["en"],
  layaModel: "english",
  updateCheck: "on",
  restartRequired: false,
  transcribeProvider: "local",
  transcribeModel: "",
  transcribeLanguage: "",
  transcribeBaseUrl: "",
  transcribeKey: "none",
  speechProvider: "local",
  speechKey: "none",
  pushPublicKey: null,
};
let admin = true;
const requests: string[] = [];
globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
  if (url.pathname === "/api/identity/status")
    return Response.json({ state: "active", userId: "u1", isAdmin: admin });
  if (url.pathname === "/api/installation") return Response.json(INSTALLATION);
  if (url.pathname === "/api/decisions/status") return Response.json({ state: "ready" });
  if (url.pathname === "/api/installation/laya") return Response.json({ laya: "on" });
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
const settle = (ms = 80) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const text = () => win.document.body.textContent ?? "";

async function mount(which: "voice" | "decisions", isAdmin: boolean) {
  admin = isAdmin;
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { Voice } = await import("./voice");
  const { Decisions } = await import("./decisions");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider client={client}>
          {which === "voice" ? <Voice /> : <Decisions onError={() => {}} />}
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
const form = (label: string) => win.document.querySelector(`form[aria-label="${label}"]`);

describe("the Studio tab list", () => {
  const slugs = studioTabs.map((t) => t.slug);
  test("Voice comes right after Phone numbers and has a blurb", () => {
    expect(slugs.indexOf("voice")).toBe(slugs.indexOf("phone") + 1);
    const voice = studioTabs.find((t) => t.slug === "voice")!;
    expect(voice.label).toBe("Voice");
    expect(voice.blurb.length).toBeGreaterThan(10);
  });
  test("Decisions keeps its tab and its blurb names only the decision model", () => {
    const decisions = studioTabs.find((t) => t.slug === "decisions")!;
    expect(decisions.blurb).toBe(
      "Picks between options for workflows and bot routing, on this server.",
    );
  });
});

describe("Studio > Voice", () => {
  test("an administrator gets both cards, as forms", async () => {
    await mount("voice", true);
    expect(form("Speech to text")).not.toBeNull();
    expect(form("Text to speech")).not.toBeNull();
    expect(win.document.querySelector('[name="transcribeProvider"]')).not.toBeNull();
    expect(win.document.querySelector('[name="speechProvider"]')).not.toBeNull();
  });
  test("a member sees a sentence in each card and no field", async () => {
    await mount("voice", false);
    expect(text()).toContain("Speech to text");
    expect(text()).toContain("Text to speech");
    expect(text()).toContain("Ask your administrator");
    expect(win.document.querySelector("form")).toBeNull();
    expect(win.document.querySelector("select, input")).toBeNull();
    expect(requests.filter((r) => !r.startsWith("GET"))).toEqual([]);
  });
});

describe("Studio > Decisions", () => {
  test("holds the decision model and nothing else", async () => {
    await mount("decisions", true);
    expect(text()).toContain("Laya");
    expect(text()).toContain("Ready");
    expect(text()).toContain("Try it on a sample");
    for (const gone of [
      "Speech to text",
      "Text to speech",
      "Bot e-mail addresses",
      "WhatsApp server",
      "Check for updates",
    ])
      expect(text()).not.toContain(gone);
    expect(win.document.querySelector('section[aria-label="Updates"]')).toBeNull();
  });
  test("asks the server for nothing of the moved settings", async () => {
    await mount("decisions", true);
    expect(requests.filter((r) => r.includes("/api/settings") || r.includes("version"))).toEqual(
      [],
    );
  });
});
