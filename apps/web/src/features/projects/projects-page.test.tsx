import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// The router restores scroll on load; the test DOM has no `scrollTo`.
Object.assign(globalThis, { scrollTo: () => {} });

const BOT = "01a19da2-3c92-783a-b90d-c35975f3c60c";
const P = (n: number) => `01a1ce15-6b98-7fa6-a72d-0885e1cc51${String(n).padStart(2, "0")}`;
const counts = (done: number, total: number) => ({
  backlog: 0,
  in_progress: total - done,
  blocked: 0,
  review: 0,
  done,
  total,
});
const project = (n: number, name: string, over: object = {}) => ({
  id: P(n),
  name,
  outcome: "",
  audience: "",
  doneWhen: "",
  notIncluded: "",
  labels: [],
  status: "active",
  watch: "normal",
  role: "owner",
  bots: [{ id: BOT, name: "Dev Bot" }],
  people: [{ userId: "u1", name: "Ana" }],
  counts: counts(1, 3),
  health: { state: "on_track", sentence: "2 in progress. 1 of 3 done." },
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
  ...over,
});
const task = (id: string, title: string, over: object = {}) => ({
  id,
  title,
  status: "in_progress",
  priority: "none",
  assignee: "bot",
  assigneeUserId: null,
  assigneeName: null,
  botId: BOT,
  progress: "",
  followUp: "off",
  updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
  stepsDone: 2,
  stepsTotal: 5,
  canOpen: true,
  canTell: true,
  ...over,
});

let projects: unknown[] = [];
let unfiled = { total: 0, open: 0 };
let detail: unknown;
let draft: unknown = { kind: "unavailable", reason: "This needs a chief bot. Create one first." };
let writes: { call: string; body: unknown }[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (method !== "GET") {
    writes.push({
      call: `${method} ${url.pathname}`,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.pathname === "/api/projects/draft") return Response.json(draft);
    if (url.pathname.endsWith("/work"))
      return Response.json({ task: { id: "t9", title: "x" }, conversationId: null });
    return Response.json({ project: detail ?? project(9, "Made") });
  }
  if (url.pathname === "/api/projects") return Response.json({ projects, unfiled });
  if (url.pathname === "/api/projects/candidates")
    return Response.json({
      bots: [{ id: BOT, name: "Dev Bot" }],
      people: [{ userId: "u1", name: "Ana" }],
      rooms: [{ id: P(50), title: "Launch room", projectId: null }],
    });
  if (url.pathname.startsWith("/api/projects/")) return Response.json({ project: detail });
  if (url.pathname === "/api/bots")
    return Response.json({ bots: [{ id: BOT, name: "Dev Bot", kind: "specialist" }] });
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  projects = [];
  unfiled = { total: 0, open: 0 };
  detail = undefined;
  writes = [];
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const mount = async (page: () => Promise<ReactNode>) => {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const node = await page();
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          {node}
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
const list = (search: object = {}) =>
  mount(async () => {
    const { ProjectsPage } = await import("./projects-page");
    return <ProjectsPage search={search} onSearch={() => {}} />;
  });
const page = () =>
  mount(async () => {
    const { ProjectPage } = await import("./project-page");
    return <ProjectPage id={P(1)} />;
  });
const text = (host: HTMLElement) => host.textContent ?? "";
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
const click = async (el: Element | undefined) => {
  await act(
    async () => void el!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
};
/** Words that belong to the code, not to a manager. None of them may reach a project screen. */
const INTERNAL = /follow-up|followUp|stall|heartbeat|drift|fingerprint|paused|backlog\b/i;

test("with no project the page explains what one is and offers to make the first", async () => {
  unfiled = { total: 5, open: 3 };
  const host = await list();
  expect(text(host)).toContain("You have no project yet");
  expect(button(host, "Create your first project")).toBeDefined();
  // Work outside every project is never hidden.
  expect(text(host)).toContain("Not in a project: 3 tasks still open");
});

test("the list says where each project stands, what needs the reader first", async () => {
  projects = [
    project(1, "Website", {}),
    project(2, "Spring launch", {
      health: { state: "needs_you", sentence: "2 tasks are waiting on you. 1 of 5 done." },
      labels: ["q2"],
    }),
    project(3, "Old idea", {
      status: "archived",
      health: { state: "done", sentence: "Archived." },
    }),
  ];
  unfiled = { total: 2, open: 1 };
  const host = await list();
  const rows = [...host.querySelectorAll("li")].map((li) => li.textContent ?? "");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain("Spring launch");
  expect(rows[0]).toContain("Needs you");
  expect(rows[0]).toContain("2 tasks are waiting on you. 1 of 5 done.");
  expect(rows[1]).toContain("Website");
  expect(rows[1]).toContain("On track");
  // Who is on it is read out by name.
  expect(rows[1]).toContain("Dev Bot, Ana");
  expect(text(host)).toContain("Not in a project: 1 task still open");
  expect(text(host)).not.toMatch(INTERNAL);
});

test("the filters come from the address", async () => {
  projects = [
    project(1, "Website", { labels: ["web"] }),
    project(2, "Spring launch", { labels: ["q2"] }),
    project(3, "Old idea", {
      status: "archived",
      health: { state: "done", sentence: "Archived." },
    }),
  ];
  const names = (host: HTMLElement) =>
    [...host.querySelectorAll("li")].map((li) => li.querySelector(".font-medium")?.textContent);
  expect(names(await list({ show: "archived" }))).toEqual(["Old idea"]);
  expect(names(await list({ query: "spring" }))).toEqual(["Spring launch"]);
  expect(names(await list({ label: "web" }))).toEqual(["Website"]);
  const none = await list({ query: "nothing like it" });
  expect(text(none)).toContain("No project matches");
});

test("the project page answers a manager in order: standing, what waits, who does what, what is done", async () => {
  detail = project(1, "Spring launch", {
    outcome: "A launch page",
    health: { state: "needs_you", sentence: "1 task is waiting on you. 1 of 4 done." },
    counts: counts(1, 4),
    tasks: [
      task("t1", "Write the page"),
      task("t2", "Legal text", { status: "blocked", stepsTotal: 0, followUp: "paused" }),
      task("t3", "Price list", {
        assignee: "person",
        assigneeUserId: "u1",
        assigneeName: "Ana",
        botId: null,
        status: "backlog",
        stepsTotal: 0,
      }),
    ],
    shipped: [task("t4", "Pick the colors", { status: "done" })],
    needsYou: [
      {
        taskId: "t2",
        title: "Legal text",
        why: "blocked",
        text: "waiting for the legal text",
        cardId: null,
        kind: null,
        botId: BOT,
        assigneeName: null,
      },
    ],
    rooms: [],
    memory: {
      items: [
        {
          slug: "launch-tone",
          title: "Launch tone",
          howto: "Read before writing copy",
          updatedAt: new Date(Date.now() - 7_200_000).toISOString(),
        },
      ],
      total: 3,
    },
  });
  const host = await page();
  const body = text(host);
  const order = [
    "Needs you",
    "In progress",
    "Done this week",
    "Ask for something",
    "The brief",
    "Project memory",
    "Who works on it",
    "Settings",
  ];
  const at = order.map((title) => body.indexOf(title));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(body).toContain("1 task is waiting on you. 1 of 4 done.");
  expect(body).toContain("waiting for the legal text");
  expect(body).toContain("With Dev Bot");
  expect(body).toContain("2 of 5 steps");
  expect(body).toContain("Stopped");
  expect(body).toContain("Pick the colors");
  expect(body).toContain("Launch tone");
  expect(host.querySelector('a[href="/memory/launch-tone"]')).not.toBeNull();
  expect(body).toContain("See all in Memory");
  // The manager can write about any task to whoever does it, by name for a person.
  expect(button(host, "Tell it…")).toBeDefined();
  expect(button(host, "Tell Ana…")).toBeDefined();
  await click(button(host, "Tell Ana…"));
  expect(text(host)).not.toMatch(INTERNAL);
  expect(button(host, "Send")).toBeDefined();
  expect(host.querySelector('[aria-label="What to tell Ana about Price list"]')).not.toBeNull();
  // The work is grouped by who does it, people and bots alike.
  const groups = [...host.querySelectorAll("section[aria-label]")].map((s) =>
    s.getAttribute("aria-label"),
  );
  expect(groups).toContain("Dev Bot");
  expect(groups).toContain("Ana");
  expect(body).not.toMatch(INTERNAL);
});

test("a person who is not the owner reads the project without the flags or anything to change", async () => {
  detail = project(1, "Spring launch", {
    role: "member",
    outcome: "A launch page",
    tasks: [task("t1", "Write the page", { canOpen: false, canTell: false })],
    shipped: [],
    needsYou: [],
    rooms: [],
    memory: { items: [], total: 0 },
  });
  const host = await page();
  const body = text(host);
  expect(body).toContain("Write the page");
  expect(body).toContain("A launch page");
  for (const hidden of [
    "Needs you",
    "Ask for something",
    "Project memory",
    "Who works on it",
    "Settings",
  ])
    expect(body).not.toContain(hidden);
  // A task of somebody else is a name, not a link.
  expect(host.querySelector('a[href*="/tasks/"]')).toBeNull();
  expect(host.querySelectorAll("button")).toHaveLength(0);
});

test("with nobody on the project, asking explains what to do first", async () => {
  detail = project(1, "Empty", {
    bots: [],
    people: [],
    counts: counts(0, 0),
    health: { state: "quiet", sentence: "Nothing has been asked for yet." },
    tasks: [],
    shipped: [],
    needsYou: [],
    rooms: [],
    memory: { items: [], total: 0 },
  });
  const host = await page();
  expect(text(host)).toContain("Nothing has been asked for yet.");
  expect(text(host)).toContain("Add a bot or a person to this project");
  expect(button(host, "Ask")).toBeUndefined();
});

test("a new project needs only a name, and a failed draft leaves the form usable", async () => {
  const host = await mount(async () => {
    const { NewProjectPage } = await import("./new-project-page");
    return <NewProjectPage />;
  });
  expect(text(host)).toContain("Only the name is needed");
  for (const question of [
    "What should exist when this is done?",
    "Who is it for?",
    "How will we know it is done?",
    "What is not included?",
  ])
    expect(text(host)).toContain(question);
  // People and bots are picked by name, from what the owner has.
  expect(text(host)).toContain("Dev Bot");
  expect(text(host)).toContain("Ana");
  await click(button(host, "Draft the answers for me"));
  expect(text(host)).toContain("Give the project a name and say what you want first.");
  expect(writes).toEqual([]);
  await click(button(host, "Create project"));
  expect(text(host)).toContain("Give the project a name.");
  expect(writes).toEqual([]);
});
