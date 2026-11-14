import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// The router restores scroll on load; the test DOM has no `scrollTo`.
Object.assign(globalThis, { scrollTo: () => {} });

const BOT = "01a19da2-3c92-783a-b90d-c35975f3c60c";
const ID = (n: number) => `01a1ce15-6b98-7fa6-a72d-0885e1cc51${String(n).padStart(2, "0")}`;
const actions = (act: string, actLabel: string, input = "none") => ({
  act,
  actLabel,
  deny: "dismiss",
  denyLabel: "Dismiss",
  input,
});
const card = (
  n: number,
  title: string,
  a: ReturnType<typeof actions>,
  kind = "routine_failed",
) => ({
  key: `card:${ID(n)}`,
  source: "card",
  id: ID(n),
  kind,
  botId: BOT,
  title,
  detail: "",
  nextAction: "",
  resultLink: null,
  occurrences: 1,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  context: {},
  actions: a,
});
const proposal = (n: number, confirm: "hold" | "click") => ({
  key: `proposal:${ID(n)}`,
  source: "proposal",
  id: ID(n),
  botId: BOT,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  resultLink: null,
  proposal: {
    id: ID(n),
    kind: "bot_permission",
    botId: BOT,
    proposedByBotId: BOT,
    confirm,
    diff: [{ field: "allow", from: null, to: "Bash(git push)" }],
  },
});

const examplePlugin = {
  id: "example",
  name: "Example Plugin",
  description: "A plugin that stopped working.",
  icon: "plug",
  category: "productivity",
  auth: "none",
  kind: "mcp",
  transport: "http",
  fields: [],
  docsUrl: null,
  verified: true,
  notes: null,
  guide: [],
  credentials: false,
  tools: [],
};
let queue: unknown[] = [];
let posts: string[] = [];
let listReads = 0;
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (method !== "GET") {
    posts.push(`${method} ${url.pathname}`);
    return Response.json({ ok: true });
  }
  if (url.pathname === "/api/catch-up") {
    listReads += 1;
    return Response.json({ items: queue });
  }
  if (url.pathname === "/api/plugins/catalog") return Response.json({ plugins: [examplePlugin] });
  if (url.pathname === "/api/plugins") return Response.json({ plugins: [] });
  if (url.pathname === "/api/bots")
    return Response.json({ bots: [{ id: BOT, name: "Dev Bot", kind: "specialist" }] });
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  queue = [];
  posts = [];
  listReads = 0;
});

const mount = async (search: { bot?: string; item?: string } = {}) => {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { CatchUpPage } = await import("./catch-up-page");
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <CatchUpPage search={search} onSearch={() => {}} isAdmin={false} />
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
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const press = async (key: string, target: unknown = win) => {
  await act(async () => {
    (target as EventTarget).dispatchEvent(
      new win.KeyboardEvent("keydown", { key, bubbles: true }) as never,
    );
  });
  await settle();
};
/** A lazy panel and its requests take a few turns: wait for the text instead of guessing how long. */
const showing = async (host: HTMLElement, wanted: string) => {
  for (let i = 0; i < 40 && !(host.textContent ?? "").includes(wanted); i++) await settle();
};
const text = (host: HTMLElement) => host.textContent ?? "";
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

test("with nothing waiting it says so", async () => {
  const host = await mount();
  expect(text(host)).toContain("Nothing is waiting on you");
});

test("it shows one card at a time with how far along you are", async () => {
  queue = [
    card(1, "Nightly report failed", actions("run_again", "Run again")),
    card(2, "Weekly digest failed", actions("run_again", "Run again")),
  ];
  const host = await mount();
  expect(text(host)).toContain("Nightly report failed");
  expect(text(host)).not.toContain("Weekly digest failed");
  expect(text(host)).toContain("1 of 2");
});

test("J skips: the card goes to the back and the next one shows", async () => {
  queue = [
    card(1, "Nightly report failed", actions("run_again", "Run again")),
    card(2, "Weekly digest failed", actions("run_again", "Run again")),
  ];
  const host = await mount();
  await press("j");
  expect(text(host)).toContain("Weekly digest failed");
  expect(text(host)).not.toContain("Nightly report failed");
  await press("j");
  expect(text(host)).toContain("Nightly report failed");
  expect(posts).toEqual([]);
});

test("A presses the card's main button", async () => {
  queue = [card(1, "Nightly report failed", actions("run_again", "Run again"))];
  const host = await mount();
  await press("a");
  expect(posts).toEqual([`POST /api/catch-up/${ID(1)}/act`]);
  expect(text(host)).toBeDefined();
});

test("A on a card that needs a message sends nothing: the message comes first", async () => {
  queue = [card(1, "Dev Bot got stuck", actions("nudge", "Nudge", "text"), "room_stuck")];
  const host = await mount();
  expect(button(host, "Nudge")?.hasAttribute("disabled")).toBe(true);
  await press("a");
  expect(posts).toEqual([]);
});

test("keys typed in a text box are text, not shortcuts", async () => {
  queue = [card(1, "Nightly report failed", actions("run_again", "Run again"))];
  const host = await mount();
  const input = win.document.createElement("input");
  (host as unknown as Element).append(input as never);
  await press("a", input);
  await press("d", input);
  await press("j", input);
  expect(posts).toEqual([]);
  expect(text(host)).not.toContain("Denying this.");
  expect(text(host)).toContain("Nightly report failed");
});

test("D only arms a deny: it shows Undo, and Undo sends nothing", async () => {
  queue = [card(1, "Nightly report failed", actions("run_again", "Run again"))];
  const host = await mount();
  await press("d");
  expect(text(host)).toContain("Denying this.");
  expect(posts).toEqual([]);
  await act(async () => button(host, "Undo")?.click());
  expect(text(host)).not.toContain("Denying this.");
  expect(posts).toEqual([]);
});

test("a click on the Deny button sends it at once", async () => {
  queue = [card(1, "Nightly report failed", actions("run_again", "Run again"))];
  const host = await mount();
  await act(async () => button(host, "Dismiss")?.click());
  await settle();
  expect(posts).toEqual([`POST /api/catch-up/${ID(1)}/deny`]);
});

test("A on an approval that asks for a hold never approves it", async () => {
  queue = [proposal(1, "hold")];
  const host = await mount();
  expect(text(host)).toContain("Hold to approve");
  await press("a");
  expect(posts).toEqual([]);
});

test("a deep link puts its card first", async () => {
  queue = [
    card(1, "Nightly report failed", actions("run_again", "Run again")),
    card(2, "Weekly digest failed", actions("run_again", "Run again")),
  ];
  const host = await mount({ item: `card:${ID(2)}` });
  expect(text(host)).toContain("Weekly digest failed");
  expect(text(host)).not.toContain("Nightly report failed");
});

test("a lost connection carries the plugin's own setup, so it is repaired in the card", async () => {
  queue = [
    {
      ...card(1, "Example cannot sync", actions("reconnect", "Check again"), "connection_lost"),
      context: { plugin: "example" },
    },
  ];
  const host = await mount();
  expect(host.querySelector('[aria-label="Set up example"]')).not.toBeNull();
  // The panel is the plugin's, resolved from the catalog: its name and what it offers are there.
  await showing(host, "Example Plugin");
  expect(text(host)).toContain("Example Plugin");
  expect(button(host, "Check again")).toBeDefined();
  // Nothing in the card sends the person away to another page to do it.
  expect(button(host, "Reconnect")).toBeUndefined();
});

test("Check again looks at the queue again, and sends nothing", async () => {
  queue = [
    {
      ...card(1, "Example cannot sync", actions("reconnect", "Check again"), "connection_lost"),
      context: { plugin: "example" },
    },
  ];
  const host = await mount();
  const before = listReads;
  await act(async () => button(host, "Check again")?.click());
  await settle();
  expect(listReads).toBeGreaterThan(before);
  expect(posts).toEqual([]);
});

test("a card that is not about a plugin carries no setup panel", async () => {
  queue = [card(1, "Nightly report failed", actions("run_again", "Run again"))];
  const host = await mount();
  expect(host.querySelector('[aria-label^="Set up"]')).toBeNull();
});

const two = () => [
  card(1, "Nightly report failed", actions("run_again", "Run again")),
  card(2, "Weekly digest failed", actions("run_again", "Run again")),
];

test("Skip for now is in the same row as Dismiss and the main action", async () => {
  queue = two();
  const host = await mount();
  const skip = button(host, "Skip for now");
  expect(skip).toBeDefined();
  expect(skip?.parentElement).toBe(button(host, "Dismiss")?.parentElement);
  expect(skip?.parentElement).toBe(button(host, "Run again")?.parentElement);
});

test("an approval has Skip in its own action row too", async () => {
  queue = [
    proposal(1, "click"),
    card(2, "Weekly digest failed", actions("run_again", "Run again")),
  ];
  const host = await mount();
  const skip = button(host, "Skip for now");
  expect(skip).toBeDefined();
  expect(skip?.parentElement).toBe(button(host, "Deny")?.parentElement);
});

test("there is nothing to skip to when only one card waits", async () => {
  queue = [card(1, "Nightly report failed", actions("run_again", "Run again"))];
  const host = await mount();
  expect(button(host, "Skip for now")).toBeUndefined();
});

test("Skip for now shows the next card", async () => {
  queue = two();
  const host = await mount();
  await act(async () => button(host, "Skip for now")?.click());
  expect(text(host)).toContain("Weekly digest failed");
  expect(text(host)).not.toContain("Nightly report failed");
  expect(posts).toEqual([]);
});

test("deciding a card moves to the next one at once, without waiting for the list to be read again", async () => {
  // The server keeps answering with both cards: the page must not need a fresh list to move on.
  queue = two();
  const host = await mount();
  await act(async () => button(host, "Dismiss")?.click());
  await settle();
  expect(posts).toEqual([`POST /api/catch-up/${ID(1)}/deny`]);
  expect(text(host)).toContain("Weekly digest failed");
  expect(text(host)).not.toContain("Nightly report failed");
  expect(text(host)).toContain("2 of 2");
});

test("acting moves to the next card the same way", async () => {
  queue = two();
  const host = await mount();
  await act(async () => button(host, "Run again")?.click());
  await settle();
  expect(posts).toEqual([`POST /api/catch-up/${ID(1)}/act`]);
  expect(text(host)).toContain("Weekly digest failed");
});

test("a card that could not be decided stays, with the reason", async () => {
  queue = two();
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) =>
    init?.method === "POST"
      ? Response.json({ error: { code: "CONFLICT", message: "Not now" } }, { status: 409 })
      : real(input, init)) as typeof fetch;
  try {
    const host = await mount();
    await act(async () => button(host, "Dismiss")?.click());
    await settle();
    expect(text(host)).toContain("Nightly report failed");
    expect(text(host)).not.toContain("Weekly digest failed");
  } finally {
    globalThis.fetch = real;
  }
});

const broken = (n: number, title: string) => ({
  ...card(n, title, actions("reconnect", "Check again"), "connection_lost"),
  context: { plugin: "example" },
});

test("Check again moves on when the problem is still there, and says so when the card comes back", async () => {
  queue = [
    broken(1, "Example cannot sync"),
    card(2, "Weekly digest failed", actions("run_again", "Run again")),
  ];
  const host = await mount();
  await act(async () => button(host, "Check again")?.click());
  await settle();
  expect(text(host)).toContain("Weekly digest failed");
  await act(async () => button(host, "Skip for now")?.click());
  expect(text(host)).toContain("Example cannot sync");
  expect(text(host)).toContain("Still not fixed");
});

test("Check again clears the card once the problem is gone", async () => {
  queue = [
    broken(1, "Example cannot sync"),
    card(2, "Weekly digest failed", actions("run_again", "Run again")),
  ];
  const host = await mount();
  // Fixed in the plugin panel: the server no longer lists it.
  queue = [card(2, "Weekly digest failed", actions("run_again", "Run again"))];
  await act(async () => button(host, "Check again")?.click());
  await settle();
  expect(text(host)).toContain("Weekly digest failed");
  expect(text(host)).not.toContain("Example cannot sync");
  expect(text(host)).not.toContain("Still not fixed");
});

test("the page keeps the same safe margin as every other page, and scrolls inside it", async () => {
  queue = [card(1, "Nightly report failed", actions("run_again", "Run again"))];
  const host = await mount();
  const page = host.querySelector('section[aria-label="Inbox"]') as HTMLElement | null;
  expect(page?.className).toContain("p-4");
  expect(page?.className).toContain("md:p-8");
  expect(page?.parentElement?.className).toContain("overflow-y-auto");
});
