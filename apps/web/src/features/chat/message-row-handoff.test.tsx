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
const { BotsContext } = await import("@/components/bot-identity");
const { createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider } =
  await import("@tanstack/react-router");

const DEV = "00000000-0000-7000-8000-000000000001";
const CHIEF = "00000000-0000-7000-8000-000000000002";

const row = {
  id: "m1",
  role: "assistant",
  botId: CHIEF,
  content: `Merging now.\n\n📋 Assigned [@Dev](bot:${DEV}): “Merge PR 74”.`,
  status: "done",
  createdAt: "2026-11-06T17:06:00.000Z",
  meta: {
    receipts: [
      {
        kind: "task",
        id: "t1",
        text: "Merge PR 74",
        created: true,
        assignee: { botId: DEV, name: "Dev" },
        doneWhen: "merge SHA on main",
      },
      { kind: "task", id: "t2", text: "A plain task", created: true },
    ],
  },
} as never;

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  await new Promise((done) => setTimeout(done, 20));
});

async function mount() {
  const root = createRootRoute({
    notFoundComponent: () => null,
    component: () => (
      // The member was "Dev" when the task was handed over and is "Leo" now: the card shows the current name.
      <BotsContext.Provider value={new Map([[DEV, { id: DEV, name: "Leo" }]]) as never}>
        <MessageRow
          row={row}
          author={{ name: "Zetta", bot: { id: CHIEF, name: "Zetta" } } as never}
          continued={false}
          onReact={() => {}}
          onReply={() => {}}
          onSaveToMemory={() => {}}
        />
        <Outlet />
      </BotsContext.Provider>
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

test("a task handed to a member is a card with the member, the task and what done looks like; other receipts stay chips", async () => {
  const host = await mount();
  const handoffs = host.querySelector('ul[aria-label="Work handed to members"]')!;
  expect(handoffs.querySelectorAll("li")).toHaveLength(1);
  expect(handoffs.textContent).toContain("Leo");
  expect(handoffs.textContent).toContain("Merge PR 74");
  expect(handoffs.textContent).toContain("Done when: merge SHA on main");
  // The handoff opens its own task, not the whole list.
  expect(handoffs.querySelector("a")?.getAttribute("href")).toBe("/tasks/t1");
  const chips = host.querySelector('ul[aria-label="What the bot saved"]')!;
  expect(chips.textContent).toContain("A plain task");
  expect(chips.textContent).not.toContain("Merge PR 74");
  expect(chips.querySelector("a")?.getAttribute("href")).toBe("/tasks/t2");
});

test("the 📋 note folds into the actions line instead of staying in the text", async () => {
  const host = await mount();
  expect(host.textContent).toContain("Merging now.");
  expect(host.textContent).not.toContain("📋");
});
