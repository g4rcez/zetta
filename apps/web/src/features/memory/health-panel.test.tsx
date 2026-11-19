import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// Loaded after the DOM exists: the library reads `document` when it is first imported.
const { HealthPanel } = await import("./health-panel");
(globalThis as { scrollTo?: () => void }).scrollTo = () => {};

const calls: { path: string; method: string; body: unknown }[] = [];
const checks = {
  brokenLinks: [],
  unlinked: [{ slug: "alone", title: "Alone item", status: "current" }],
  old: [{ slug: "aged", title: "Aged item", status: "current" }],
  stale: [{ slug: "doubted", title: "Doubted item", status: "stale" }],
  unsourced: [{ slug: "loose", title: "Loose item", status: "current" }],
  openSuggestions: 0,
};
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  const method = init?.method ?? "GET";
  calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  if (path === "/api/memory-checks") return Response.json({ checks, jobs: [] });
  if (method === "PATCH" || path.endsWith("/confirm"))
    return Response.json({ slug: "x", version: 1, status: "current" });
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${method} ${path}` } },
    { status: 500 },
  );
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));
const buttons = () => [...win.document.querySelectorAll("button")];
const press = async (label: string, nth = 0) => {
  const b = buttons().filter((x) => x.textContent?.trim() === label)[nth]!;
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const rowOf = (title: string) =>
  [...win.document.querySelectorAll("li")].find((li) =>
    li.textContent?.includes(title),
  ) as unknown as Element;
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
  });
const labelsIn = (el: Element) =>
  [...el.querySelectorAll("button, a")].map((x) => x.textContent?.trim());

test("every flagged item can be deleted from the list, and the quick actions fit the problem", async () => {
  const root = createRootRoute({ component: () => <HealthPanel bots={[]} /> });
  const stub = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => <p>{path}</p> });
  const router = createRouter({
    routeTree: root.addChildren([stub("/memory"), stub("/memory/$slug")]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const mounted = createRoot(host as unknown as Element);
  await act(async () => {
    mounted.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
  });
  await settle();

  expect(labelsIn(rowOf("Doubted item"))).toEqual([
    "Doubted item",
    "Still true",
    "Tidy with help",
    "Delete",
  ]);
  expect(labelsIn(rowOf("Aged item"))).toEqual([
    "Aged item",
    "Still true",
    "Mark stale",
    "Review",
    "Delete",
  ]);
  expect(labelsIn(rowOf("Alone item"))).toEqual(["Alone item", "Suggest links", "Delete"]);
  expect(labelsIn(rowOf("Loose item"))).toEqual(["Loose item", "Delete"]);

  // "Still true" confirms the item without a new version.
  await click(
    [...rowOf("Aged item").querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Still true",
    )!,
  );
  await settle();
  expect(calls.some((c) => c.method === "POST" && c.path === "/api/memory/aged/confirm")).toBe(
    true,
  );

  // Delete asks first, then archives; the way back restores the status the item had.
  await click(
    [...rowOf("Doubted item").querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Delete",
    )!,
  );
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  await press("Delete", 0); // the destructive button of the question
  const archived = calls.filter((c) => c.method === "PATCH");
  expect(archived.at(-1)).toMatchObject({
    path: "/api/memory/doubted",
    body: { status: "archived" },
  });
  expect(win.document.body.textContent).toContain("Deleted “Doubted item”.");
  await press("Undo");
  expect(calls.filter((c) => c.method === "PATCH").at(-1)).toMatchObject({
    path: "/api/memory/doubted",
    body: { status: "stale" },
  });

  await act(async () => mounted.unmount());
  host.remove();
});
