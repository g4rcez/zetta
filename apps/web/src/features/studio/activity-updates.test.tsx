import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import { parseActivityView } from "./activity-view";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });

const update = (n: number, title: string) => ({
  id: `01a1ce15-6b98-7fa6-a72d-0885e1cc51${String(n).padStart(2, "0")}`,
  kind: "memory_updated",
  title,
  detail: "Saved two notes.",
  resultLink: "/memory",
  botId: null,
  occurrences: 1,
  updatedAt: new Date(Date.now() - n * 60_000).toISOString(),
});
let items = [update(1, "Dev Bot updated your memory"), update(2, "Background task from Dev Bot")];
let requests: string[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  requests.push(`${method} ${url.pathname}${url.search}`);
  if (method === "GET" && url.pathname === "/api/attention") return Response.json({ items });
  if (method === "POST") return Response.json({ item: {} });
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  requests = [];
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));

const mount = async (view: "trail" | "updates", onView: (v: string) => void = () => {}) => {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { Activity } = await import("./activity");
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <Activity bots={[]} onError={() => {}} view={view} onView={onView} />
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
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

test("the view comes from the address, and anything unknown is the trail", () => {
  expect(parseActivityView("updates")).toBe("updates");
  expect(parseActivityView("trail")).toBe("trail");
  expect(parseActivityView("nope")).toBe("trail");
  expect(parseActivityView(undefined)).toBe("trail");
});

test("Updates asks only for live updates, lists them, and says where decisions are", async () => {
  items = [update(1, "Dev Bot updated your memory"), update(2, "Background task from Dev Bot")];
  const host = await mount("updates");
  expect(host.textContent).toContain("Dev Bot updated your memory");
  expect(host.textContent).toContain("Background task from Dev Bot");
  expect(host.textContent).toContain("Inbox");
  expect(requests).toContain("GET /api/attention?category=fyi&state=live&limit=50");
});

test("Dismiss cancels the card", async () => {
  items = [update(1, "Dev Bot updated your memory")];
  const host = await mount("updates");
  await act(async () => button(host, "Dismiss")?.click());
  await settle();
  expect(requests.filter((r) => r.startsWith("POST"))).toEqual([
    `POST /api/attention/${items[0]!.id}/action`,
  ]);
});

test("with no updates it says so", async () => {
  items = [];
  const host = await mount("updates");
  expect(host.textContent).toContain("No updates.");
});

test("the switch asks for the other view", async () => {
  const asked: string[] = [];
  const host = await mount("trail", (v) => asked.push(v));
  await act(async () => button(host, "Updates")?.click());
  expect(asked).toEqual(["updates"]);
});
