import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const BOT = "00000000-0000-7000-8000-000000000001";
const id = (n: number) => `00000000-0000-7000-8000-0000000000b${n}`;
const calls: { method: string; path: string; body: unknown }[] = [];
let overview: Record<string, unknown>;
let lessons: unknown[];

const lesson = (n: number, over: Record<string, unknown>) => ({
  id: id(n),
  botId: BOT,
  text: `Lesson ${n}`,
  topic: "reports",
  kind: "rule",
  scope: "topic",
  status: "trial",
  basis: "said",
  origin: "batch",
  dropReason: null,
  memorySlug: `lesson-${n}`,
  skillName: null,
  createdAt: "2026-11-17T10:00:00Z",
  updatedAt: "2026-11-17T10:00:00Z",
  evidence: [{ quote: `exact words ${n}`, day: "2026-11-17", conversationId: null }],
  seen: { chats: 1, days: 1 },
  events: [],
  results: null,
  ...over,
});

const reset = () => {
  calls.length = 0;
  overview = {
    bot: { id: BOT, name: "Da Vinci", autoLearn: "auto" },
    runs: [
      {
        id: "r1",
        trigger: "daily",
        status: "done",
        detail: "1 started on trial",
        candidates: 1,
        promoted: 1,
        startedAt: "2026-11-17T08:00:00Z",
        finishedAt: "2026-11-17T08:01:00Z",
      },
    ],
    runNowAfter: null,
  };
  lessons = [
    lesson(1, { status: "candidate", basis: "said", text: "Send client reports as a table." }),
    lesson(2, {
      status: "candidate",
      basis: null,
      text: "Keep answers short.",
      evidence: [{ quote: "keep the answer short", day: "2026-11-16", conversationId: null }],
    }),
    lesson(3, {
      status: "trial",
      text: "Answer in Portuguese.",
      scope: "always",
      results: {
        uses: 3,
        good: 3,
        bad: 0,
        label: "unclear",
        reason: "Used 3 times; only 3 of those replies were judged so far (it takes 5).",
        lastUsedAt: null,
      },
    }),
    lesson(4, {
      status: "kept",
      text: "Greet the client by first name.",
      basis: "repeated",
      seen: { chats: 2, days: 2 },
    }),
    lesson(5, { status: "dropped", dropReason: "bad_results", text: "Use the old export." }),
    lesson(6, {
      status: "candidate",
      basis: "said",
      kind: "procedure",
      text: "First export, then check the totals, then mail it.",
    }),
  ];
};
reset();

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (method !== "GET") calls.push({ method, path, body });
  const json = (v: unknown) => Response.json(v);
  if (path.startsWith("/api/lessons?")) return json({ lessons });
  if (path === `/api/bots/${BOT}/learning` && method === "GET") return json(overview);
  if (path === `/api/bots/${BOT}/learning/run`)
    return json({ run: { id: "r2", status: "running" } });
  if (path === "/api/learning/policy" && method === "GET")
    return json({ policy: { batch: "daily", forget: "on", tidy: "weekly", strictness: "normal" } });
  if (/^\/api\/lessons\/[^/]+\/(accept|reject|keep|drop|restore)$/.test(path))
    return json({ lesson: {} });
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${method} ${path}` } },
    { status: 500 },
  );
}) as typeof fetch;

// Long enough for the page's three requests to land (the lessons, the readings and what the person allows).
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 90))));
const text = () => win.document.body.textContent ?? "";
const press = async (label: string, nth = 0) => {
  const b = [...win.document.querySelectorAll("button")].filter(
    (x) => x.textContent?.trim() === label,
  )[nth];
  if (!b) throw new Error(`no button "${label}" #${nth} in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};

const mount = async (autoLearn: "auto" | "suggest" | "off" = "auto") => {
  const { LessonsSection } = await import("./lessons-section");
  const bot = {
    id: BOT,
    name: "Da Vinci",
    kind: "specialist",
    avatar: null,
    canEdit: true,
    autoLearn,
  } as never;
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <LessonsSection bot={bot} bots={[bot]} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return {
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
};

test("the lessons are grouped by where they stand, each with the person's own words as proof", async () => {
  reset();
  const { unmount } = await mount();
  expect(text()).toContain("Waiting for you (2)");
  expect(text()).toContain("Waiting for a second time (1)");
  expect(text()).toContain("On trial (1)");
  expect(text()).toContain("Kept (1)");
  expect(text()).toContain("Send client reports as a table.");
  expect(text()).toContain("You wrote: “exact words 1” · 2026-11-17");
  expect(text()).toContain("You said it outright.");
  expect(text()).toContain("seen in 2 chats on 2 days");
  expect(text()).toContain("Every reply"); // a lesson that applies to every reply says so
  expect(text()).toContain("Used 3 times; only 3 of those replies were judged so far");
  // Steps are never started on their own: no "Start it" for them, and they say so. A short rule that is still waiting for a second
  // sighting may be started by the person (they are the second sighting).
  expect(text()).toContain("It is steps: turn it into a memory item or a skill yourself.");
  const starts = [...win.document.querySelectorAll("button")].filter(
    (b) => b.textContent?.trim() === "Start it",
  );
  expect(starts).toHaveLength(2);
  // What was dropped stays out of the way until asked for.
  expect(text()).not.toContain("Use the old export.");
  expect(text()).toContain("Show dropped and turned down (1)");
  expect(text()).toContain("Last read");
  expect(text()).toContain("1 started on trial");
  await unmount();
});

test("each action is one call to the lesson, and a dropped lesson can be brought back", async () => {
  reset();
  const { unmount } = await mount();
  await press("Start it");
  await press("Keep");
  await press("Drop", 0);
  await press("Show dropped and turned down (1)");
  expect(text()).toContain("Use the old export.");
  expect(text()).toContain("You had to step in too often after it.");
  await press("Bring back");
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
    `POST /api/lessons/${id(1)}/accept`,
    `POST /api/lessons/${id(3)}/keep`,
    `POST /api/lessons/${id(3)}/drop`,
    `POST /api/lessons/${id(5)}/restore`,
  ]);
  await unmount();
});

test("an edit opens the lesson in the text box, and Save waits for a change", async () => {
  reset();
  const { unmount } = await mount();
  await press("Edit", 0);
  expect(text()).toContain("The lesson");
  const save = [...win.document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Save",
  )!;
  expect(save.hasAttribute("disabled")).toBe(true); // nothing changed yet
  await press("Cancel");
  expect(text()).not.toContain("The lesson");
  await unmount();
});

test("Read my chats now starts a reading; it is held back while a reading goes on or an hour has not passed, and off for a bot that does not learn", async () => {
  reset();
  const first = await mount();
  await press("Read my chats now");
  expect(calls.at(-1)).toEqual({
    method: "POST",
    path: `/api/bots/${BOT}/learning/run`,
    body: undefined,
  });
  expect(text()).toContain("Reading your chats. The result appears below.");
  await first.unmount();

  reset();
  overview.runNowAfter = new Date(Date.now() + 40 * 60_000).toISOString();
  const cooling = await mount();
  const button = [...win.document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Read my chats now"),
  )!;
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(text()).toContain("Open again in");
  await cooling.unmount();

  reset();
  (overview.runs as { status: string }[])[0]!.status = "running";
  const reading = await mount();
  expect(text()).toContain("Reading your chats…");
  expect(
    [...win.document.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Reading your chats"))!
      .hasAttribute("disabled"),
  ).toBe(true);
  await reading.unmount();

  reset();
  const off = await mount("off");
  expect(text()).toContain("This bot is set not to learn.");
  expect(
    [...win.document.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Read my chats now"))!
      .hasAttribute("disabled"),
  ).toBe(true);
  await off.unmount();
});

test("what may happen by itself shows the person's choices", async () => {
  reset();
  const { unmount } = await mount();
  expect(text()).toContain("Read my chats");
  expect(text()).toContain("Once a day");
  expect(text()).toContain("Lessons that do not help");
  expect(text()).toContain("Drop them by themselves");
  expect(text()).toContain("Normal: kept after 5 uses, dropped after 2 bad ones");
  await unmount();
});

test("with nothing learned yet it says how a bot learns", async () => {
  reset();
  lessons = [];
  const { unmount } = await mount();
  expect(text()).toContain("Nothing learned yet.");
  await unmount();
});
