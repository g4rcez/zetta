import { afterAll, afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// The router restores the scroll position on load; the fake window has no `scrollTo`. Bun runs every test file in one process, so put it back.
const savedScrollTo = Object.getOwnPropertyDescriptor(globalThis, "scrollTo");
afterAll(() => {
  if (savedScrollTo) Object.defineProperty(globalThis, "scrollTo", savedScrollTo);
  else delete (globalThis as Record<string, unknown>).scrollTo;
});
Object.assign(globalThis, {
  scrollTo: () => {},
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
const { MessageRow } = await import("./message-row");
const { createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider } =
  await import("@tanstack/react-router");

const CHIEF = "00000000-0000-7000-8000-000000000002";

const baseRow = {
  id: "m1",
  role: "assistant",
  botId: CHIEF,
  content: "Done.",
  status: "done",
  createdAt: "2026-11-06T17:06:00.000Z",
  meta: {
    receipts: [
      { kind: "task", id: "t1", text: "components #67: tags", created: false },
      { kind: "task", id: "t2", text: "components: UX/a11y review", created: false },
      { kind: "task", id: "t3", text: "components: test coverage", created: false },
      { kind: "task", id: "t4", text: "Choquei: artefatos do dia", created: false },
      { kind: "task", id: "t5", text: "A brand new task", created: true },
    ],
  },
} as never;

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  row = baseRow;
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  await new Promise((done) => setTimeout(done, 20));
});

let row: never = baseRow;

async function mount() {
  const root = createRootRoute({
    notFoundComponent: () => null,
    component: () => (
      <>
        <MessageRow
          row={row}
          author={{ name: "Zetta", bot: { id: CHIEF, name: "Zetta" } } as never}
          continued={false}
          onReact={() => {}}
          onReply={() => {}}
          onSaveToMemory={() => {}}
        />
        <Outlet />
      </>
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const reactRoot = createRoot(host as never);
  roots.push(reactRoot);
  await act(async () =>
    reactRoot.render(
      (
        <QueryClientProvider client={new QueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      ) as never,
    ),
  );
  return host as unknown as HTMLElement;
}

test("a bulk update is one chip with the icon, and it opens to list the tasks", async () => {
  const host = await mount();
  const chips = host.querySelector('ul[aria-label="What the bot saved"]')!;
  const group = chips.querySelector("details")!;
  expect(group.querySelector("summary")!.textContent?.trim()).toBe("updated 4 tasks");
  // The summary has the icon; the four titles are inside, as links to each task.
  expect(group.querySelector("summary svg")).not.toBeNull();
  const links = [...group.querySelectorAll("ul a")];
  expect(links.map((a) => a.getAttribute("href"))).toEqual([
    "/tasks/t1",
    "/tasks/t2",
    "/tasks/t3",
    "/tasks/t4",
  ]);
  expect(links[1]!.textContent).toBe("components: UX/a11y review");
  // The word "updated" is on screen once, not once per task.
  const summaries = [...chips.querySelectorAll("summary")].map((s) => s.textContent?.trim());
  expect(summaries.filter((s) => s?.startsWith("updated"))).toHaveLength(1);
  // The one task that was added keeps its own chip.
  expect(chips.querySelector(":scope > li > a")?.textContent).toContain("A brand new task");
});

test("every fold in a reply reads the same: the caret first, then an icon, then the words", async () => {
  row = {
    ...(baseRow as object),
    content: "Done.\n\n📋 Read the task board.\n\n🔎 Read the project list.",
    meta: {
      ...((baseRow as { meta: object }).meta as object),
      used: { notes: ["a note"], docs: [{ docId: "d1", chunkId: "c1" }] },
    },
  } as never;
  const host = await mount();
  const summaries = [...host.querySelectorAll("details > summary")];
  const labels = summaries.map((s) => s.textContent?.trim());
  expect(labels).toEqual(["2 actions", "updated 4 tasks", "Used 1 note", "1 source"]);
  for (const summary of summaries) {
    const parts = [...summary.children];
    // Same three parts in the same order: caret, icon, label.
    expect(parts).toHaveLength(3);
    expect(parts[0]!.tagName.toLowerCase()).toBe("svg");
    expect(parts[1]!.querySelector("svg")).not.toBeNull();
    expect(parts[2]!.textContent?.trim()).not.toBe("");
  }
});
