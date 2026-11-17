import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });
// The page asks which side of the screen to open the details on.
(win as unknown as { matchMedia: unknown }).matchMedia = () => ({
  matches: true,
  addEventListener() {},
  removeEventListener() {},
});

const ROOM = "01a1ce15-6b98-7fa6-a72d-0885e1cc5201";
const CONV = "01a1ce15-6b98-7fa6-a72d-0885e1cc5202";
const BOT = "01a1ce15-6b98-7fa6-a72d-0885e1cc5203";
const room = (over: object = {}) => ({
  id: ROOM,
  conversationId: CONV,
  title: "Launch page",
  goal: "Ship the **launch** page by Friday.\nSecond line that the header does not show.",
  context: "Read [the brief](https://example.invalid/brief) first.\n\n- the logo is final",
  contextVersion: 3,
  status: "open",
  kind: "room",
  tainted: false,
  turnsUsed: 0,
  summary: "",
  progressPercent: null,
  progressNote: "",
  progressBotId: null,
  progressAt: null,
  version: 7,
  createdByBotId: null,
  teamId: null,
  originConversationId: null,
  originInbound: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  ...over,
});
let current = room();
let owner = "u1";
let writes: { call: string; body: unknown }[] = [];
globalThis.fetch = (async (input: URL | string | Request, init?: RequestInit) => {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (url.pathname === "/api/auth/get-session")
    return Response.json({
      session: { id: "s1", userId: "u1", token: "t", expiresAt: "2030-01-01T00:00:00Z" },
      user: {
        id: "u1",
        name: "Ana Souza",
        email: "ana@example.invalid",
        emailVerified: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    });
  if (url.pathname === `/api/discussions/${ROOM}` && method === "GET")
    return Response.json({
      discussion: current,
      owner: { userId: owner, name: owner === "u1" ? "Ana Souza" : "Rui Lima" },
      members: [{ botId: BOT, name: "Scribe", role: "", code: false, requireApproval: false }],
      turns: [],
      routines: [],
    });
  if (url.pathname === `/api/discussions/${ROOM}` && method === "PATCH") {
    writes.push({ call: `PATCH ${url.pathname}`, body: JSON.parse(String(init?.body)) });
    return Response.json({ discussion: current });
  }
  if (url.pathname === "/api/discussions" && method === "POST") {
    writes.push({ call: "POST /api/discussions", body: JSON.parse(String(init?.body)) });
    return Response.json({ discussion: current });
  }
  if (url.pathname === "/api/bots")
    return Response.json({
      bots: [
        { id: BOT, name: "Scribe", kind: "specialist", onboarded: true, description: "Writes" },
      ],
    });
  if (url.pathname === "/api/teams") return Response.json({ teams: [] });
  if (url.pathname === "/api/discussions") return Response.json({ discussions: [] });
  if (url.pathname.endsWith("/messages")) return Response.json({ messages: [] });
  if (url.pathname.startsWith("/api/proposals")) return Response.json({ proposals: [] });
  return Response.json({}, { status: 200 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  current = room();
  owner = "u1";
  writes = [];
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 120))));
const mount = async (page: () => Promise<ReactNode>) => {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const node = await page();
  const { SidebarDataProvider } = await import("../chat/sidebar-data");
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <SidebarDataProvider>{node}</SidebarDataProvider>
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
const text = (host: HTMLElement) => host.textContent ?? "";
const click = async (el: Element | undefined) => {
  await act(
    async () => void el!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
};
const settings = () =>
  mount(async () => {
    const { RoomSettingsPage } = await import("./room-settings");
    return <RoomSettingsPage roomId={ROOM} />;
  });
const roomPage = () =>
  mount(async () => {
    const { RoomsPage } = await import("./discussions-page");
    return <RoomsPage selectedId={ROOM} />;
  });

test("the header shows the first line of the goal, and clicking it opens the details", async () => {
  const host = await roomPage();
  const line = host.querySelector('button[aria-label^="What this room is for:"]');
  expect(line).not.toBeNull();
  // One line, in plain words: no Markdown marks, no second line.
  expect(line!.textContent).toBe("Ship the launch page by Friday.");
  expect(host.querySelector("header")!.textContent).not.toContain("Second line");
});

test("the details read as Markdown: clickable links, the new labels, and no form", async () => {
  const host = await roomPage();
  const aside = host.querySelector('aside[aria-label="Room details"]')!;
  expect(aside).not.toBeNull();
  const t = aside.textContent ?? "";
  expect(t).toContain("What this room is for");
  expect(t).toContain("Details and references (bots read this)");
  expect(t).not.toContain("Room context");
  // Markdown became markup: bold text and a list, and the link is a control with the label as its text.
  expect(aside.querySelector('[data-streamdown="strong"]')?.textContent).toBe("launch");
  expect(aside.querySelectorAll("li").length).toBeGreaterThanOrEqual(1);
  const link = [...aside.querySelectorAll('[data-streamdown="link"]')].find(
    (a) => a.textContent === "the brief",
  );
  expect(link).toBeDefined();
  // The details are read only: no text box in them.
  expect(aside.querySelectorAll("textarea, input[type='text'], .cm-editor")).toHaveLength(0);
  // Following the link asks first, then opens it in a new tab. `noreferrer` also implies `noopener`, so the site gets no handle on the page.
  const opened: unknown[][] = [];
  const open = win.open;
  (win as unknown as { open: unknown }).open = (...args: unknown[]) => void opened.push(args);
  await click(link);
  const dialog = win.document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("https://example.invalid/brief");
  const go = [...dialog!.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Open link"),
  );
  await click(go);
  (win as unknown as { open: unknown }).open = open;
  expect(opened).toHaveLength(1);
  expect(String(opened[0]![1])).toBe("_blank");
  expect(String(opened[0]![2])).toMatch(/noopener|noreferrer/);
});

test("the owner of an open room gets an Edit room link to the settings page", async () => {
  const host = await roomPage();
  const link = [...host.querySelectorAll("aside a")].find((a) => a.textContent === "Edit room");
  expect(link).toBeDefined();
  expect(link!.getAttribute("href")).toBe(`/rooms/${ROOM}/settings`);
});

test("a closed room, and a member who only reads it, get no Edit room link", async () => {
  current = room({ status: "resolved" });
  const closed = await roomPage();
  expect([...closed.querySelectorAll("aside a")].some((a) => a.textContent === "Edit room")).toBe(
    false,
  );
  owner = "someone-else";
  current = room();
  const reader = await roomPage();
  expect(text(reader)).toContain("You are reading this room as a member of its team.");
  expect([...reader.querySelectorAll("aside a")].some((a) => a.textContent === "Edit room")).toBe(
    false,
  );
});

test("the settings page edits the title, what the room is for and the details, and saves with the version it read", async () => {
  const host = await settings();
  const t = text(host);
  expect(t).toContain("Launch page settings");
  expect(t).toContain("What this room is for");
  expect(t).toContain("Details and references (bots read this)");
  const title = host.querySelector(
    'input[type="text"], input:not([type])',
  ) as unknown as HTMLInputElement;
  expect(title.value).toBe("Launch page");
  const save = [...host.querySelectorAll("button")].find((b) => b.textContent === "Save")!;
  await click(save);
  expect(writes).toEqual([
    {
      call: `PATCH /api/discussions/${ROOM}`,
      body: {
        expectedVersion: 7,
        title: "Launch page",
        goal: current.goal.trim(),
        context: current.context,
      },
    },
  ]);
});

test("the settings page of a closed room, or of one that is not yours, says why it cannot be edited", async () => {
  current = room({ status: "cancelled" });
  const closed = await settings();
  expect(text(closed)).toContain("This room is closed");
  expect([...closed.querySelectorAll("button")].some((b) => b.textContent === "Save")).toBe(false);
  owner = "someone-else";
  current = room();
  const other = await settings();
  expect(text(other)).toContain("Only Rui Lima can change this room.");
});

test("the new room form has More about this room, and it is saved as the room's details", async () => {
  const host = await mount(async () => {
    const { RoomsPage } = await import("./discussions-page");
    return <RoomsPage creating />;
  });
  expect(text(host)).toContain("More about this room (optional)");
  // The text box is the chat's editor: write through its view, as typing would.
  const { EditorView } = await import("@codemirror/view");
  const boxes = [...host.querySelectorAll(".cm-content")] as unknown as HTMLElement[];
  expect(boxes).toHaveLength(2);
  const more = EditorView.findFromDOM(boxes[1] as never)!;
  await act(async () =>
    more.dispatch({ changes: { from: 0, insert: "See [the brief](https://example.invalid/b)" } }),
  );
  const title = host.querySelector('input[name="title"]') as unknown as HTMLInputElement;
  title.value = "Launch page";
  await click([...host.querySelectorAll("input[type='checkbox']")][0]);
  const start = [...host.querySelectorAll("button")].find((b) => b.textContent === "Start room")!;
  // The form reads its fields with FormData, and the one Bun has does not know the fake page's form.
  const realFormData = globalThis.FormData;
  globalThis.FormData = win.FormData as never;
  try {
    await click(start);
  } finally {
    globalThis.FormData = realFormData;
  }
  expect(writes).toEqual([
    {
      call: "POST /api/discussions",
      body: {
        title: "Launch page",
        goal: "",
        context: "See [the brief](https://example.invalid/b)",
        members: [{ bot: BOT }],
      },
    },
  ]);
});
