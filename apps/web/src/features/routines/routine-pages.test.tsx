import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// Bun's own FormData cannot read a DOM form; the pages use the browser's.
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.FormData = bunFormData;
});

const R1 = "00000000-0000-7000-8000-000000000001";
const R2 = "00000000-0000-7000-8000-000000000002";
const CHAT = "00000000-0000-7000-8000-0000000000c1";

const bots = [
  { id: "b1", name: "Digest bot", kind: "specialist", role: "Weekly reports" },
  { id: "b2", name: "Zetta", kind: "chief" },
];
const base = {
  botId: "b1",
  prompt: "Write it.",
  timezone: "UTC",
  dailyAt: "08:44",
  weekdays: [1, 2, 3, 4, 5],
  everyMinutes: null,
  kind: "recurring",
  version: 3,
  nextRunAt: "2030-01-07T08:44:00.000Z",
  lastRunAt: null,
};
let routines: Record<string, unknown>[] = [];

type Call = { path: string; method: string; body: any };
let calls: Call[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const ok = (v: unknown, status = 200) => Response.json(v, { status });
  calls.push({ path: url.pathname, method, body });
  if (url.pathname === "/api/bots") return ok({ bots });
  if (url.pathname === "/api/routines" && method === "GET") return ok({ routines });
  if (url.pathname === "/api/routines" && method === "POST")
    return ok({ routine: { id: R2, paused: false, ...body } }, 201);
  if (url.pathname.endsWith("/summary"))
    return ok({
      summary: {
        task: "Write it.",
        bot: "Digest bot",
        schedule: "weekdays at 08:44",
        timezone: "UTC",
        nextRuns: ["2030-01-07T08:44:00.000Z"],
        contextMode: "One chat",
        accounts: [],
        destination: "Its chat",
        missing: [],
        version: 3,
      },
    });
  if (url.pathname.endsWith("/runs")) return ok({ runs: [], nextBefore: null });
  if (url.pathname.endsWith("/triggers")) return ok({ triggers: [] });
  if (url.pathname === "/api/workflows") return ok({ workflows: [] });
  if (/^\/api\/routines\/[^/]+$/.test(url.pathname) && method === "PATCH")
    return ok({ routine: { id: R1, ...body } });
  if (url.pathname === "/api/routines/timeline") return ok({ runs: [] });
  return ok({});
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const text = () => win.document.body.textContent ?? "";
const click = async (target: unknown, what: string) => {
  const el = target as Element | null | undefined;
  if (!el) throw new Error(`no ${what} in: ${text().slice(0, 400)}`);
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, button: 0 }) as never);
  });
  await settle();
};
const byLabel = (label: string) => win.document.querySelector(`[aria-label="${label}"]`);
const press = (label: string) =>
  click(
    [...win.document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === label,
    ) as unknown as Element,
    `button "${label}"`,
  );
const fill = (name: string, value: string) => {
  const el = win.document.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement | null;
  if (!el) throw new Error(`no field ${name}`);
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
};
const send = async (label: string) => {
  const form = win.document.querySelector(`form[aria-label="${label}"]`);
  if (!form) throw new Error(`no form ${label}`);
  await act(
    async () =>
      void form.dispatchEvent(
        new win.Event("submit", { bubbles: true, cancelable: true }) as never,
      ),
  );
  await settle();
};
const lastCall = (path: string, method?: string) =>
  calls.filter((c) => c.path === path && (!method || c.method === method)).at(-1);
const menuItems = () =>
  [...win.document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((i) =>
    i.textContent?.trim(),
  );

/** Mounts `element` at "/" in a router that also knows the pages the code navigates to. */
async function mount(element: (mods: typeof import("./routines")) => ReactNode, start = "/") {
  win.document.body.replaceChildren();
  calls = [];
  // Imported here, after the fake window exists (see the note in features/bots/grok-import.test.tsx).
  const { createRoot } = await import("react-dom/client");
  const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const mods = await import("./routines");
  const root = createRootRoute();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <QueryClientProvider client={qc}>{element(mods)}</QueryClientProvider>,
  });
  const detail = createRoute({
    getParentRoute: () => root,
    path: "/routines/$routineId",
    component: () => <p>THE ROUTINE PAGE</p>,
  });
  const created = createRoute({
    getParentRoute: () => root,
    path: "/routines/new",
    component: () => <p>THE NEW ROUTINE PAGE</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([index, detail, created]),
    history: createMemoryHistory({ initialEntries: [start] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const reactRoot = createRoot(host as unknown as Element);
  await act(async () => reactRoot.render(<RouterProvider router={router} />));
  await settle();
  return { router };
}

async function mountList() {
  const { Routines } = await import("./routines");
  const { NO_SEARCH } = { NO_SEARCH: {} };
  return mount(() => (
    <Routines bots={bots as never} onError={() => {}} search={NO_SEARCH} setSearch={() => {}} />
  ));
}

test("a row shows the title, status, the bot with its role, the schedule, the next run and Run now", async () => {
  routines = [{ ...base, id: R1, title: "Digest", paused: false, conversationId: CHAT }];
  await mountList();
  const row = win.document.getElementById(`routine-row-${R1}`)!;
  expect(row.textContent).toContain("Digest");
  expect(row.textContent).toContain("Scheduled");
  expect(row.textContent).toContain("Digest bot");
  expect(row.textContent).toContain("Weekly reports");
  expect(row.textContent).toContain("weekdays");
  expect(row.textContent).toContain("Next run");
  const buttons = [...row.querySelectorAll("button")].map((b) => b.textContent?.trim());
  expect(buttons).toContain("Run now");
  // Nothing else is a visible button except the one menu trigger: no History, Triggers, Edit, Pause, Delete or Open chat.
  expect(buttons.filter(Boolean)).toEqual(["Run now"]);
  expect(row.querySelectorAll("form")).toHaveLength(0);
});

test("a bot without a written role shows the kind of bot it is", async () => {
  routines = [{ ...base, id: R1, title: "Digest", paused: false, botId: "b2" }];
  await mountList();
  const row = win.document.getElementById(`routine-row-${R1}`)!;
  expect(row.textContent).toContain("Zetta");
  expect(row.textContent).toContain("Chief");
});

test("Run now starts the run", async () => {
  routines = [{ ...base, id: R1, title: "Digest", paused: false }];
  await mountList();
  await press("Run now");
  const run = lastCall(`/api/routines/${R1}/run`, "POST")!;
  expect(run.body).toMatchObject({ wait: "start" });
});

test("More actions holds every other action of an active routine", async () => {
  routines = [{ ...base, id: R1, title: "Digest", paused: false, conversationId: CHAT }];
  await mountList();
  const trigger = byLabel("More actions for Digest");
  expect(trigger).toBeTruthy();
  await click(trigger, "the More actions button");
  expect(menuItems()).toEqual(["Open chat", "History", "Triggers", "Edit", "Pause", "Delete"]);
});

test("a paused routine's menu offers Activate in place of Pause, and a routine with no chat cannot open one", async () => {
  routines = [{ ...base, id: R1, title: "Digest", paused: true, conversationId: null }];
  await mountList();
  await click(byLabel("More actions for Digest"), "the More actions button");
  expect(menuItems()).toEqual(["Open chat", "History", "Triggers", "Edit", "Activate…", "Delete"]);
  const chat = win.document.querySelector('[role="menuitem"]') as unknown as HTMLElement;
  expect(chat.getAttribute("aria-disabled") === "true" || chat.hasAttribute("disabled")).toBe(true);
});

test("Pause in the menu pauses the routine", async () => {
  routines = [{ ...base, id: R1, title: "Digest", paused: false }];
  await mountList();
  await click(byLabel("More actions for Digest"), "the More actions button");
  const pause = [...win.document.querySelectorAll('[role="menuitem"]')].find(
    (i) => i.textContent?.trim() === "Pause",
  );
  await click(pause, "the Pause item");
  expect(lastCall(`/api/routines/${R1}/paused`, "POST")!.body).toEqual({ paused: true });
});

test("Activate in the menu opens the card of what is missing under the row", async () => {
  routines = [{ ...base, id: R1, title: "Digest", paused: true }];
  await mountList();
  await click(byLabel("More actions for Digest"), "the More actions button");
  const item = [...win.document.querySelectorAll('[role="menuitem"]')].find(
    (i) => i.textContent?.trim() === "Activate…",
  );
  await click(item, "the Activate item");
  expect(byLabel("Before you activate")).toBeTruthy();
});

test("New routine is a link to the create page, and the list has no create form", async () => {
  routines = [];
  await mountList();
  const link = [...win.document.querySelectorAll("a")].find((a) =>
    a.textContent?.includes("New routine"),
  );
  expect(link?.getAttribute("href")).toBe("/routines/new");
  expect(win.document.querySelector('form[aria-label="New routine"]')).toBeNull();
  await click(link, "the New routine link");
  expect(text()).toContain("THE NEW ROUTINE PAGE");
});

test("the create page submits the form and opens the new routine's page", async () => {
  routines = [];
  const { NewRoutinePage } = await import("./new-routine-page");
  await mount(() => <NewRoutinePage />);
  expect(win.document.querySelector("h1")?.textContent).toBe("New routine");
  fill("title", "Digest");
  fill("scheduleText", "Monday to Friday at 8:30");
  await send("New routine");
  const made = lastCall("/api/routines", "POST")!;
  expect(made.body).toMatchObject({
    title: "Digest",
    when: "Monday to Friday at 8:30",
    activate: "on",
  });
  expect(text()).toContain("THE ROUTINE PAGE");
});

test("the routine page edits through the same form, and saving sends the change", async () => {
  routines = [{ ...base, id: R1, title: "Digest", paused: false }];
  const { RoutinePage } = await import("./routine-page");
  await mount(() => <RoutinePage routineId={R1} />);
  expect(win.document.querySelector('form[aria-label="Edit Digest"]')).toBeNull();
  await press("Edit");
  expect(win.document.querySelector('form[aria-label="Edit Digest"]')).toBeTruthy();
  fill("title", "Digest daily");
  await send("Edit Digest");
  const patched = lastCall(`/api/routines/${R1}`, "PATCH")!;
  expect(patched.body).toMatchObject({
    expectedVersion: 3,
    title: "Digest daily",
    dailyAt: "08:44",
    botId: "b1",
  });
  // The page shows the bot with its role, not only its name.
  expect(text()).toContain("Weekly reports");
});

test("?edit=on opens the routine page with the form showing", async () => {
  routines = [{ ...base, id: R1, title: "Digest", paused: false }];
  const { RoutinePage } = await import("./routine-page");
  await mount(() => <RoutinePage routineId={R1} edit="on" />);
  expect(win.document.querySelector('form[aria-label="Edit Digest"]')).toBeTruthy();
});

test("the Behavior form is under Advanced, folded in Simple, with the sections History and Triggers linkable", async () => {
  routines = [{ ...base, id: R1, title: "Digest", paused: false }];
  const { RoutinePage } = await import("./routine-page");
  await mount(() => <RoutinePage routineId={R1} />);
  const details = [...win.document.querySelectorAll('[data-component="advanced-section"]')].find(
    (d) => d.querySelector('[name="overlapPolicy"]'),
  )!;
  expect(details).toBeTruthy();
  expect(details.hasAttribute("open")).toBe(false);
  expect(win.document.getElementById("routine-runs")).toBeTruthy();
  expect(win.document.getElementById("routine-triggers")).toBeTruthy();
});
