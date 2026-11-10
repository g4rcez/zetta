import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";

import { setupDom } from "../skills/dom-env";
import type { BotImportDraft, GrokListItem } from "./grok-api";
import { withBotsNewSearch, type BotsNewSearch } from "./bots-new-search";

const win = setupDom();
(globalThis as { scrollTo?: () => void }).scrollTo = () => {};
// Bun's own FormData cannot read a DOM form; the page uses the browser's.
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  delete (globalThis as { scrollTo?: () => void }).scrollTo;
  globalThis.FormData = bunFormData;
});

// Invented bots only: nothing here is copied from the real marketplace.
const preset = { kind: "preset" as const, preset: "circle", colors: ["#4a80e6"] };
const item = (id: string, name: string, over: Partial<GrokListItem> = {}): GrokListItem => ({
  id,
  name,
  creatorName: "Example Creator",
  handle: null,
  summary: `${name} does one job.`,
  categories: ["Operations"],
  color: "blue",
  shape: "circle",
  imageUrl: null,
  avatar: preset,
  ...over,
});
const catalog = [
  item("example-bot", "Example Bot", { categories: ["Operations"] }),
  item("sales-bot", "Sales Bot", { categories: ["Sales"] }),
  item("design-bot", "Design Bot", { categories: ["Design"] }),
];
const preview = {
  id: "example-bot",
  url: "https://x.ai/bot/marketplace/bots/example-bot",
  name: "Example Bot",
  creatorName: "Example Creator",
  handle: null,
  description: "Checks a list every morning.",
  categories: ["Operations"],
  avatar: preset,
  memories: ["The list lives in a sheet."],
  skills: [{ name: "Check the list", description: "Use this when asked to check the list." }],
  routines: [{ name: "morning-check", text: "Cron 44 8 * * 1-5", schedule: "weekdays at 08:44" }],
  integrations: [
    { name: "Google Calendar", description: "Reads events.", pluginId: "google" },
    { name: "Ramp", description: "Reads spend.", pluginId: null },
  ],
};
const draft = (): BotImportDraft => ({
  source: {
    url: "https://x.ai/bot/marketplace/bots/example-bot",
    slug: "example-bot",
    creator: "Example Creator",
    handle: null,
  },
  name: "Example Bot",
  description: "Checks a list every morning.",
  avatar: preset,
  personality: "Brief and calm.",
  instructions: "Check the list and report what changed.",
  timezone: "America/Sao_Paulo",
  skills: [
    {
      sourceId: "skill-0",
      name: "check-the-list",
      description: "Use this when asked to check the list.",
      body: "# Check\n\n1. Open the sheet.",
      warnings: [],
    },
    {
      sourceId: "skill-1",
      name: "weekly-summary",
      description: "Use this on Mondays.",
      body: "Use this on Mondays.",
      warnings: ["not_expanded"],
    },
  ],
  notes: [{ sourceId: "memory-0", content: "The list lives in a sheet.", warnings: [] }],
  routines: [
    {
      sourceId: "routine-0",
      title: "morning-check",
      prompt: "Run the check.",
      schedule: { kind: "daily", dailyAt: "08:44", weekdays: [1, 2, 3, 4, 5] },
      state: "active",
      note: null,
    },
    {
      sourceId: "routine-1",
      title: "monthly",
      prompt: "Send the report.",
      schedule: { kind: "unsupported", expression: "0 9 1 * *" },
      state: "paused",
      note: 'The schedule "0 9 1 * *" can\'t run in Zetta yet. Pick a time to switch it on.',
    },
  ],
  integrations: preview.integrations,
  warnings: [
    "The instructions and skill playbooks were written by your Chief from the short descriptions the marketplace shows. Read them before you create the bot.",
  ],
});

let analyzes: Record<string, unknown>[] = [];
let installs: Record<string, any>[] = [];
let analyzeFails = false;
let installError: string | null = null;
let created: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const ok = (v: unknown, status = 200) => Response.json(v, { status });
  if (url.pathname === "/api/bot-import/grok") return ok({ bots: catalog });
  if (url.pathname === "/api/bot-import/grok/example-bot") return ok({ bot: preview });
  if (url.pathname === "/api/bot-import/grok/analyze") {
    analyzes.push(body);
    return analyzeFails
      ? ok(
          {
            error: {
              code: "NO_CHIEF_ENGINE",
              message: "Your Chief needs a real engine to adapt a bot.",
            },
          },
          409,
        )
      : ok({ draft: draft() });
  }
  if (url.pathname === "/api/bot-import/install") {
    installs.push(body);
    if (installError) return ok({ error: { code: "DUPLICATE", message: installError } }, 409);
    const d = body.draft as BotImportDraft;
    created = [
      {
        id: "00000000-0000-7000-8000-0000000000aa",
        kind: "specialist",
        name: d.name,
        description: d.description,
        visibility: "private",
        canEdit: true,
        version: 1,
        onboarded: true,
        harness: "claude-code",
        model: null,
        personality: d.personality,
        instructions: d.instructions,
        avatar: d.avatar,
      },
    ];
    return ok(
      {
        result: {
          bot: { id: "00000000-0000-7000-8000-0000000000aa", name: d.name, slug: "example-bot" },
          skills: d.skills.map((s) => ({ id: s.name, name: s.name })),
          notes: d.notes.length,
          routines: d.routines.map((r) => ({
            id: r.title,
            title: r.title,
            state: r.state,
            reason: r.note,
          })),
          integrations: d.integrations,
          warnings: [],
        },
      },
      201,
    );
  }
  if (url.pathname === "/api/bots") return ok({ bots: created });
  if (url.pathname === "/api/conversations") return ok({ conversations: [] });
  if (url.pathname === "/api/folders") return ok({ folders: [] });
  if (url.pathname === "/api/harnesses")
    return ok({
      harnesses: [
        {
          harness: "claude-code",
          label: "Claude Code",
          installed: true,
          status: "ready",
          perUserLogin: false,
        },
      ],
    });
  if (url.pathname === "/api/plugins/catalog") return ok({ plugins: [] });
  if (url.pathname === "/api/plugins") return ok({ plugins: [] });
  // The plugins step that follows creating a bot.
  if (/^\/api\/bots\/[^/]+\/(plugins|integrations|mcp)/.test(url.pathname))
    return ok({ plugins: [], integrations: [], servers: [], bound: [] });
  if (url.pathname === "/api/mcp/servers" || url.pathname === "/api/mcp")
    return ok({ servers: [] });
  return ok({ error: { code: "TEST", message: `unexpected ${method} ${url.pathname}` } }, 500);
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const text = () => win.document.body.textContent ?? "";
const click = async (el: Element | null | undefined, what: string) => {
  if (!el) throw new Error(`no ${what} in: ${text().slice(0, 500)}`);
  await act(async () => void el.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const press = (label: string) =>
  click(
    [...win.document.querySelectorAll("button")].find((x) => x.textContent?.trim() === label),
    `button "${label}"`,
  );
const setValue = async (el: Element | null, value: string) => {
  if (!el) throw new Error("no field");
  // React tracks the value it last saw on the node itself; the prototype setter changes it without telling that tracker.
  const proto =
    el instanceof win.HTMLSelectElement
      ? win.HTMLSelectElement.prototype
      : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  // One event per act, as the other page tests do: the library input reacts to one of them, a plain select to the other.
  await act(async () => void el.dispatchEvent(new win.Event("input", { bubbles: true })));
  await act(async () => void el.dispatchEvent(new win.Event("change", { bubbles: true })));
  await settle();
};
const field = (title: string) => {
  const label = [...win.document.querySelectorAll("label")].find((l) =>
    l.textContent?.trim().startsWith(title),
  );
  return (label?.querySelector("input, select") ??
    (label?.getAttribute("for")
      ? win.document.getElementById(label.getAttribute("for")!)
      : null)) as Element | null;
};

let patches: Partial<Record<keyof BotsNewSearch, string | undefined>>[] = [];
async function mount(initial: BotsNewSearch) {
  // A test that fails before it unmounts must not leave its page for the next one.
  win.document.body.replaceChildren();
  analyzes = [];
  installs = [];
  patches = [];
  created = [];
  analyzeFails = false;
  installError = null;
  // Imported here, after the fake window exists: React DOM decides at load time whether the browser has the `input` event, and
  // without a window it falls back to a path that never hears a text field change.
  const { createRoot } = await import("react-dom/client");
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { SidebarDataProvider } = await import("../chat/sidebar-data");
  const { BotOnboarding } = await import("./bot-onboarding");
  /** Holds the address's search the way the route does, so the page reads and writes it through props. */
  function Host() {
    const [search, setSearch] = useState(initial);
    return (
      <BotOnboarding
        search={search}
        setSearch={(patch) => {
          patches.push(patch);
          setSearch((s) => withBotsNewSearch(s, patch));
        }}
      />
    );
  }
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <SidebarDataProvider>
            <Host />
          </SidebarDataProvider>
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
  return () => act(async () => root.unmount());
}

test("the marketplace tab shows the catalog instead of the templates, and has no Continue button", async () => {
  const unmount = await mount({ source: "grok" });
  for (const b of catalog) expect(text()).toContain(b.name);
  expect(win.document.querySelector('input[name="origin"][value="researcher"]')).toBeNull();
  expect(text()).not.toContain("Continue");
  expect(text()).not.toContain("Customize");
  await unmount();
});

test("the templates tab is still the default, and the tab switch writes the address", async () => {
  const unmount = await mount({});
  expect(win.document.querySelector('input[name="origin"][value="researcher"]')).toBeTruthy();
  await click(win.document.querySelector('[role="tab"][aria-selected="false"]'), "marketplace tab");
  expect(patches.at(-1)).toEqual({ source: "grok" });
  expect(text()).toContain("Sales Bot");
  await click(win.document.querySelector('[role="tab"][aria-selected="false"]'), "templates tab");
  expect(patches.at(-1)).toEqual({ source: undefined });
  await unmount();
});

test("search and category come from the address, and typing writes it back", async () => {
  const unmount = await mount({ source: "grok", q: "sales" });
  expect(text()).toContain("Sales Bot");
  expect(text()).not.toContain("Design Bot");
  expect((field("Search the marketplace") as HTMLInputElement | null)?.value).toBe("sales");
  await unmount();
  const second = await mount({ source: "grok", category: "Design" });
  expect(text()).toContain("Design Bot");
  expect(text()).not.toContain("Sales Bot");
  await second();
});

test("nothing matches: it says so", async () => {
  const unmount = await mount({ source: "grok", q: "zzzzzz" });
  expect(text()).toContain("No bot matches");
  await unmount();
});

test("opening a bot shows what it holds, in the address", async () => {
  const unmount = await mount({ source: "grok" });
  await click(
    win.document.querySelector('input[name="grok"][value="example-bot"]'),
    "Example Bot card",
  );
  expect(patches.at(-1)).toEqual({ grok: "example-bot" });
  expect(text()).toContain("Check the list");
  expect(text()).toContain("weekdays at 08:44");
  expect(text()).toContain("Zetta has a plugin");
  expect(text()).toContain("No Zetta equivalent");
  expect(installs).toHaveLength(0);
  await unmount();
});

/** Sets a field's own text and sends its form, as pressing Enter would. The box is uncontrolled: nothing listens for typing. */
const submitLink = async (value: string) => {
  const input = win.document.querySelector('input[name="link"]') as HTMLInputElement;
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(
    async () =>
      void input.form!.dispatchEvent(
        new win.Event("submit", { bubbles: true, cancelable: true }) as never,
      ),
  );
  await settle();
};

test("a link that is not a marketplace bot is refused with a reason; a real one opens the bot", async () => {
  const unmount = await mount({ source: "grok" });
  await submitLink("https://evil.example.invalid/bot/marketplace/bots/example-bot");
  expect(text()).toContain("not a Grok Bot marketplace bot link");
  expect(patches.some((p) => p.grok)).toBe(false);
  await submitLink("");
  expect(text()).toContain("Paste the bot's link first");
  await submitLink("https://x.ai/bot/marketplace/bots/example-bot/");
  expect(patches.at(-1)).toEqual({ grok: "example-bot" });
  expect(text()).not.toContain("not a Grok Bot marketplace bot link");
  await submitLink("example-bot");
  expect(patches.at(-1)).toEqual({ grok: "example-bot" });
  await unmount();
});

test("adapting sends the bot and the person's timezone, creates nothing, and opens the review", async () => {
  const unmount = await mount({ source: "grok", grok: "example-bot" });
  await press("Adapt and review");
  expect(analyzes).toHaveLength(1);
  expect(analyzes[0]).toMatchObject({
    source: "example-bot",
    timezone: expect.stringMatching(/\S/),
  });
  expect(installs).toHaveLength(0);
  expect(text()).toContain("Read it over before it exists");
  expect(text()).toContain("Nothing is created until you press Create");
  expect((field("Name") as HTMLInputElement).value).toBe("Example Bot");
  expect(text()).toContain("Skills (2)");
  expect(text()).toContain("weekdays at 08:44 (America/Sao_Paulo)");
  expect(text()).toContain("Plugins & tools"); // the step list is still there, but locked
  expect(text()).toContain("written by your Chief");
  expect(text()).toContain("Only the marketplace's one-line description was available");
  expect(text()).toContain("Zetta plugin: google");
  expect(text()).toContain("No Zetta equivalent");
  await unmount();
});

test("the steps are locked while a draft is open", async () => {
  const unmount = await mount({ source: "grok", grok: "example-bot" });
  await press("Adapt and review");
  const steps = [
    ...win.document.querySelectorAll('nav[aria-label="Steps"] button'),
  ] as HTMLButtonElement[];
  expect(steps.length).toBeGreaterThan(0);
  expect(steps.every((b) => b.disabled)).toBe(true);
  await unmount();
});

test("a routine whose schedule cannot run is paused and cannot be switched on", async () => {
  const unmount = await mount({ source: "grok", grok: "example-bot" });
  await press("Adapt and review");
  expect(text()).toContain("can't run in Zetta yet");
  const selects = [...win.document.querySelectorAll("select")] as HTMLSelectElement[];
  const monthly = selects[1]!;
  expect(monthly.disabled).toBe(true);
  expect(monthly.value).toBe("paused");
  await unmount();
});

test("the person's edits are what is created: a skill, a note and a routine left out, another routine kept paused", async () => {
  const unmount = await mount({ source: "grok", grok: "example-bot" });
  await press("Adapt and review");
  await press("Leave this skill out"); // the first skill
  await press("Leave out"); // the only note
  await press("Leave this routine out"); // the first routine, so the monthly one remains
  expect(text()).toContain("Skills (1)");
  await press("Create Example Bot");
  expect(installs).toHaveLength(1);
  const sent = installs[0]!.draft as BotImportDraft;
  expect(sent.skills.map((s) => s.name)).toEqual(["weekly-summary"]);
  expect(sent.notes).toEqual([]);
  expect(sent.routines.map((r) => r.title)).toEqual(["monthly"]);
  expect(sent.routines[0]).toMatchObject({ state: "paused" });
  await unmount();
});

test("a routine can be kept paused from the list of choices", async () => {
  const unmount = await mount({ source: "grok", grok: "example-bot" });
  await press("Adapt and review");
  const select = win.document.querySelectorAll("select")[0] as HTMLSelectElement;
  expect(select.value).toBe("active");
  await setValue(select, "paused");
  await press("Create Example Bot");
  expect((installs[0]!.draft as BotImportDraft).routines[0]).toMatchObject({
    title: "morning-check",
    state: "paused",
  });
  await unmount();
});

test("after it is created the wizard carries on at the plugins step and says what was made and what is still needed", async () => {
  const unmount = await mount({ source: "grok", grok: "example-bot" });
  await press("Adapt and review");
  await press("Create Example Bot");
  expect(text()).toContain(
    "Example Bot is created with 2 skills, 1 note and 2 routines (1 running, 1 paused)",
  );
  expect(text()).toContain("It needs Google Calendar, Ramp");
  expect(text()).toContain("Which tools may it use?");
  expect(text()).not.toContain("Read it over before it exists");
  await unmount();
});

test("going back discards the draft and creates nothing", async () => {
  const unmount = await mount({ source: "grok", grok: "example-bot" });
  await press("Adapt and review");
  await press("Back to the marketplace");
  expect(text()).toContain("Sales Bot");
  expect(text()).not.toContain("Read it over before it exists");
  expect(installs).toHaveLength(0);
  await unmount();
});

test("when adapting fails the reason is shown and the person stays where they were", async () => {
  const unmount = await mount({ source: "grok", grok: "example-bot" });
  analyzeFails = true;
  await press("Adapt and review");
  expect(text()).toContain("Your Chief needs a real engine to adapt a bot.");
  expect(text()).not.toContain("Read it over before it exists");
  expect(text()).toContain("Adapt and review"); // can try again
  await unmount();
});

test("when creating fails the reason is shown inside the review, with the edits kept", async () => {
  const unmount = await mount({ source: "grok", grok: "example-bot" });
  await press("Adapt and review");
  await press("Leave this skill out");
  expect(text()).toContain("Skills (1)");
  installError =
    "There is already a skill called weekly-summary. Rename it in the review and try again.";
  await press("Create Example Bot");
  expect(text()).toContain("There is already a skill called weekly-summary");
  expect(text()).toContain("Read it over before it exists");
  expect(text()).toContain("Skills (1)"); // the edit is still there
  // Fix the cause and try again: it goes through.
  installError = null;
  await press("Create Example Bot");
  expect(text()).toContain("Example Bot is created with 1 skill");
  await unmount();
});
