import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
afterEach(() => {
  win.document.body.innerHTML = "";
});

const BOT = "00000000-0000-7000-8000-0000000000a1";
const MSG = "00000000-0000-7000-8000-0000000000c1";
const CONV = "00000000-0000-7000-8000-0000000000d1";
const P1 = "00000000-0000-7000-8000-0000000000e1";
const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();

const sent: { path: string; method: string; body: any }[] = [];
let ratings: Record<string, { rating: string; reason: string }> = {};
let driveRuns: any[] = [];
let drivePair: any = null;
const PAIR = "00000000-0000-7000-8000-0000000000f1";
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (method !== "GET") sent.push({ path, method, body });
  if (path === `/api/conversations/${CONV}/feedback`) return Response.json({ feedback: ratings });
  if (path === `/api/messages/${MSG}/feedback`)
    return Response.json(
      method === "PUT" ? { feedback: { messageId: MSG, ...body } } : { cleared: true },
    );
  if (path === `/api/bots/${BOT}/revisions`)
    return Response.json({
      bot: { id: BOT, name: "Q", version: 3 },
      revisions: [
        {
          version: 3,
          createdAt: iso(0),
          current: true,
          changed: ["instructions"],
          config: { instructions: "Be warm.\nBe brief.", personality: "Calm" },
        },
        {
          version: 2,
          createdAt: iso(2),
          current: false,
          changed: ["autoLearn"],
          config: { instructions: "Be brief.", personality: "Calm" },
        },
      ],
    });
  if (path === `/api/bots/${BOT}/revisions/2/restore`) return Response.json({ version: 4 });
  if (path === `/api/bots`) return Response.json({ bots: [{ id: BOT, name: "Q", version: 4 }] });
  if (path === `/api/bots/${BOT}/drive`)
    return Response.json({
      bot: { id: BOT, name: "Q", version: 3 },
      limit: 10,
      prompts: [
        { id: P1, title: "Greeting", prompt: "Say hello", runs: driveRuns, pair: drivePair },
      ],
    });
  if (path === `/api/bots/${BOT}/drive/compare`)
    return Response.json({ started: 2, pairId: PAIR, botVersion: 3 }, { status: 202 });
  if (path === `/api/bots/${BOT}/drive/pairs/${PAIR}/choose`)
    return Response.json({ pairId: PAIR, chosen: body.choice });
  if (path === `/api/bots/${BOT}/drive/run`)
    return Response.json({ started: 1, botVersion: 3 }, { status: 202 });
  if (path === `/api/bots/${BOT}/drive/prompts`)
    return Response.json({ prompt: { id: P1 } }, { status: 201 });
  if (path.startsWith(`/api/bots/${BOT}/stats`)) {
    const days = path.endsWith("30") ? 30 : 7;
    return Response.json({
      stats: {
        bot: { id: BOT, name: "Q", version: 3 },
        days,
        runs: { total: days === 7 ? 12 : 40, ok: 10, cancelled: 1, failed: 1 },
        duration: { medianMs: 2500, p90Ms: 61_000, samples: 11 },
        stepIn: { cancelledReplies: 1, steered: 2, approvalCards: 3, askedYou: 4 },
        feedback: { up: 5, down: 2 },
      },
    });
  }
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${method} ${path}` } },
    { status: 500 },
  );
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));
const text = () => win.document.body.textContent ?? "";
const button = (label: string) =>
  [...win.document.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === label || x.getAttribute("aria-label") === label,
  );
const press = async (label: string) => {
  const b = button(label);
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
async function mount(node: React.ReactNode) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {node}
      </QueryClientProvider>,
    ),
  );
  await settle();
  return { unmount: () => act(async () => root.unmount()) };
}

const bot = { id: BOT, name: "Q", version: 3, harness: "claude-code" } as never;

test("the thumbs rate a finished answer, show the choice and take it back", async () => {
  sent.length = 0;
  ratings = {};
  const { FeedbackProvider, RateButtons } = await import("./feedback");
  const row = {
    id: MSG,
    role: "assistant",
    botId: BOT,
    status: "complete",
    content: "Done",
  } as never;
  const { unmount } = await mount(
    <FeedbackProvider conversationId={CONV}>
      <RateButtons row={row} />
    </FeedbackProvider>,
  );
  expect(button("Good answer")?.getAttribute("aria-pressed")).toBe("false");
  await press("Good answer");
  expect(sent.at(-1)).toEqual({
    path: `/api/messages/${MSG}/feedback`,
    method: "PUT",
    body: { rating: "up", reason: "" },
  });
  expect(button("Good answer")?.getAttribute("aria-pressed")).toBe("true");
  await press("Good answer");
  expect(sent.at(-1)?.method).toBe("DELETE");
  expect(button("Good answer")?.getAttribute("aria-pressed")).toBe("false");
  await unmount();
});

test("a question, a reply still being written, or a log without a provider carries no thumbs", async () => {
  const { FeedbackProvider, RateButtons } = await import("./feedback");
  const row = (over: object) =>
    ({
      id: MSG,
      role: "assistant",
      botId: BOT,
      status: "complete",
      content: "x",
      ...over,
    }) as never;
  const { unmount } = await mount(
    <>
      <FeedbackProvider conversationId={CONV}>
        <RateButtons row={row({ role: "user" })} />
        <RateButtons row={row({ streaming: true })} />
        <RateButtons row={row({ status: "failed" })} />
      </FeedbackProvider>
      <RateButtons row={row({})} />
    </>,
  );
  expect(button("Good answer")).toBeUndefined();
  await unmount();
});

test("the history names what each version changed, shows the text difference, and brings a version back after a confirmation", async () => {
  sent.length = 0;
  const { HistorySection } = await import("./sections");
  let changed: unknown;
  const { unmount } = await mount(
    <HistorySection bot={bot} onBotChange={(b) => (changed = b)} notify={() => {}} />,
  );
  expect(text()).toContain("Version 3");
  expect(text()).toContain("Now");
  expect(text()).toContain("changed instructions");
  expect(text()).toContain("changed learning");
  await press("See changes");
  const diff = win.document.querySelector("pre")!;
  expect(diff.textContent).toContain("Be warm.");
  await press("Bring it back");
  // Nothing is sent before the person confirms.
  expect(sent).toEqual([]);
  await press("Yes, bring it back");
  expect(sent.at(-1)).toEqual({
    path: `/api/bots/${BOT}/revisions/2/restore`,
    method: "POST",
    body: { expectedVersion: 3 },
  });
  expect(changed).toMatchObject({ id: BOT, version: 4 });
  await unmount();
});

test("saved tests show the answers of the last two versions side by side and run on request", async () => {
  sent.length = 0;
  driveRuns = [
    {
      id: "r2",
      promptId: P1,
      botVersion: 3,
      status: "done",
      error: "",
      createdAt: iso(0),
      finishedAt: iso(0),
      answer: "Hello, friend!",
      conversationId: null,
    },
    {
      id: "r1",
      promptId: P1,
      botVersion: 2,
      status: "done",
      error: "",
      createdAt: iso(1),
      finishedAt: iso(1),
      answer: "Hello there!",
      conversationId: null,
    },
  ];
  const { SavedTestsSection } = await import("./sections");
  const { unmount } = await mount(
    <SavedTestsSection bot={bot} onBotChange={() => {}} notify={() => {}} />,
  );
  expect(text()).toContain("Greeting");
  expect(text()).toContain("Version 3 (now)");
  expect(text()).toContain("Hello, friend!");
  expect(text()).toContain("Version 2");
  expect(text()).toContain("Hello there!");
  await press("Run");
  expect(sent.at(-1)).toEqual({
    path: `/api/bots/${BOT}/drive/run`,
    method: "POST",
    body: { promptId: P1 },
  });
  await unmount();
});

const side = (answer: string, status = "done") => ({
  id: `s-${answer}`,
  status,
  error: "",
  answer: status === "done" ? answer : null,
  conversationId: null,
});

test("compare asks the same question with and without memory; the two answers sit side by side and the pick is one call", async () => {
  sent.length = 0;
  driveRuns = [];
  drivePair = null;
  const { SavedTestsSection } = await import("./sections");
  const first = await mount(
    <SavedTestsSection bot={bot} onBotChange={() => {}} notify={() => {}} />,
  );
  expect(text()).not.toContain("Which is better?");
  await press("Compare without memory");
  expect(sent.at(-1)).toEqual({
    path: `/api/bots/${BOT}/drive/compare`,
    method: "POST",
    body: { promptId: P1 },
  });
  await first.unmount();

  // While the pair runs, the sides say so and the pick is not offered yet.
  drivePair = {
    pairId: PAIR,
    createdAt: iso(0),
    chosen: null,
    with: side("Refunds take 5 days, per your policy."),
    without: side("", "running"),
  };
  const running = await mount(
    <SavedTestsSection bot={bot} onBotChange={() => {}} notify={() => {}} />,
  );
  expect(text()).toContain("With what it knows");
  expect(text()).toContain("Without memory and skills");
  expect(text()).toContain("Refunds take 5 days, per your policy.");
  expect(text()).toContain("Running…");
  expect(text()).not.toContain("Which is better?");
  expect((button("Running…") as HTMLButtonElement | undefined)?.disabled).toBe(true);
  await running.unmount();

  // Both done: the pick is offered, and each choice is one call.
  drivePair = { ...drivePair, without: side("Refunds are processed.") };
  const done = await mount(
    <SavedTestsSection bot={bot} onBotChange={() => {}} notify={() => {}} />,
  );
  expect(text()).toContain("Refunds are processed.");
  expect(text()).toContain("Which is better?");
  sent.length = 0;
  await press("About the same");
  expect(sent.at(-1)).toEqual({
    path: `/api/bots/${BOT}/drive/pairs/${PAIR}/choose`,
    method: "POST",
    body: { choice: "same" },
  });
  await press("With what it knows");
  expect(sent.at(-1)!.body).toEqual({ choice: "with" });
  await done.unmount();

  // Once chosen, it says what was picked and offers nothing more.
  drivePair = { ...drivePair, chosen: "without" };
  const picked = await mount(
    <SavedTestsSection bot={bot} onBotChange={() => {}} notify={() => {}} />,
  );
  expect(text()).toContain("You picked the answer without what it knows.");
  expect(text()).not.toContain("Which is better?");
  await picked.unmount();
  drivePair = null;
});

test("a running saved test says so and cannot be started twice", async () => {
  driveRuns = [
    {
      id: "r3",
      promptId: P1,
      botVersion: 3,
      status: "running",
      error: "",
      createdAt: iso(0),
      finishedAt: null,
      answer: null,
      conversationId: null,
    },
  ];
  const { SavedTestsSection } = await import("./sections");
  const { unmount } = await mount(
    <SavedTestsSection bot={bot} onBotChange={() => {}} notify={() => {}} />,
  );
  expect(text()).toContain("Running…");
  expect((button("Running…") as HTMLButtonElement | undefined)?.disabled).toBe(true);
  await unmount();
});

test("the numbers show 7 and 30 days, how long answers take and how often the person stepped in", async () => {
  const { PerformanceSection } = await import("./sections");
  const { unmount } = await mount(
    <PerformanceSection bot={bot} onBotChange={() => {}} notify={() => {}} />,
  );
  expect(text()).toContain("Last 7 days");
  expect(text()).toContain("Last 30 days");
  expect(text()).toContain("2.5 s");
  expect(text()).toContain("1.0 min");
  expect(text()).toContain("Changes it asked you to approve");
  await unmount();
});
