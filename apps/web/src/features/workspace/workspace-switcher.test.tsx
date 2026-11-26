import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.FormData = bunFormData;
});

type Entry = { id: string; slug: string; name: string; role: string; current: boolean };
let workspaces: Entry[] = [];
let mayCreate = false;
let joinAnswer: { status: number; body: unknown } = { status: 200, body: {} };
let startAnswer: { status: number; body: unknown } = { status: 201, body: {} };
const sent: { method: string; path: string; body: unknown }[] = [];

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (method !== "GET") sent.push({ method, path: url.pathname, body });
  if (url.pathname === "/api/workspace/all") return Response.json({ workspaces, mayCreate });
  if (url.pathname === "/api/workspace/join")
    return Response.json(joinAnswer.body, { status: joinAnswer.status });
  if (url.pathname === "/api/workspace/new")
    return Response.json(startAnswer.body, { status: startAnswer.status });
  return Response.json({});
}) as typeof fetch;

const settle = (ms = 80) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const click = async (target: unknown) => {
  await act(
    async () =>
      void (target as Element).dispatchEvent(
        new win.MouseEvent("click", { bubbles: true }) as never,
      ),
  );
  await settle(60);
};
const byText = (text: string, selector = "button, [role='menuitem'], [role='menuitemradio']") =>
  [...win.document.querySelectorAll(selector)].find((e) => e.textContent?.trim() === text) as
    | HTMLElement
    | undefined;
const fill = (name: string, value: string) =>
  act(async () => {
    const input = win.document.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement;
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
const submit = async (form: Element) => {
  await act(
    async () =>
      void form.dispatchEvent(
        new win.Event("submit", { bubbles: true, cancelable: true }) as never,
      ),
  );
  await settle(120);
};

const mounted: (() => Promise<void>)[] = [];
let location: () => { pathname: string; search: Record<string, unknown> } = () => ({
  pathname: "",
  search: {},
});
async function mount(what: "switcher" | "start") {
  const {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
  } = await import("@tanstack/react-router");
  const { WorkspaceSwitcher } = await import("./workspace-switcher");
  const { StartWorkspace } = await import("./start-workspace");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        {what === "switcher" ? <WorkspaceSwitcher collapsed={false} /> : <StartWorkspace />}
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/", component: () => null }),
    createRoute({ getParentRoute: () => root, path: "/dashboard", component: () => null }),
    createRoute({ getParentRoute: () => root, path: "/studio/$tab", component: () => null }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  location = () => ({
    pathname: router.state.location.pathname,
    search: router.state.location.search as Record<string, unknown>,
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const reactRoot = createRoot(host as unknown as Element);
  await act(async () => reactRoot.render(<RouterProvider router={router} />));
  await settle();
  mounted.push(() => act(async () => reactRoot.unmount()));
  return host as unknown as HTMLElement;
}

beforeEach(() => {
  workspaces = [
    { id: "w1", slug: "main", name: "Main office", role: "owner", current: true },
    { id: "w2", slug: "acme", name: "Acme", role: "member", current: false },
  ];
  mayCreate = false;
  sent.length = 0;
});
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  win.document.body.replaceChildren();
});

test("the switcher shows the workspace this tab works in, and choosing another opens its overview in it", async () => {
  const host = await mount("switcher");
  const trigger = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Main office"),
  )!;
  expect(trigger).toBeDefined();
  await click(trigger);
  const items = [...win.document.querySelectorAll("[role='menuitemradio']")];
  expect(items.map((i) => i.textContent?.trim())).toEqual(["Main office", "Acme"]);
  expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  // Only root starts a workspace.
  expect(byText("Start a workspace")).toBeUndefined();
  await click(items[1]);
  expect(location()).toEqual({ pathname: "/dashboard", search: { w: "acme" } });
});

test("a person already here joins another workspace with its invitation code, and works in it", async () => {
  joinAnswer = { status: 200, body: { workspace: { id: "w3", slug: "beta", name: "Beta" } } };
  const host = await mount("switcher");
  await click(
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Main office")),
  );
  await click(byText("Join a workspace"));
  const form = win.document.querySelector("form")!;
  await fill("token", "  an-invitation-code-for-me-0123456789  ");
  await submit(form as unknown as Element);
  expect(sent).toEqual([
    {
      method: "POST",
      path: "/api/workspace/join",
      body: { token: "an-invitation-code-for-me-0123456789" },
    },
  ]);
  expect(location()).toEqual({ pathname: "/dashboard", search: { w: "beta" } });
});

test("a refused code says why and keeps the box open", async () => {
  joinAnswer = {
    status: 400,
    body: {
      error: {
        code: "INVALID_REQUEST",
        message: "That invitation cannot be used. Ask for a new one.",
      },
    },
  };
  const host = await mount("switcher");
  await click(
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Main office")),
  );
  await click(byText("Join a workspace"));
  await fill("token", "an-invitation-code-for-me-0123456789");
  await submit(win.document.querySelector("form") as unknown as Element);
  expect(win.document.querySelector("form")?.textContent).toContain(
    "That invitation cannot be used.",
  );
  expect(location().pathname).toBe("/");
});

test("root starts a workspace from the switcher's menu, on the People page", async () => {
  mayCreate = true;
  const host = await mount("switcher");
  await click(
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Main office")),
  );
  await click(byText("Start a workspace"));
  expect(location().pathname).toBe("/studio/invites");
});

test("root names the workspace and its owner, and gets the owner's code once", async () => {
  startAnswer = {
    status: 201,
    body: {
      workspace: { id: "w9", slug: "acme-corp", name: "Acme Corp" },
      invitation: { token: "owner-code-0123456789-abcdef", expiresAt: "2030-01-01T00:00:00.000Z" },
    },
  };
  await mount("start");
  // The address name follows the name until it is changed by hand.
  await fill("name", "Acme Corp");
  expect((win.document.querySelector("[name='slug']") as unknown as HTMLInputElement).value).toBe(
    "acme-corp",
  );
  await fill("ownerEmail", "owner@example.invalid");
  await submit(win.document.querySelector("form") as unknown as Element);
  expect(sent).toEqual([
    {
      method: "POST",
      path: "/api/workspace/new",
      body: { name: "Acme Corp", slug: "acme-corp", ownerEmail: "owner@example.invalid" },
    },
  ]);
  const code = win.document.querySelector(
    "#started-workspace-token",
  ) as unknown as HTMLInputElement;
  expect(code.value).toBe("owner-code-0123456789-abcdef");
  await click(byText("Done"));
  expect(win.document.querySelector("#started-workspace-token")).toBeNull();
});

test("an address name is made from a workspace's name", async () => {
  const { slugOf } = await import("./start-workspace");
  expect(slugOf("Ação & Cia. Ltda")).toBe("acao-cia-ltda");
  expect(slugOf("  --Hello   World--  ")).toBe("hello-world");
});
