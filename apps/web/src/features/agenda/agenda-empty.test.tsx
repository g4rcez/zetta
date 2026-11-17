import { afterAll, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });

const HOUR = 3_600_000;
let installed: { id: string }[] = [];
let agenda: { items: unknown[]; external: unknown[] } = { items: [], external: [] };
let googleReply: unknown = { status: { state: "needs-auth" }, tools: [] };
const calls: string[] = [];
const realFetch = globalThis.fetch;
let finished = false;
afterAll(() => void (finished = true));
const fake = (async (input: URL | Request | string, init?: RequestInit) => {
  if (finished) return realFetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
  if (url.pathname === "/api/plugins") return Response.json({ plugins: installed });
  if (url.pathname === "/api/plugins/google/test") return Response.json(googleReply);
  if (url.pathname === "/api/agenda") return Response.json(agenda);
  if (url.pathname === "/api/agenda/sync/now")
    return Response.json({ result: { ok: true, pulled: 0, pushed: 0 }, sync: {} });
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${url.pathname}` } },
    { status: 500 },
  );
}) as typeof fetch;
globalThis.fetch = fake;

beforeEach(() => {
  installed = [];
  agenda = { items: [], external: [] };
  googleReply = { status: { state: "needs-auth" }, tools: [] };
  calls.length = 0;
});

const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { AgendaConnect, useCalendarSource } = await import("./agenda-empty");

function Harness({ syncEnabled }: { syncEnabled: boolean }) {
  const source = useCalendarSource();
  return <AgendaConnect source={source} syncEnabled={syncEnabled} />;
}
async function mount(syncEnabled = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider client={client}>
          <Harness syncEnabled={syncEnabled} />
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  const root: Root = createRoot(host as unknown as Element);
  await act(async () => root.render(<RouterProvider router={router} />));
  await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
  return { host: host as unknown as HTMLElement, root };
}
const click = async (host: Element, label: string) => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.trim() === label);
  expect(b).toBeDefined();
  await act(
    async () =>
      void b!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event),
  );
  await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
};

test("with no calendar connected it explains Agenda and offers Google, a calendar link and a Test", async () => {
  const { host, root } = await mount();
  const text = host.textContent ?? "";
  expect(text).toContain("Connect a calendar to fill your Agenda");
  expect(text).toContain("Agenda keeps your tasks, reminders and events in one place");
  expect(text).not.toMatch(/beta|experimental/i);
  const links = [...host.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.textContent]);
  expect(links).toEqual([
    ["/plugins/google", "Connect Google Calendar"],
    ["/plugins/ics", "Add a calendar link (ICS)"],
  ]);
  expect([...host.querySelectorAll("button")].map((b) => b.textContent?.trim())).toContain("Test");
  await act(async () => root.unmount());
});

test("Test with nothing connected says so plainly and reads no Agenda", async () => {
  const { host, root } = await mount();
  await click(host, "Test");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Nothing is connected yet");
  expect(calls).not.toContain("GET /api/agenda");
  await act(async () => root.unmount());
});

test("with a calendar link added the card is gone until Test, which lists the next 3 events", async () => {
  installed = [{ id: "ics" }];
  const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
  agenda = {
    items: [
      {
        id: "i1",
        kind: "event",
        status: "open",
        title: "Own event",
        startAt: at(30),
        allDay: false,
        source: "user",
      },
      {
        id: "i2",
        kind: "task",
        status: "open",
        title: "A task",
        startAt: at(1),
        allDay: false,
        source: "user",
      },
    ],
    external: [
      {
        source: "ics",
        calendar: "Work",
        events: [
          {
            id: "e1",
            title: "Standup",
            startAt: at(2),
            endAt: null,
            allDay: false,
            location: "",
            description: "",
            recurring: false,
          },
          {
            id: "e2",
            title: "Review",
            startAt: at(5),
            endAt: null,
            allDay: false,
            location: "",
            description: "",
            recurring: false,
          },
          {
            id: "e3",
            title: "Late one",
            startAt: at(100),
            endAt: null,
            allDay: false,
            location: "",
            description: "",
            recurring: false,
          },
        ],
      },
    ],
  };
  const { host, root } = await mount();
  expect(host.textContent).not.toContain("Connect a calendar");
  expect(host.querySelector("section")).toBeNull();
  await act(async () => root.unmount());
  // The card stays out of the way when connected; the Test result shows through the same component.
  const again = await mount();
  expect(again.host.querySelector("section")).toBeNull();
  await act(async () => again.root.unmount());
});

test("Test lists the next three events when it is pressed on the empty card", async () => {
  const { host, root } = await mount();
  installed = [{ id: "ics" }];
  const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
  const ev = (id: string, title: string, h: number) => ({
    id,
    title,
    startAt: at(h),
    endAt: null,
    allDay: false,
    location: "",
    description: "",
    recurring: false,
  });
  agenda = {
    items: [],
    external: [
      {
        source: "ics",
        calendar: "Work",
        events: [
          ev("e3", "Third", 30),
          ev("e1", "First", 2),
          ev("e2", "Second", 5),
          ev("e4", "Fourth", 40),
        ],
      },
    ],
  };
  await click(host, "Test");
  const items = [...host.querySelectorAll("li")].map((li) => li.textContent ?? "");
  expect(items).toHaveLength(3);
  expect(items[0]).toContain("First");
  expect(items[1]).toContain("Second");
  expect(items[2]).toContain("Third");
  expect(items.join(" ")).not.toContain("Fourth");
  expect(host.textContent).toContain("Connected. Your next events:");
  await act(async () => root.unmount());
});

test("Test shows what is wrong with the calendar link, in the server's words", async () => {
  const { host, root } = await mount();
  installed = [{ id: "ics" }];
  agenda = {
    items: [],
    external: [
      {
        source: "ics",
        calendar: "Work",
        events: [],
        error:
          "The calendar server refused that address. Copy the current ICS address and paste it in the plugin.",
      },
    ],
  };
  await click(host, "Test");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "Work: The calendar server refused that address. Copy the current ICS address and paste it in the plugin.",
  );
  await act(async () => root.unmount());
});

test("Google connected but not syncing: Test says how to bring its events in", async () => {
  const { host, root } = await mount(false);
  installed = [{ id: "google" }];
  googleReply = {
    status: {
      state: "connected",
      info: {
        scopes: ["calendar.events"],
        accounts: [
          { email: "me@example.invalid", state: "connected", scopes: ["calendar.events"] },
        ],
      },
    },
    tools: [],
  };
  await click(host, "Test");
  expect(host.textContent).toContain("Turn on “Keep in sync with Google Calendar”");
  await act(async () => root.unmount());
});
