import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();
// The router restores scroll on load; the test DOM has no `scrollTo`.
Object.assign(globalThis, { scrollTo: () => {} });
// The shell shows its sidebar from 768px up.
Object.assign(win, {
  matchMedia: (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }),
});

let sidebarSide: "left" | "right" = "left";
let railMode: "expanded" | "collapsed" = "expanded";
let agentsState: "running" | "paused" = "running";
let roomOrder: string[] = [];
let navMode: "simple" | "full" = "full";
/** Members the fake workspace reports (`/api/people`): one is a solo account. */
let members = 1;
const room = (id: string, title: string) => ({
  id,
  conversationId: `c-${id}`,
  title,
  goal: "",
  context: "",
  contextVersion: 1,
  status: "open",
  kind: "room",
  tainted: false,
  turnsUsed: 0,
  summary: "",
  version: 1,
  createdByBotId: null,
  teamId: null,
  originConversationId: null,
  originInbound: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  members: [],
  queued: 0,
  running: false,
  awaitingApproval: false,
});
const blockedBot = {
  id: "bot-blocked",
  kind: "specialist",
  name: "Blocked Bot",
  canEdit: false,
  onboarded: false,
};
// The auth client keeps the first `fetch` it sees for the whole test process, and this file loads it before the others. So once this
// file is done the fake hands every request to whatever `fetch` the next file installed (or the real one), and cannot hijack it.
const realFetch = globalThis.fetch;
let finished = false;
afterAll(() => void (finished = true));
const fake = (async (input: URL | Request | string, init?: RequestInit) => {
  if (finished) return (globalThis.fetch === fake ? realFetch : globalThis.fetch)(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === "/api/preferences")
    return Response.json({
      preferences: {
        railMode,
        agentsState,
        sidebarSide,
        railWidth: 224,
        listWidth: 320,
        timeFormat: "24h",
        approvalMode: "hold",
        theme: null,
        primaryColor: null,
        botOrder: [],
        roomOrder,
        navMode,
      },
    });
  if (url.pathname === "/api/discussions")
    return Response.json({ discussions: [room("r-a", "Alpha"), room("r-b", "Beta")] });
  if (url.pathname === "/api/people")
    return Response.json({
      people: Array.from({ length: members }, (_, i) => ({
        userId: `u-${i}`,
        name: `Person ${i}`,
        avatar: null,
        jobTitle: "",
        title: "",
        department: "",
        about: "",
        contact: "",
      })),
    });
  if (url.pathname === "/api/bots") return Response.json({ bots: [blockedBot] });
  return Response.json({ error: { code: "TEST", message: "offline" } }, { status: 500 });
}) as typeof fetch;
globalThis.fetch = fake;

async function mountShell(
  side: "left" | "right",
  state: { railMode?: typeof railMode; agentsState?: typeof agentsState } = {},
) {
  sidebarSide = side;
  railMode = state.railMode ?? "expanded";
  agentsState = state.agentsState ?? "running";
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { ThemeProvider } = await import("../components/theme-provider");
  const { PreferencesProvider } = await import("../features/preferences/preferences");
  const { SidebarDataProvider } = await import("../features/chat/sidebar-data");
  const { AppShell } = await import("./app-shell");
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ThemeProvider attribute="class" defaultTheme="light">
            <PreferencesProvider>
              <SidebarDataProvider>
                <AppShell>
                  <p>page</p>
                </AppShell>
              </SidebarDataProvider>
            </PreferencesProvider>
          </ThemeProvider>
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
  await act(async () => void (await new Promise((r) => setTimeout(r, 80))));
  return { host, unmount: () => act(async () => root.unmount()) };
}

test("the sidebar is laid out on the left by default, with its resize handle on its right edge", async () => {
  const { host, unmount } = await mountShell("left");
  const frame = host.querySelector("aside")!.parentElement!;
  expect(frame.className).toContain("md:flex-row");
  expect(frame.className).not.toContain("md:flex-row-reverse");
  expect(host.querySelector("main")!.className).toContain("md:mr-2");
  const handle = host.querySelector('[role="separator"]')!;
  expect(handle.className).toContain("right-0");
  expect(handle.className).not.toContain("left-0");
  await unmount();
});

test("on the right the frame is reversed, the panel keeps its gap, and the resize handle moves to the left edge", async () => {
  const { host, unmount } = await mountShell("right");
  const aside = host.querySelector("aside")!;
  // Still first in the DOM, so the tab order and screen readers do not change.
  expect(aside.nextElementSibling?.tagName).toBe("MAIN");
  expect(aside.parentElement!.className).toContain("md:flex-row-reverse");
  const main = host.querySelector("main")!;
  expect(main.className).toContain("md:ml-2");
  expect(main.className).not.toContain("md:mr-2");
  const handle = host.querySelector('[role="separator"]')!;
  expect(handle.className).toContain("left-0");
  expect(handle.className).not.toContain("right-0");
  await unmount();
});

const popup = () => win.document.querySelector('[role="tooltip"]');
const openHint = async (button: unknown) => {
  await act(async () => (button as unknown as HTMLElement).focus());
  const text = popup()?.textContent;
  await act(async () => {
    win.document.activeElement?.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  return text;
};

test('while the agents are paused, the collapsed sidebar names the pause button "Resume agents" in its hint', async () => {
  const { host, unmount } = await mountShell("left", {
    railMode: "collapsed",
    agentsState: "paused",
  });
  const button = host.querySelector('aside button[aria-pressed="true"]')!;
  expect(button.getAttribute("aria-label")).toBe("Resume agents");
  expect(button.hasAttribute("title")).toBe(false);
  expect(button.hasAttribute("aria-haspopup")).toBe(false);
  expect(await openHint(button)).toBe("Resume agents");
  await unmount();
});

test('while the agents are paused, the expanded sidebar names the pause button "Resume agents" in its hint', async () => {
  const { host, unmount } = await mountShell("left", {
    railMode: "expanded",
    agentsState: "paused",
  });
  const button = host.querySelector('aside button[aria-pressed="true"]')!;
  expect(button.getAttribute("aria-label")).toBe("Resume agents");
  expect(button.hasAttribute("title")).toBe(false);
  expect(button.hasAttribute("aria-haspopup")).toBe(false);
  expect(await openHint(button)).toBe("Resume agents");
  await unmount();
});

test('while the agents run, the expanded sidebar hints "Pause agents" on the pause button, with no native title', async () => {
  const { host, unmount } = await mountShell("left");
  const button = host.querySelector('aside button[aria-label="Pause agents"]')!;
  expect(button.hasAttribute("title")).toBe(false);
  expect(await openHint(button)).toBe("Pause agents");
  await unmount();
});

test('while the agents run, the expanded sidebar hints "Collapse sidebar" on the collapse button, with no native title', async () => {
  const { host, unmount } = await mountShell("left");
  const button = host.querySelector('aside button[aria-label="Collapse sidebar"]')!;
  expect(button.hasAttribute("title")).toBe(false);
  expect(await openHint(button)).toBe("Collapse sidebar");
  await unmount();
});

test("in the collapsed sidebar, a bot you cannot open still shows its name when you point at it", async () => {
  const { host, unmount } = await mountShell("left", { railMode: "collapsed" });
  const button = host.querySelector('aside [aria-label="Bots"] button')!;
  expect(button.hasAttribute("disabled")).toBe(true);
  // A browser sends no mouse event to a disabled button, so the pointer reaches the element that wraps it.
  await act(async () => {
    const wrapper = button.parentElement!;
    for (const type of ["pointerover", "pointerenter", "pointermove"])
      wrapper.dispatchEvent(
        new win.PointerEvent(type, { pointerType: "mouse", bubbles: type !== "pointerenter" }),
      );
    for (const type of ["mouseover", "mouseenter", "mousemove"])
      wrapper.dispatchEvent(new win.MouseEvent(type, { bubbles: type !== "mouseenter" }));
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 400))));
  expect(popup()?.textContent).toBe("Blocked Bot");
  await unmount();
});

const press = (el: unknown) =>
  act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      (el as Element).dispatchEvent(
        new win.MouseEvent(type, { bubbles: true, button: 0 }) as unknown as Event,
      );
  });

test("the theme button opens a menu of radio items; the current theme is the only checked one and a pick moves the check", async () => {
  const { THEME_LABEL } = await import("../features/preferences/theme");
  const { host, unmount } = await mountShell("left");
  const trigger = [...host.querySelectorAll("aside button")].find((b) =>
    b.textContent?.includes("change theme"),
  )!;
  expect(win.document.querySelector('[role="menu"]')).toBeNull();
  await press(trigger);
  const radios = () => [...win.document.querySelectorAll('[role="menu"] [role="menuitemradio"]')];
  const checked = () =>
    radios()
      .filter((r) => r.getAttribute("aria-checked") === "true")
      .map((r) => r.textContent?.trim());
  expect(radios().length).toBeGreaterThan(3);
  // No theme is saved, so the device theme is the current one.
  expect(checked()).toEqual([THEME_LABEL.system]);
  const other = radios().find((r) => r.getAttribute("aria-checked") === "false")!;
  const name = other.textContent?.trim();
  await press(other);
  // The menu closes on a pick; open it again to read the new state.
  expect(win.document.querySelector('[role="menu"]')).toBeNull();
  await press(trigger);
  expect(checked()).toEqual([name]);
  await unmount();
});

test("the sidebar lists rooms in the saved order, and each room has a menu like a bot does", async () => {
  roomOrder = ["r-b", "r-a"];
  try {
    const { host, unmount } = await mountShell("left");
    const rows = [...host.querySelectorAll('aside section[aria-label="Rooms"] li')];
    const labels = rows
      .map((li) => li.querySelector("a[title]")?.getAttribute("title"))
      .filter(Boolean);
    expect(labels).toEqual(["Beta", "Alpha"]);
    for (const name of ["Beta", "Alpha"])
      expect(host.querySelector(`button[aria-label="Actions for ${name}"]`)).not.toBeNull();
    await unmount();
  } finally {
    roomOrder = [];
  }
});

test("the Calendar (the /agenda page) sits in the main block next to Routines, in Simple and in Full", async () => {
  for (const mode of ["simple", "full"] as const) {
    navMode = mode;
    const { host, unmount } = await mountShell("left");
    const main = host.querySelector('aside nav[aria-label="Main"]')!;
    const links = [...main.querySelectorAll("a")].map((a) => [
      a.textContent?.trim(),
      a.getAttribute("href"),
    ]);
    expect(links).toContainEqual(["Calendar", "/agenda"]);
    expect(links.map(([label]) => label)).not.toContain("Agenda");
    const labels = links.map(([label]) => label);
    expect(labels.indexOf("Calendar")).toBe(labels.indexOf("Routines") + 1);
    // Advanced still hides Studio, Playground and Computer in Simple; the Calendar is not in it.
    expect(host.textContent).not.toContain("Agenda");
    await unmount();
  }
  navMode = "full";
});

// The test DOM has no global `localStorage` (the app reads it behind a try/catch): give these tests the window's, empty each time.
const clearLayout = () => {
  Object.assign(globalThis, { localStorage: win.localStorage });
  win.localStorage.clear();
};
const names = (el: {
  querySelectorAll(selector: string): Iterable<{ textContent: string | null }>;
}) => [...el.querySelectorAll("a")].map((a) => a.textContent?.trim());

test("a solo account gets the personal layout: a grid of the five daily pages, and the rest behind More", async () => {
  clearLayout();
  members = 1;
  navMode = "full";
  const { host, unmount } = await mountShell("left");
  const main = host.querySelector('aside nav[aria-label="Main"]')!;
  expect(main.className).toContain("grid-cols-5");
  expect(names(main)).toEqual(["Inbox", "Tasks", "Projects", "Routines", "Calendar"]);
  const more = [...host.querySelectorAll("aside section[aria-label] button")].find(
    (b) => b.textContent?.trim() === "More",
  )!;
  expect(more.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector('aside section[aria-label="Workspace"]')).toBeNull();
  expect(names(host.querySelector("aside")!)).not.toContain("Organization");
  await press(more);
  expect(names(host.querySelector("aside")!)).toContain("Organization");
  await unmount();
});

test("a workspace with a team gets labeled sections instead of the grid", async () => {
  clearLayout();
  members = 3;
  navMode = "full";
  const { host, unmount } = await mountShell("left");
  const main = host.querySelector('aside nav[aria-label="Main"]')!;
  expect(main.className).not.toContain("grid-cols-5");
  const workspace = host.querySelector('aside section[aria-label="Workspace"]')!;
  expect(names(workspace)).toEqual(["Teams", "Organization", "People"]);
  const library = host.querySelector('aside section[aria-label="Library"]')!;
  expect(names(library)).toContain("Memory");
  expect(host.querySelector('aside section[aria-label="Build"]')).not.toBeNull();
  await unmount();
  members = 1;
});

test("the header switch changes the layout and the choice is remembered in this browser", async () => {
  clearLayout();
  members = 1;
  const { host, unmount } = await mountShell("left");
  const toggle = host.querySelector('aside button[aria-label="Switch to the workspace layout"]')!;
  await press(toggle);
  expect(host.querySelector('aside nav[aria-label="Main"]')!.className).not.toContain(
    "grid-cols-5",
  );
  expect(host.querySelector('aside section[aria-label="Workspace"]')).not.toBeNull();
  expect(win.localStorage.getItem("zetta.sidebar-layout")).toBe("workspace");
  await unmount();
  // A new visit keeps the choice, even though the account is still solo.
  const again = await mountShell("left");
  expect(again.host.querySelector('aside section[aria-label="Workspace"]')).not.toBeNull();
  await again.unmount();
  win.localStorage.clear();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});
