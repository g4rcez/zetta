import { afterAll, afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import { withAppSearch, type AppSearch } from "./apps-search";

const win = setupDom();
(globalThis as { scrollTo?: () => void }).scrollTo = () => {};
afterAll(() => {
  delete (globalThis as { scrollTo?: () => void }).scrollTo;
});
// A test that fails before it unmounts must not leave its page behind for the next one to click.
afterEach(() => {
  win.document.body.innerHTML = "";
});

const ID = "01a1b8f9-aa56-7bc6-8a1a-f6d455841811";
const BOT_A = "01a1b8f9-0000-7000-8000-00000000000a";
const BOT_B = "01a1b8f9-0000-7000-8000-00000000000b";
const sent: { path: string; method: string; body: unknown }[] = [];
let isOwner = true;
let granted = [BOT_A];
let failNext = false;
let policy: string | null = null;
let hasUi = false;
let keeps = false;
let cleared = 0;

const detail = () => ({
  id: ID,
  slug: "github-triage",
  name: "GitHub triage",
  description: "Sort new issues",
  visibility: "private",
  ownerUserId: "user-me",
  sourcePlaygroundId: "01a1b8f9-aa56-7bc6-8a1a-f6d455849999",
  version: 3,
  tools: 2,
  accounts: [],
  updatedAt: new Date().toISOString(),
  isOwner,
  ui: hasUi ? { entry: "ui/index.html", bytes: 1200 } : null,
  settings: { toolPolicy: policy ? { "items.remove": policy } : {} },
  versions: [
    {
      id: "v3",
      n: 3,
      note: "added remove",
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      publishedByBotId: null,
      active: true,
      tools: 2,
    },
    {
      id: "v2",
      n: 2,
      note: "",
      createdAt: new Date(Date.now() - 86_400_000 * 2).toISOString(),
      publishedByBotId: BOT_A,
      active: false,
      tools: 1,
    },
  ],
  manifest: {
    tools: [
      {
        name: "greet",
        kind: "query",
        description: "Say hello",
        input: { type: "object", properties: { name: { type: "string" } } },
        accounts: [],
      },
      {
        name: "items.remove",
        kind: "mutation",
        description: "Remove an item",
        input: { type: "object" },
        accounts: ["github"],
        ...(keeps && { storage: { collections: ["todos"], shared: ["settings"], write: true } }),
      },
    ],
    accounts: {},
    ...(hasUi && { ui: { entry: "ui/index.html", bytes: 1200 } }),
  },
  policies: {
    greet: "Never asks (reads)",
    "items.remove":
      policy === "auto"
        ? "Never asks"
        : policy === "block"
          ? "Blocked"
          : "Asks (changes something)",
  },
});
const calls = [
  {
    id: "c1",
    tool: "greet",
    kind: "query",
    source: "bot",
    status: "ok",
    error: null,
    durationMs: 41,
    botId: BOT_A,
    actorUserId: "user-me",
    createdAt: new Date(Date.now() - 60_000 * 10).toISOString(),
    finishedAt: null,
  },
  {
    id: "c2",
    tool: "items.remove",
    kind: "mutation",
    source: "bot",
    status: "pending_approval",
    error: null,
    durationMs: null,
    botId: BOT_A,
    actorUserId: "user-me",
    createdAt: new Date(Date.now() - 60_000 * 5).toISOString(),
    finishedAt: null,
  },
  {
    id: "c3",
    tool: "items.remove",
    kind: "mutation",
    source: "ui",
    status: "failed",
    error: "TOOL_ERROR: it broke",
    durationMs: 9,
    botId: null,
    actorUserId: "user-me",
    createdAt: new Date(Date.now() - 60_000 * 2).toISOString(),
    finishedAt: null,
  },
];
const bots = [
  { id: BOT_A, name: "Helper", kind: "specialist", avatar: null, canEdit: true },
  { id: BOT_B, name: "Writer", kind: "specialist", avatar: null, canEdit: true },
  {
    id: "01a1b8f9-0000-7000-8000-00000000000c",
    name: "Someone's bot",
    kind: "specialist",
    avatar: null,
    canEdit: false,
  },
];

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (method !== "GET") sent.push({ path, method, body });
  const fail = () =>
    Response.json({ error: { code: "TEST", message: "The server said no." } }, { status: 400 });
  if (method !== "GET" && failNext) {
    failNext = false;
    return fail();
  }
  if (path === "/api/bots") return Response.json({ bots });
  if (path === "/api/apps/github-triage" && method === "GET")
    return Response.json({ app: detail() });
  if (path === "/api/apps/github-triage/ui")
    return Response.json({
      page: {
        app: "github-triage",
        name: "GitHub triage",
        version: 3,
        html: "<p>page</p>",
        tools: [{ name: "greet", kind: "query", description: "Say hello" }],
      },
    });
  if (path === "/api/apps/github-triage/data" && method === "GET")
    return Response.json({
      data: {
        app: "github-triage",
        collections: [
          { name: "settings", kind: "shared", records: 2, bytes: 90 },
          {
            name: "todos",
            kind: "personal",
            records: 1,
            bytes: 2048,
            ...(isOwner && { otherRecords: 7 }),
          },
        ],
      },
    });
  if (path.startsWith("/api/apps/github-triage/data?scope=") && method === "DELETE") {
    cleared++;
    return Response.json({ removed: 3 });
  }
  if (path === "/api/apps/github-triage/calls") return Response.json({ calls });
  if (path === "/api/apps/github-triage/bots" && method === "GET")
    return Response.json({ botIds: granted });
  if (path === "/api/apps/github-triage/bots" && method === "PUT") {
    granted = body.botIds;
    return Response.json({ botIds: granted });
  }
  if (path.startsWith(`/api/apps/${ID}/tools/`) && method === "PUT") {
    policy = body.policy;
    return Response.json({ app: detail() });
  }
  if (path === `/api/apps/${ID}/rollback`) return Response.json({ app: detail() });
  if (path === `/api/apps/${ID}` && method === "PATCH") return Response.json({ app: detail() });
  if (path === `/api/apps/${ID}` && method === "DELETE") return Response.json({ archived: true });
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${method} ${path}` } },
    { status: 500 },
  );
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));
const text = () => win.document.body.textContent ?? "";
const buttons = () => [...win.document.querySelectorAll("button")];
const press = async (label: string, nth = 0) => {
  const b = buttons().filter((x) => x.textContent?.trim() === label)[nth];
  if (!b) throw new Error(`no button "${label}" #${nth} in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const reset = () => {
  sent.length = 0;
  isOwner = true;
  granted = [BOT_A];
  failNext = false;
  policy = null;
  hasUi = false;
  keeps = false;
  cleared = 0;
};

const mount = async (initial: AppSearch) => {
  const { AppPage } = await import("./app-page");
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { useState } = await import("react");
  const changes: AppSearch[] = [];
  let left = 0;
  function Address() {
    const [search, setAddress] = useState<AppSearch>(initial);
    return (
      <AppPage
        appRef="github-triage"
        search={search}
        setSearch={(patch) => {
          const next = withAppSearch(search, patch);
          changes.push(next);
          setAddress(next);
        }}
        onLeave={() => void left++}
      />
    );
  }
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <Address />
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<RouterProvider router={router} />));
  await settle();
  return { changes, left: () => left, unmount: () => act(async () => root.unmount()) };
};

test("the owner sees the tools, how each is guarded, and the controls to change it", async () => {
  reset();
  const { unmount } = await mount({});
  expect(text()).toContain("GitHub triage");
  expect(text()).toContain("apps.github-triage");
  expect(text()).toContain("version 3");
  expect(text()).toContain("greet");
  expect(text()).toContain("Reads");
  expect(text()).toContain("Changes something");
  expect(text()).toContain("Never asks (reads)");
  expect(text()).toContain("Asks (changes something)");
  expect(text()).toContain("Needs an account: github");
  expect(buttons().filter((b) => b.textContent === "Block")).toHaveLength(2);
  expect(
    win.document.querySelector('[aria-label="How items.remove is guarded"] [aria-pressed="true"]')
      ?.textContent,
  ).toBe("Default");
  expect([...win.document.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain(
    "/playground/01a1b8f9-aa56-7bc6-8a1a-f6d455849999",
  );
  await unmount();
});

test("choosing a policy sends the owner's choice, and Default takes it back", async () => {
  reset();
  const { unmount } = await mount({});
  await press("Block", 1);
  expect(sent.at(-1)).toEqual({
    path: `/api/apps/${ID}/tools/items.remove/policy`,
    method: "PUT",
    body: { policy: "block" },
  });
  expect(text()).toContain("Blocked");
  expect(
    win.document.querySelector('[aria-label="How items.remove is guarded"] [aria-pressed="true"]')
      ?.textContent,
  ).toBe("Block");
  await press("Default", 1);
  expect(sent.at(-1)!.body).toEqual({ policy: null });
  await unmount();
});

test("someone who is not the owner sees the tools but no way to change them", async () => {
  reset();
  isOwner = false;
  const { unmount } = await mount({});
  expect(text()).toContain("Team app");
  expect(text()).toContain("Asks (changes something)");
  expect(
    buttons().some((b) =>
      ["Block", "Ask", "Auto", "Archive", "Share with the team"].includes(b.textContent ?? ""),
    ),
  ).toBe(false);
  await unmount();
});

test("a failed change shows the reason and leaves the page as it was", async () => {
  reset();
  const { unmount } = await mount({});
  failNext = true;
  await press("Auto", 1);
  expect(text()).toContain("The server said no.");
  await unmount();
});

test("the versions tab lists them and the owner can go back to an older one", async () => {
  reset();
  const { changes, unmount } = await mount({ tab: "versions" });
  expect(text()).toContain("Version 3");
  expect(text()).toContain("Active");
  expect(text()).toContain("added remove");
  expect(text()).toContain("asked for by a bot");
  await press("Use version 2");
  expect(sent.at(-1)).toEqual({
    path: `/api/apps/${ID}/rollback`,
    method: "POST",
    body: { n: 2 },
  });
  expect(buttons().some((b) => b.textContent === "Use version 3")).toBe(false);
  expect(changes).toEqual([]);
  await unmount();
});

test("the bots tab offers only my bots, shows who has the app, and saves the choice", async () => {
  reset();
  const { unmount } = await mount({ tab: "bots" });
  expect(text()).toContain("Helper");
  expect(text()).toContain("Writer");
  expect(text()).not.toContain("Someone's bot");
  const boxes = [
    ...win.document.querySelectorAll('input[type="checkbox"]'),
  ] as unknown as HTMLInputElement[];
  expect(boxes.map((b) => b.checked)).toEqual([true, false]);
  expect(
    buttons()
      .find((b) => b.textContent === "Save bots")!
      .hasAttribute("disabled"),
  ).toBe(true);
  await act(
    async () =>
      void boxes[1]!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
  await press("Save bots");
  expect(sent.at(-1)).toEqual({
    path: "/api/apps/github-triage/bots",
    method: "PUT",
    body: { botIds: [BOT_A, BOT_B] },
  });
  await unmount();
});

test("the calls tab shows what happened to each call, and where a waiting one is answered", async () => {
  reset();
  const { unmount } = await mount({ tab: "calls" });
  expect(text()).toContain("Done");
  expect(text()).toContain("Waiting for you");
  expect(text()).toContain("Failed");
  expect(text()).toContain("TOOL_ERROR: it broke");
  expect(text()).toContain("41 ms");
  expect(text()).toContain("card in the chat or in your Inbox");
  await unmount();
});

test("the tabs change the address", async () => {
  reset();
  const { changes, unmount } = await mount({});
  await press("Calls");
  expect(changes.at(-1)).toEqual({ tab: "calls" });
  await press("Tools");
  expect(changes.at(-1)).toEqual({});
  await unmount();
});

test("sharing and archiving: one click shares, archiving asks first and then leaves the page", async () => {
  reset();
  const { left, unmount } = await mount({});
  await press("Share with the team");
  expect(sent.at(-1)).toEqual({
    path: `/api/apps/${ID}`,
    method: "PATCH",
    body: { visibility: "team" },
  });
  await press("Archive");
  expect(sent.some((r) => r.method === "DELETE")).toBe(false);
  expect(text()).toContain("Archive it");
  await press("Keep");
  expect(buttons().some((b) => b.textContent === "Archive it")).toBe(false);
  await press("Archive");
  await press("Archive it");
  expect(sent.at(-1)).toEqual({
    path: `/api/apps/${ID}`,
    method: "DELETE",
    body: undefined,
  });
  expect(left()).toBe(1);
  await unmount();
});

test("an app with a page opens on it, with the frame drawn and the tools one tab away", async () => {
  reset();
  hasUi = true;
  const { changes, unmount } = await mount({});
  expect(win.document.querySelector("iframe")?.getAttribute("sandbox")).toBe(
    "allow-scripts allow-forms",
  );
  expect(
    buttons()
      .find((b) => b.textContent === "Open")
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(text()).not.toContain("Say hello"); // the tools list is not drawn behind the page
  await press("Tools");
  // Open is the default for this app, so Tools is the one that goes into the address.
  expect(changes.at(-1)).toEqual({ tab: "tools" });
  expect(win.document.querySelector("iframe")).toBeNull();
  await press("Open");
  expect(changes.at(-1)).toEqual({});
  await unmount();
});

test("the address can ask for the tools of an app with a page, with no click", async () => {
  reset();
  hasUi = true;
  const { unmount } = await mount({ tab: "tools" });
  expect(win.document.querySelector("iframe")).toBeNull();
  expect(text()).toContain("items.remove");
  await unmount();
});

test("an app without a page has no Open tab and opens on its tools", async () => {
  reset();
  hasUi = false;
  const { unmount } = await mount({});
  expect(buttons().some((b) => b.textContent === "Open")).toBe(false);
  expect(win.document.querySelector("iframe")).toBeNull();
  expect(text()).toContain("items.remove");
  await unmount();
});

test("an app that keeps data has a Data tab with the numbers, and the address can open it with no click", async () => {
  reset();
  keeps = true;
  const { unmount } = await mount({ tab: "data" });
  expect(text()).toContain("todos");
  expect(text()).toContain("One set per person");
  expect(text()).toContain("7 held by other people");
  expect(text()).toContain("1 record · 2.0 KB");
  expect(text()).toContain("settings");
  expect(text()).toContain("Shared by everyone who uses the app");
  expect(text()).toContain("2 records");
  await unmount();
});

test("an app that keeps nothing has no Data tab", async () => {
  reset();
  const { unmount } = await mount({});
  expect(buttons().some((b) => b.textContent === "Data")).toBe(false);
  await unmount();
});

test("deleting my records asks first, and Keep changes nothing", async () => {
  reset();
  keeps = true;
  const { unmount } = await mount({ tab: "data" });
  await press("Delete my records");
  expect(
    win.document.querySelector('[role="group"][aria-label^="Delete your records"]'),
  ).not.toBeNull();
  await press("Keep");
  expect(cleared).toBe(0);
  await press("Delete my records");
  await press("Delete my records", 0);
  expect(sent.at(-1)).toMatchObject({
    path: "/api/apps/github-triage/data?scope=mine",
    method: "DELETE",
  });
  expect(cleared).toBe(1);
  await unmount();
});

test("only the owner can delete everyone's records", async () => {
  reset();
  keeps = true;
  isOwner = false;
  const member = await mount({ tab: "data" });
  expect(text()).not.toContain("Delete everyone's records");
  expect(text()).not.toContain("held by other people");
  await member.unmount();
  isOwner = true;
  const owner = await mount({ tab: "data" });
  await press("Delete everyone's records");
  await press("Delete everyone's records", 0);
  expect(sent.at(-1)).toMatchObject({
    path: "/api/apps/github-triage/data?scope=all",
    method: "DELETE",
  });
  await owner.unmount();
});
