import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { INTERNAL_WORDS, defaultWorkOptions } from "@zetta/core/work-suggestions";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// The router restores scroll on load; the test DOM has no `scrollTo`.
Object.assign(globalThis, { scrollTo: () => {} });

const BOT = "01a19da2-3c92-783a-b90d-c35975f3c60c";
const TASK = "01a1ce15-6b98-7fa6-a72d-0885e1cc5199";
const ID = (n: number) => `01a1ce15-6b98-7fa6-a72d-0885e1cc51${String(n).padStart(2, "0")}`;
const worker = { kind: "bot" as const, id: BOT, name: "Dev Bot" };
const ana = { kind: "person" as const, id: "u1", name: "Ana Lima" };
const card = (n: number, kind: string, title: string, over: object = {}, work: object = {}) => ({
  key: `card:${ID(n)}`,
  source: "card",
  id: ID(n),
  kind,
  subjectId: TASK,
  botId: BOT,
  title,
  detail: "It was on step 3 of 5. It tried 3 times and nothing changed.",
  nextAction: "",
  resultLink: `/tasks/${TASK}`,
  occurrences: 1,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  context: {},
  actions: {
    act: "choose",
    actLabel: "Choose",
    deny: "not_now",
    denyLabel: "Not now",
    input: "optional_text",
  },
  ...over,
  work: {
    summary: "",
    options: defaultWorkOptions(kind as never, { worker }),
    candidates: [
      { key: "bot:b2", kind: "bot", name: "Painter" },
      { key: "person:u1", kind: "person", name: "Ana Lima" },
    ],
    history: [],
    task: { id: TASK, title: "Launch email", status: "in_progress", stepsDone: 2, stepsTotal: 5 },
    worker,
    since: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    note: "Drafted the intro.",
    project: { id: ID(90), name: "Spring launch" },
    ...work,
  },
});

let queue: unknown[] = [];
let posts: { call: string; body: unknown }[] = [];
let failWith: string | undefined;
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (method !== "GET") {
    posts.push({ call: `${method} ${url.pathname}`, body: JSON.parse(String(init?.body ?? "{}")) });
    if (failWith)
      return Response.json({ error: { code: "X", message: failWith } }, { status: 409 });
    return Response.json({
      ok: true,
      done: "Sent to Dev Bot. It reads it now and goes on from there.",
    });
  }
  if (url.pathname === "/api/catch-up") return Response.json({ items: queue });
  if (url.pathname === "/api/bots")
    return Response.json({ bots: [{ id: BOT, name: "Dev Bot", kind: "specialist" }] });
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  queue = [];
  posts = [];
  failWith = undefined;
});
const settle = (ms = 60) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const mount = async () => {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { CatchUpPage } = await import("./catch-up-page");
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <CatchUpPage search={{}} onSearch={() => {}} isAdmin={false} />
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
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
const click = async (el: Element | undefined) => {
  await act(
    async () => void el!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
};
const press = async (key: string) => {
  await act(async () => {
    (win as unknown as EventTarget).dispatchEvent(
      new win.KeyboardEvent("keydown", { key, bubbles: true }) as never,
    );
  });
  await settle();
};

test("a stopped bot: what happened, what is known and what each next step does", async () => {
  queue = [card(1, "work_stuck", "Dev Bot stopped on “Launch email”")];
  const host = await mount();
  const body = text(host);
  expect(body).toContain("Dev Bot stopped on “Launch email”");
  expect(body).toContain("It tried 3 times and nothing changed.");
  expect(body).toContain("2 of 5 steps done");
  expect(body).toContain("Their last note: Drafted the intro.");
  expect(body).toContain("Spring launch");
  const steps = [...host.querySelectorAll("[data-catch-up-option]")].map((b) => b.textContent);
  expect(steps).toHaveLength(4);
  expect(steps[0]).toContain("Tell it what to do");
  expect(steps[0]).toContain("Your message goes to Dev Bot in its chat");
  expect(steps[1]).toContain("Ask it to continue");
  expect(steps[1]).toContain("Dev Bot picks the task up again where it stopped.");
  expect(steps[3]).toContain("This card goes away until tomorrow");
  expect(button(host, "Not now")).toBeDefined();
  expect(body).not.toMatch(INTERNAL_WORDS);
});

test("a number presses that step; a step with nothing to fill in is sent at once", async () => {
  queue = [card(1, "work_stuck", "Dev Bot stopped on “Launch email”")];
  await mount();
  await press("2");
  expect(posts).toEqual([{ call: `POST /api/catch-up/${ID(1)}/act`, body: { option: "resume" } }]);
});

test("a step that sends words shows them first, and sends nothing while the box is empty", async () => {
  queue = [
    card(
      1,
      "work_stuck",
      "Dev Bot stopped on “Launch email”",
      {},
      {
        summary: "It rewrote the intro three times and never got to the offer.",
        options: [
          {
            id: "tell:1",
            action: "tell",
            label: "Tell it to skip the intro",
            effect: "Your message goes to Dev Bot in its chat, and it goes on from there.",
            input: "text",
            risk: "none",
            text: "Keep the intro as it is and write the offer next.",
          },
          ...defaultWorkOptions("work_stuck", { worker }),
        ].slice(0, 4),
      },
    ),
  ];
  const host = await mount();
  // What Zetta read into the situation replaces the plain detail.
  expect(text(host)).toContain("It rewrote the intro three times");
  // The A key opens the first step: its words are shown, nothing is sent yet.
  await press("a");
  expect(posts).toEqual([]);
  expect(text(host)).toContain("Your message goes to Dev Bot in its chat");
  expect(text(host)).toContain("Keep the intro as it is and write the offer next.");
  await click(host.querySelector('[data-catch-up="send"]') ?? undefined);
  expect(posts).toEqual([
    {
      call: `POST /api/catch-up/${ID(1)}/act`,
      body: { option: "tell:1", text: "Keep the intro as it is and write the offer next." },
    },
  ]);
});

test("an empty message is asked for, not sent", async () => {
  queue = [card(1, "work_stuck", "Dev Bot stopped on “Launch email”")];
  const host = await mount();
  await press("1");
  await click(host.querySelector('[data-catch-up="send"]') ?? undefined);
  expect(text(host)).toContain("Write a message first.");
  expect(posts).toEqual([]);
  // Back returns to the steps without sending anything.
  await click(button(host, "Back"));
  expect(host.querySelectorAll("[data-catch-up-option]")).toHaveLength(4);
});

test("giving the task away asks who gets it", async () => {
  queue = [card(1, "work_stuck", "Dev Bot stopped on “Launch email”")];
  const host = await mount();
  await press("3");
  expect(text(host)).toContain("The task moves to who you pick, and they are told.");
  // The library adds an empty first choice of its own; the people and bots follow it.
  const options = [...host.querySelectorAll("select option")]
    .map((o) => o.textContent)
    .filter((label) => label === "Painter (bot)" || label === "Ana Lima");
  expect(options).toEqual(["Painter (bot)", "Ana Lima"]);
  const select = host.querySelector("select") as unknown as HTMLSelectElement;
  expect(select.value).toBe("bot:b2");
  await click(host.querySelector('[data-catch-up="send"]') ?? undefined);
  expect(posts).toEqual([
    { call: `POST /api/catch-up/${ID(1)}/act`, body: { option: "reassign", target: "bot:b2" } },
  ]);
});

test("a step that cannot be taken back waits, and Undo stops it", async () => {
  queue = [
    card(
      1,
      "work_stuck",
      "Dev Bot stopped on “Launch email”",
      {},
      {
        options: [
          {
            id: "drop",
            action: "drop",
            label: "Drop the task",
            effect: "The task is deleted. You have a few seconds to undo.",
            input: "none",
            risk: "undoable",
          },
        ],
      },
    ),
  ];
  const host = await mount();
  await press("1");
  expect(text(host)).toContain("Drop the task: in a few seconds.");
  expect(posts).toEqual([]);
  await click(button(host, "Undo"));
  expect(host.querySelectorAll("[data-catch-up-option]")).toHaveLength(1);
  await settle(200);
  expect(posts).toEqual([]);
});

test("what the manager chose before is on the next card about the same task", async () => {
  queue = [
    card(
      1,
      "work_stuck",
      "Dev Bot stopped on “Launch email”",
      {},
      {
        history: [
          {
            action: "tell",
            label: "Tell it what to do",
            text: "Use the short version.",
            at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          },
        ],
      },
    ),
  ];
  const host = await mount();
  expect(text(host)).toContain("What you chose before");
  expect(text(host)).toContain("Tell it what to do: “Use the short version.”");
});

test("the person asked answers with one tap, and sees no notes meant for a manager", async () => {
  queue = [
    card(
      1,
      "work_checkin",
      "Still working on “Launch email”?",
      { botId: null, detail: "Nothing changed on it for a few days. One tap is enough." },
      {
        worker: ana,
        options: defaultWorkOptions("work_checkin", { worker: ana, managerName: "Allan" }),
        project: null,
      },
    ),
  ];
  const host = await mount();
  const steps = [...host.querySelectorAll("[data-catch-up-option]")].map((b) => b.textContent);
  expect(steps).toHaveLength(3);
  expect(steps[0]).toStartWith("Yes, on it");
  expect(steps[0]).toContain("Allan sees that you are on it.");
  expect(steps[1]).toStartWith("I'm blocked");
  expect(steps[2]).toStartWith("It's done");
  expect(text(host)).not.toContain("Their last note");
  expect(text(host)).toContain("Ana Lima");
  expect(text(host)).not.toMatch(INTERNAL_WORDS);
  await press("1");
  expect(posts).toEqual([{ call: `POST /api/catch-up/${ID(1)}/act`, body: { option: "on_it" } }]);
});

test("a refusal from the server is shown on the card, which stays", async () => {
  queue = [card(1, "work_stuck", "Dev Bot stopped on “Launch email”")];
  failWith = "Your agents are paused. Resume them first.";
  const host = await mount();
  await press("2");
  expect(text(host)).toContain("Your agents are paused. Resume them first.");
  expect(host.querySelectorAll("[data-catch-up-option]")).toHaveLength(4);
});

test("the D key leaves a work card for later, with an undo", async () => {
  queue = [card(1, "work_stuck", "Dev Bot stopped on “Launch email”")];
  const host = await mount();
  await press("d");
  expect(text(host)).toContain("Leaving it for now.");
  expect(posts).toEqual([]);
  await click(button(host, "Undo"));
  expect(text(host)).not.toContain("Leaving it for now.");
});
