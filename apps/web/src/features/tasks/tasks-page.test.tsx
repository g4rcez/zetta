import { afterAll, afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// The router restores the scroll position on load; the fake window has no `scrollTo`. Bun runs every test file in one process.
const savedScrollTo = Object.getOwnPropertyDescriptor(globalThis, "scrollTo");
afterAll(() => {
  if (savedScrollTo) Object.defineProperty(globalThis, "scrollTo", savedScrollTo);
  else delete (globalThis as Record<string, unknown>).scrollTo;
});
Object.assign(globalThis, { scrollTo: () => {} });

const ADA = "00000000-0000-7000-8000-00000000000a";
const BO = "00000000-0000-7000-8000-00000000000b";
const T = (n: number) => `00000000-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`;

const task = (n: number, over: Record<string, unknown>) => ({
  id: T(n),
  title: `Task ${n}`,
  description: "",
  status: "backlog",
  priority: "none",
  labels: [],
  ownerUserId: "me",
  assignee: "bot",
  assigneeUserId: null,
  assigneeName: null,
  botId: null,
  conversationId: null,
  parentTaskId: null,
  progress: "",
  followUp: "off",
  followUpReason: null,
  nextCheckAt: null,
  checks: 0,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
  ...over,
});
const TASKS = [
  task(1, {
    title: "Write the report",
    status: "in_progress",
    botId: ADA,
    progress: "Outline is done\nNext: the figures",
  }),
  task(2, { title: "Deploy the site", status: "backlog", botId: BO }),
  task(3, { title: "Old finished job", status: "done", botId: ADA }),
  task(4, {
    title: "Sign in for me",
    assignee: "person",
    assigneeUserId: "me",
    assigneeName: "Me",
    botId: ADA,
  }),
  task(5, { title: "A task of mine, no bot" }),
];
const BOTS = [ADA, BO].map((id, i) => ({
  id,
  name: ["Ada", "Bo"][i],
  kind: "specialist",
  avatar: null,
  description: "",
  canEdit: true,
}));
const STATUSES = [
  {
    botId: ADA,
    status: "working",
    reason: "Working on “Write the report” · 1 of 3 steps done",
    task: {
      id: T(1),
      title: "Write the report",
      status: "in_progress",
      stepsDone: 1,
      stepsTotal: 3,
    },
    openTasks: 2,
  },
  { botId: BO, status: "available", reason: "Online, 1 open task", task: null, openTasks: 1 },
];

globalThis.fetch = (async (input: URL | string) => {
  const path = new URL(String(input)).pathname;
  if (path === "/api/tasks") return Response.json({ tasks: TASKS });
  if (path === "/api/bots") return Response.json({ bots: BOTS });
  if (path === "/api/bots/status") return Response.json({ statuses: STATUSES });
  return Response.json(null);
}) as typeof fetch;

const { TasksPage } = await import("./tasks-page");
const { BotCurrentTask } = await import("@/components/bot-status");
const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
type Search = import("./task-filters").TaskSearch;

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  await new Promise((done) => setTimeout(done, 20));
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));
const text = () => win.document.body.textContent ?? "";

/** Renders `ui` inside a router and a query cache, then waits for the fake API to answer. */
async function show(ui: () => React.ReactElement) {
  const root = createRootRoute({ notFoundComponent: () => null, component: ui });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const reactRoot = createRoot(host as never);
  roots.push(reactRoot);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    reactRoot.render(
      (
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      ) as never,
    ),
  );
  await settle();
  await settle();
  return host as unknown as HTMLElement;
}

/** The page as the route mounts it: the address is the search, every change to it is recorded. */
const page = (search: Search, changes: Search[] = []) =>
  show(() => <TasksPage search={search} onSearch={(next) => void changes.push(next)} />);

test("the work in progress link lists only the open work of the bots, one lane per bot, with no Done lane", async () => {
  await page({ stage: "open", botIds: ["bots"], groupBy: "assignee" });
  expect(text()).toContain("Write the report");
  expect(text()).toContain("Deploy the site");
  // Done work, a task asked of a person and a task no bot owns are not a bot's work in progress.
  expect(text()).not.toContain("Old finished job");
  expect(text()).not.toContain("Sign in for me");
  expect(text()).not.toContain("A task of mine, no bot");
  const lanes = [...win.document.querySelectorAll("section[aria-label]")].map((s) =>
    s.getAttribute("aria-label"),
  );
  expect(lanes).toEqual(["Ada", "Bo"]);
  const pressed = [...win.document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Work in progress",
  );
  expect(pressed?.getAttribute("aria-pressed")).toBe("true");
});

test("a card says what the bot is doing on that very task, and shows the first line of its note", async () => {
  await page({ stage: "open", botIds: ["bots"], groupBy: "assignee" });
  const ada = win.document.querySelector('section[aria-label="Ada"]')!;
  expect(ada.textContent).toContain("Working");
  expect(ada.textContent).toContain("Outline is done");
  expect(ada.textContent).not.toContain("Next: the figures");
  // Bo is idle: nothing claims it is working.
  expect(win.document.querySelector('section[aria-label="Bo"]')!.textContent).not.toContain(
    "Working",
  );
});

test("without a stage the board keeps its Done column; the Work in progress button writes the view to the address", async () => {
  const changes: Search[] = [];
  await page({}, changes);
  expect(text()).toContain("Old finished job");
  expect(
    [...win.document.querySelectorAll("section[aria-label]")].map((s) =>
      s.getAttribute("aria-label"),
    ),
  ).toContain("Done");
  const button = [...win.document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Work in progress",
  )!;
  expect(button.getAttribute("aria-pressed")).toBe("false");
  await act(async () => void button.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  expect(changes.at(-1)).toEqual({ stage: "open", botIds: ["bots"], groupBy: "assignee" });
});

test("the bot's current task is a link to the task with its step count, and nothing for a bot without one", async () => {
  await show(() => (
    <>
      <div id="ada">
        <BotCurrentTask botId={ADA} />
      </div>
      <div id="bo">
        <BotCurrentTask botId={BO} />
      </div>
    </>
  ));
  const link = win.document.querySelector("#ada a")!;
  expect(link.getAttribute("href")).toBe(`/tasks/${T(1)}`);
  expect(link.textContent).toContain("Write the report");
  expect(link.textContent).toContain("1/3 steps");
  expect(win.document.querySelector("#bo")!.textContent).toBe("");
});
