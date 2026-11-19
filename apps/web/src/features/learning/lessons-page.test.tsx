import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// The router restores the scroll position after each navigation; the test DOM has no window.scrollTo.
(globalThis as { scrollTo?: () => void }).scrollTo = () => {};

const BOT = "00000000-0000-7000-8000-000000000001";
const HURTS = "00000000-0000-7000-8000-0000000000a1";
const SKILL = "00000000-0000-7000-8000-0000000000a2";
const requests: string[] = [];
const posts: { path: string; body: unknown }[] = [];
const row = (over: Record<string, unknown>) => ({
  kind: "memory",
  id: HURTS,
  slug: "refund-rule",
  title: "Refund rule",
  howto: "How refunds work",
  tags: [],
  source: "owner",
  status: "current",
  uses: 6,
  good: 2,
  bad: 4,
  ambient: 0,
  lastUsedAt: "2026-11-16T00:00:00Z",
  label: "hurts",
  reason: "Used 6 times. The person stepped in after 67% of the replies that used it.",
  ...over,
});
const answer = (rows: unknown[]) => ({
  windowDays: 90,
  baselineBadRate: 0.2,
  counts: { hurts: 1, unused: 0, unclear: 0, helps: 1 },
  total: rows.length,
  rows,
});
const F1 = "00000000-0000-7000-8000-0000000000f1";
const F2 = "00000000-0000-7000-8000-0000000000f2";
const F3 = "00000000-0000-7000-8000-0000000000f3";
const finding = (id: string, over: Record<string, unknown>) => ({
  id,
  kind: "unused",
  botId: null,
  summary: "An item nobody used.",
  status: "open",
  createdAt: "2026-11-17T10:00:00Z",
  refs: [{ kind: "memory", id: HURTS, label: "Refund rule", slug: "refund-rule" }],
  ...over,
});
let findings: unknown[] = [];
let weeklyCreated = true;
const resetFindings = () => {
  findings = [
    finding(F1, { summary: "“Refund rule” was not used for 90 days. Accepting archives it." }),
    finding(F2, {
      kind: "check_pair",
      botId: BOT,
      summary: "These two lessons may pull in opposite directions.",
      refs: [
        {
          kind: "lesson",
          id: "00000000-0000-7000-8000-0000000000e1",
          label: "Send reports as a table",
          slug: null,
        },
        {
          kind: "lesson",
          id: "00000000-0000-7000-8000-0000000000e2",
          label: "Never use tables for reports",
          slug: null,
        },
      ],
    }),
    finding(F3, { kind: "duplicate", summary: "Two items say the same." }),
  ];
};
resetFindings();
const api = (path: string, method: string, body: unknown) => {
  if (method === "POST") posts.push({ path, body });
  if (path.startsWith("/api/learning/findings?")) return { findings };
  if (path === "/api/learning/workflow-template") return { id: "wf-1", created: weeklyCreated };
  if (/^\/api\/learning\/findings\/[^/]+\/(accept|dismiss)$/.test(path))
    return { id: "x", status: "accepted" };
  if (path === "/api/bots")
    return {
      bots: [{ id: BOT, name: "Da Vinci", kind: "specialist", avatar: null, canEdit: true }],
    };
  if (path.startsWith("/api/learning/usefulness")) {
    requests.push(path);
    if (path.includes("nomatch")) return answer([]);
    if (path.includes("view=archived"))
      return answer([row({ status: "archived", label: "unused" })]);
    return answer([
      row({}),
      row({
        kind: "skill",
        id: SKILL,
        slug: "sales-exports",
        title: "sales-exports",
        howto: "Use when the user asks for sales data.",
        label: "helps",
        good: 6,
        bad: 0,
        reason: "Used 6 times. The person stepped in after 0% of the replies that used it.",
      }),
    ]);
  }
  if (path === "/api/learning/archive" || path === "/api/learning/restore")
    return { done: (body as { items: unknown[] }).items.length, failed: [] };
  throw new Error(`unexpected ${method} ${path}`);
};
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  try {
    return Response.json(
      api(path, init?.method ?? "GET", init?.body ? JSON.parse(String(init.body)) : undefined),
    );
  } catch (e) {
    return Response.json(
      { error: { code: "TEST", message: (e as Error).message } },
      { status: 500 },
    );
  }
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));
const text = () => win.document.body.textContent ?? "";
/** Ticks the "Select all" box of the list. */
const selectAll = async () => {
  const box = (
    [...win.document.querySelectorAll('input[type="checkbox"]')] as unknown as HTMLInputElement[]
  ).find((b) => b.getAttribute("aria-label") === "Select all")!;
  await act(
    async () => void box.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
};
const press = async (label: string, nth = 0) => {
  const b = [...win.document.querySelectorAll("button")].filter(
    // The verdict buttons carry a count ("Hurts (1)"); every other button is matched by its whole text.
    (x) => x.textContent?.trim() === label || x.textContent?.trim().startsWith(`${label} (`),
  )[nth];
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};

type Search = import("./lessons-search").LessonsSearch;
/** The page in a stand-in for the router: the address is the state, and every change to it is recorded. */
const mount = async (initial: Search) => {
  const { LessonsPage } = await import("./lessons-page");
  const { withLessonsSearch } = await import("./lessons-search");
  const changes: { search: Search; replace: boolean }[] = [];
  function Address() {
    const [search, setAddress] = useState<Search>(initial);
    return (
      <LessonsPage
        search={search}
        setSearch={(patch, options) => {
          const next = withLessonsSearch(search, patch);
          changes.push({ search: next, replace: options?.replace ?? false });
          setAddress(next);
        }}
      />
    );
  }
  const root = createRootRoute({ component: Address });
  const stub = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => <p>{path}</p> });
  const router = createRouter({
    routeTree: root.addChildren([
      stub("/memory/$slug"),
      stub("/skills"),
      stub("/studio/$tab"),
      stub("/bots/$botId/settings"),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const rootEl = createRoot(host as unknown as Element);
  await act(async () =>
    rootEl.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  // Each test unmounts its page: two routers mounted in one test DOM crash the runner.
  return {
    changes,
    unmount: async () => {
      await act(async () => rootEl.unmount());
      host.remove();
    },
  };
};

test("the page lists what is worth keeping with the reason for each verdict, and reads its filters from the address", async () => {
  requests.length = 0;
  const { unmount } = await mount({ find: "refund", kind: "memory", sort: "best", label: "hurts" });
  expect(requests.at(-1)).toBe(
    "/api/learning/usefulness?find=refund&label=hurts&kind=memory&sort=best",
  );
  expect(text()).toContain("Refund rule");
  expect(text()).toContain("Hurts");
  expect(text()).toContain("The person stepped in after 67% of the replies that used it.");
  expect(text()).toContain("6 uses: 2 went well, 4 needed the person to step in");
  expect(text()).toContain("sales-exports");
  expect(text()).toContain("They stepped in after 20% of the bots' replies in general");
  // The title of a memory item goes to its page, a skill to the skills page.
  const links = [...win.document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  expect(links).toContain("/memory/refund-rule");
  expect(links.some((h) => h?.startsWith("/skills"))).toBe(true);
  await unmount();
});

test("choosing a verdict or the archive changes the address, and an empty answer says so", async () => {
  requests.length = 0;
  const { changes, unmount } = await mount({});
  await press("Hurts");
  expect(changes.at(-1)).toEqual({ search: { label: "hurts" }, replace: false });
  expect(requests.at(-1)).toContain("label=hurts");
  await press("Hurts"); // pressing it again clears the filter
  expect(changes.at(-1)!.search).toEqual({});
  await press("Archived");
  expect(changes.at(-1)).toEqual({ search: { view: "archived" }, replace: false });
  expect(requests.at(-1)).toContain("view=archived");
  expect(text()).not.toContain("Bring back"); // only once something is chosen
  await selectAll();
  expect(text()).toContain("Bring back");
  await unmount();

  const empty = await mount({ find: "nomatch" });
  expect(text()).toContain("Nothing matches these filters.");
  await empty.unmount();
});

test("select two items and archive them: one confirmation, one call with both, and a line that says what happened", async () => {
  posts.length = 0;
  const { unmount } = await mount({});
  await selectAll();
  expect(text()).toContain("2 selected");
  await press("Archive");
  expect(text()).toContain("Archive 2 items?");
  expect(posts).toEqual([]); // nothing happens before the person confirms
  await press("Yes, archive");
  expect(posts).toEqual([
    {
      path: "/api/learning/archive",
      body: {
        items: [
          { kind: "memory", id: HURTS },
          { kind: "skill", id: SKILL },
        ],
      },
    },
  ]);
  expect(text()).toContain("Archived 2.");
  await unmount();
});

test("the suggestions tab counts what waits, lists each with what accepting does, and keeps a pair for the person to choose", async () => {
  resetFindings();
  const { changes, unmount } = await mount({});
  expect(text()).toContain("Suggestions (3)");
  await press("Suggestions (3)");
  expect(changes.at(-1)).toEqual({ search: { tab: "suggestions" }, replace: false });
  expect(text()).toContain("“Refund rule” was not used for 90 days. Accepting archives it.");
  expect(text()).toContain("These two lessons may pull in opposite directions.");
  expect(text()).toContain("Memory: Refund rule");
  expect(text()).toContain("Lesson: Never use tables for reports");
  // A pair asks which of the two to drop; the others can be accepted as they are or ticked together.
  expect(text()).toContain("Drop the first");
  expect(text()).toContain("Drop the second");
  const links = [...win.document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  expect(links).toContain("/memory/refund-rule");
  await unmount();
});

test("accept, a pair's choice, dismiss and bulk accept are each one call, after a question where something changes", async () => {
  resetFindings();
  posts.length = 0;
  const { unmount } = await mount({ tab: "suggestions" });
  await press("Dismiss", 0);
  await press("Drop the second");
  expect(posts.at(-1)).toBeDefined();
  await press("Yes, drop it");
  await press("Accept", 0);
  await press("Yes, do it");
  expect(posts).toEqual([
    { path: `/api/learning/findings/${F1}/dismiss`, body: undefined },
    {
      path: `/api/learning/findings/${F2}/accept`,
      body: { drop: "00000000-0000-7000-8000-0000000000e2" },
    },
    { path: `/api/learning/findings/${F1}/accept`, body: {} },
  ]);
  await unmount();

  resetFindings();
  posts.length = 0;
  const bulk = await mount({ tab: "suggestions" });
  await selectAll(); // the pair needs a choice, so it is not ticked
  expect(text()).toContain("2 selected");
  await press("Accept selected");
  await press("Yes, accept");
  expect(posts.map((p) => p.path)).toEqual([
    `/api/learning/findings/${F1}/accept`,
    `/api/learning/findings/${F3}/accept`,
  ]);
  expect(text()).toContain("Done: 2.");
  await bulk.unmount();
});

test("with nothing to tidy it says so", async () => {
  findings = [];
  const { unmount } = await mount({ tab: "suggestions" });
  expect(text()).toContain("Nothing to tidy up.");
  expect(text()).toContain("Worth keeping");
  await unmount();
  resetFindings();
});

test("the weekly check is added with one click, and says when the person already had it", async () => {
  posts.length = 0;
  weeklyCreated = true;
  const first = await mount({});
  expect(text()).toContain("Check these every week");
  await press("Add the weekly check to my workflows");
  expect(posts.at(-1)).toEqual({ path: "/api/learning/workflow-template", body: undefined });
  expect(text()).toContain("Added.");
  expect([...win.document.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain(
    "/studio/workflows",
  );
  await first.unmount();
  weeklyCreated = false;
  const again = await mount({});
  await press("Add the weekly check to my workflows");
  expect(text()).toContain("You already have it.");
  await again.unmount();
  weeklyCreated = true;
});
