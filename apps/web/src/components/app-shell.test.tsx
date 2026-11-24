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
/** A bot-issue room in the fake workspace (`kind: "help"`), when a test wants one. */
let issueRoom = false;
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
        sidebarBots: [],
        roomOrder,
        navMode,
      },
    });
  if (url.pathname === "/api/discussions")
    return Response.json({
      discussions: [
        room("r-a", "Alpha"),
        room("r-b", "Beta"),
        ...(issueRoom ? [{ ...room("r-h", "Help with Writer"), kind: "help" }] : []),
      ],
    });
  if (url.pathname === "/api/routines")
    return Response.json({
      routines: [
        {
          id: "ro-1",
          title: "Nightly backup",
          paused: false,
          status: "failed",
          conversationId: null,
        },
        {
          id: "ro-2",
          title: "Weekly digest",
          paused: false,
          status: "scheduled",
          conversationId: null,
        },
      ],
    });
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
/** What a person sees: an element inside a `hidden` one is not listed. */
const seen = (el: Element) => !el.closest("[hidden]");
const names = (el: Element) =>
  [...el.querySelectorAll("a")].filter(seen).map((a) => a.textContent?.trim());

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

const nav = (host: Element, label: string) =>
  host.querySelector(`aside nav[aria-label="${label}"]`)!;
const headings = (el: Element) =>
  [...el.querySelectorAll("h3")].filter(seen).map((h) => h.textContent?.trim());
/** The links of the list that a heading names with `aria-labelledby`. */
const listOf = (el: Element, heading: string) => {
  const h = [...el.querySelectorAll("h3")].find((x) => x.textContent?.trim() === heading);
  return h ? el.querySelector(`ul[aria-labelledby="${h.id}"]`) : null;
};
const DESTINATIONS = {
  People: ["Teams", "Organization", "People"],
  Knowledge: ["Memory", "Skills", "Lessons", "Artifacts"],
  Tools: ["Plugins", "Apps", "Mail"],
  Build: ["Studio", "Playground", "Computer"],
};
async function mountWorkspace(mode: "simple" | "full" = "full") {
  clearLayout();
  members = 3;
  navMode = mode;
  const shell = await mountShell("left");
  return {
    ...shell,
    unmount: async () => {
      await shell.unmount();
      members = 1;
      navMode = "full";
    },
  };
}

test("a workspace with a team shows every destination at once, grouped by purpose, each one once", async () => {
  const { host, unmount } = await mountWorkspace();
  const main = nav(host, "Main");
  expect(main.className).not.toContain("grid-cols-5");
  expect(names(main)).toEqual(["Inbox", "Tasks", "Projects", "Routines", "Calendar"]);
  const workspace = nav(host, "Workspace");
  expect(headings(workspace)).toEqual([
    "Bots",
    "Rooms",
    "Routines needing you 1",
    ...Object.keys(DESTINATIONS),
  ]);
  for (const [heading, labels] of Object.entries(DESTINATIONS))
    expect(names(listOf(workspace, heading)!)).toEqual(labels);
  // No click was needed, and no destination is repeated anywhere in the sidebar, nor is the Library "Bots" link back.
  const all = names(host.querySelector("aside")!);
  for (const label of Object.values(DESTINATIONS).flat())
    expect(all.filter((n) => n === label)).toHaveLength(1);
  expect(all).not.toContain("Bots");
  expect(host.querySelector('aside section[aria-label="Library"]')).toBeNull();
  expect(host.querySelector('aside section[aria-label="Workspace"]')).toBeNull();
  await unmount();
});

test("the workspace layout has two named navs and no group toggle", async () => {
  const { host, unmount } = await mountWorkspace();
  const navs = [...host.querySelectorAll("aside nav")].map((n) => n.getAttribute("aria-label"));
  expect(navs).toEqual(["Main", "Workspace"]);
  // A toggle is a button that opens and closes a group; the row menus and choosers have a popup and are not one.
  const toggles = [...host.querySelectorAll("aside button[aria-expanded]")].filter(
    (b) => !b.hasAttribute("aria-haspopup"),
  );
  expect(toggles.map((b) => b.textContent?.trim())).toEqual([]);
  await unmount();
});

test("Build is left out when navigation is Simple", async () => {
  const { host, unmount } = await mountWorkspace("simple");
  const workspace = nav(host, "Workspace");
  expect(headings(workspace)).toEqual([
    "Bots",
    "Rooms",
    "Routines needing you 1",
    "People",
    "Knowledge",
    "Tools",
  ]);
  expect(names(workspace)).not.toContain("Studio");
  expect(names(workspace)).not.toContain("Playground");
  await unmount();
});

test("Rooms and Bot issues are static lists named by their headings", async () => {
  issueRoom = true;
  try {
    const { host, unmount } = await mountWorkspace();
    const workspace = nav(host, "Workspace");
    expect(headings(workspace)).toContain("Bot issues 1");
    expect(workspace.querySelectorAll("h3 button, button h3")).toHaveLength(0);
    const rooms = listOf(workspace, "Rooms")!;
    expect(rooms.textContent).toContain("Alpha");
    const issues = listOf(workspace, "Bot issues 1")!;
    expect(issues.textContent).toContain("Help with Writer");
    await unmount();
  } finally {
    issueRoom = false;
  }
});

test("the workspace layout lists only the routines that need a person; the personal layout lists them all", async () => {
  const { host, unmount } = await mountWorkspace();
  const workspace = nav(host, "Workspace");
  expect(workspace.textContent).toContain("Nightly backup");
  expect(workspace.textContent).not.toContain("Weekly digest");
  expect(workspace.querySelector('section[aria-label="Routines needing you"] button')).toBeNull();
  await unmount();
  clearLayout();
  members = 1;
  const personal = await mountShell("left");
  const section = personal.host.querySelector('aside section[aria-label="Routines"]')!;
  expect(section.textContent).toContain("Weekly digest");
  expect(section.querySelector("button[aria-expanded]")).not.toBeNull();
  await personal.unmount();
});

const typeFilter = async (host: Element, text: string) => {
  const input = host.querySelector('aside input[type="search"]') as unknown as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(input, text);
    input.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
  });
  // The count is announced after a short pause.
  await act(async () => void (await new Promise((r) => setTimeout(r, 350))));
};
/** The filter's result count: the live region next to the field. */
const filterBox = (host: Element) =>
  host.querySelector('aside input[type="search"]')!.closest("div.shrink-0")!;
const status = (host: Element) =>
  filterBox(host).querySelector('[role="status"][aria-live="polite"]');

test('the filter is named "Filter the sidebar", matches destinations, hides empty sections and says how many matched', async () => {
  const { host, unmount } = await mountWorkspace();
  const input = host.querySelector('aside input[type="search"]')!;
  expect(input.getAttribute("aria-label") ?? input.getAttribute("title")).toBe(
    "Filter the sidebar",
  );
  expect(status(host)!.textContent).toBe("");
  await typeFilter(host, "mem");
  const workspace = nav(host, "Workspace");
  expect(names(workspace)).toContain("Memory");
  expect(names(workspace)).not.toContain("Teams");
  expect(headings(workspace)).toContain("Knowledge");
  expect(headings(workspace)).not.toContain("People");
  expect(headings(workspace)).not.toContain("Tools");
  expect(status(host)!.textContent).toBe("1 match");
  // Bots and Rooms leave too when nothing in them matches, with their "All rooms" link and "No bots match" line.
  expect(headings(workspace)).toEqual(["Knowledge"]);
  expect(names(workspace)).not.toContain("All rooms");
  expect(workspace.textContent).not.toContain("No bots match");
  await typeFilter(host, "alp");
  const rooms = nav(host, "Workspace");
  expect(headings(rooms)).toEqual(["Rooms"]);
  // The unnamed link is the "+" that starts a room.
  expect(names(rooms).filter(Boolean)).toEqual(["Alpha"]);
  expect(status(host)!.textContent).toBe("1 match");
  await typeFilter(host, "mem");
  // A heading that matches shows all its links.
  await typeFilter(host, "tools");
  expect(names(listOf(nav(host, "Workspace"), "Tools")!)).toEqual(DESTINATIONS.Tools);
  expect(status(host)!.textContent).toBe("3 matches");
  await typeFilter(host, "zzz");
  expect(status(host)!.textContent).toBe("No matches");
  expect(headings(nav(host, "Workspace"))).not.toContain("Knowledge");
  await typeFilter(host, "");
  expect(status(host)!.textContent).toBe("");
  expect(headings(nav(host, "Workspace"))).toContain("Knowledge");
  await unmount();
});

test("ArrowUp, ArrowDown, Home and End walk every row of the workspace list, destinations included", async () => {
  const { host, unmount } = await mountWorkspace();
  const workspace = nav(host, "Workspace");
  const rows = [...workspace.querySelectorAll<HTMLElement>("[data-chat-row], [data-walk] a")];
  const labels = rows.map((r) => r.textContent?.trim());
  expect(labels).toContain("Alpha");
  expect(labels).toContain("Memory");
  expect(labels[labels.length - 1]).toBe("Computer");
  const press = async (key: string) =>
    act(async () => {
      win.document.activeElement?.dispatchEvent(
        new win.KeyboardEvent("keydown", { key, bubbles: true }) as unknown as Event,
      );
    });
  const at = () => rows.indexOf(win.document.activeElement as unknown as HTMLElement);
  await act(async () => rows[0]!.focus());
  expect(at()).toBe(0);
  await press("ArrowDown");
  expect(at()).toBe(1);
  await press("ArrowUp");
  expect(at()).toBe(0);
  await press("End");
  expect(at()).toBe(rows.length - 1);
  await press("Home");
  expect(at()).toBe(0);
  // Walk from the rooms into the destinations: Memory is reached by arrows alone.
  const memory = rows.findIndex((r) => r.textContent?.trim() === "Memory");
  for (let i = 0; i < memory; i++) await press("ArrowDown");
  expect(win.document.activeElement?.textContent?.trim()).toBe("Memory");
  await unmount();
});

test("the personal layout keeps its grid, its More group and its old filter name", async () => {
  clearLayout();
  members = 1;
  const { host, unmount } = await mountShell("left");
  expect([...host.querySelectorAll("aside nav")].map((n) => n.getAttribute("aria-label"))).toEqual([
    "Main",
    "Rooms and bots",
  ]);
  const input = host.querySelector('aside input[type="search"]')!;
  expect(input.getAttribute("aria-label") ?? input.getAttribute("title")).toBe(
    "Filter rooms and bots",
  );
  expect(status(host)).toBeNull();
  expect(headings(nav(host, "Rooms and bots"))).not.toContain("Knowledge");
  await unmount();
});

test("the collapsed rail keeps its icons, with no section headings", async () => {
  clearLayout();
  members = 3;
  const { host, unmount } = await mountShell("left", { railMode: "collapsed" });
  expect(host.querySelector("aside nav[aria-label='More']")).not.toBeNull();
  expect(host.querySelector("aside h3")).toBeNull();
  expect(host.querySelector('aside nav[aria-label="Workspace"]')).toBeNull();
  await unmount();
  members = 1;
});

test("the header switch changes the layout, with plain names, and the choice is remembered in this browser", async () => {
  clearLayout();
  members = 1;
  const { host, unmount } = await mountShell("left");
  const toggle = host.querySelector('aside button[aria-label="Show the team sidebar"]')!;
  await press(toggle);
  expect(host.querySelector('aside nav[aria-label="Main"]')!.className).not.toContain(
    "grid-cols-5",
  );
  expect(host.querySelector('aside nav[aria-label="Workspace"]')).not.toBeNull();
  expect(host.querySelector('aside button[aria-label="Show the personal sidebar"]')).not.toBeNull();
  expect(win.localStorage.getItem("zetta.sidebar-layout")).toBe("workspace");
  await unmount();
  // A new visit keeps the choice, even though the account is still solo.
  const again = await mountShell("left");
  expect(again.host.querySelector('aside nav[aria-label="Workspace"]')).not.toBeNull();
  await again.unmount();
  win.localStorage.clear();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("the logo link is named Zetta overview", async () => {
  const { host, unmount } = await mountShell("left");
  const logo = host.querySelector('aside a[href="/"]')!;
  expect(logo.getAttribute("aria-label")).toBe("Zetta overview");
  expect(host.querySelector('aside [aria-label="Zetta home"]')).toBeNull();
  await unmount();
});

test("the personal More group opens at once and fades in; it never animates height", async () => {
  clearLayout();
  members = 1;
  const { host, unmount } = await mountShell("left");
  const more = [...host.querySelectorAll("aside section[aria-label] button")].find(
    (b) => b.textContent?.trim() === "More",
  )!;
  await press(more);
  const list = host.querySelector('aside section[aria-label="More"] ul')!;
  expect(list.className).toContain("nav-reveal");
  expect(list.getAttribute("style")).toBeNull();
  await press(more);
  expect(host.querySelector('aside section[aria-label="More"] ul')).toBeNull();
  await unmount();
});

test("the sidebar styles animate only opacity and transform, and nothing under reduced motion", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const sidebar = read("./app-sidebar.tsx");
  expect(sidebar).not.toContain("motion/react");
  expect(sidebar).not.toMatch(/height:\s*(0|"auto")/);
  const css = read("../index.css");
  expect(css).toMatch(/--ease-out:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  expect(css).toContain("--duration-fast: 150ms");
  expect(css).toContain("--duration-base: 180ms");
  const reveal = css.slice(css.indexOf("@keyframes nav-reveal-in"));
  expect(reveal).toMatch(/\.nav-reveal \{\s*animation: nav-reveal-in 120ms var\(--ease-out\)/);
  expect(reveal).toMatch(
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.nav-reveal \{\s*animation: none;/,
  );
  expect(read("./mode-toggle.tsx")).not.toContain("transition-all");
  expect(read("../features/chat/sidebar-bots.tsx")).toContain("animate-pulse");
  expect(read("../features/chat/sidebar-bots.tsx")).toContain("motion-reduce:animate-none");
});
