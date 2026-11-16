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
const DAYS = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
const zeros = () => DAYS.map(() => 0);

let activity: unknown;
let status = 200;
const asked: string[] = [];
globalThis.fetch = (async (input: URL | string) => {
  const url = new URL(String(input));
  asked.push(`${url.pathname}${url.search}`);
  if (url.pathname === `/api/bots/${BOT}/activity`)
    return status === 200
      ? Response.json({ activity })
      : Response.json({ error: { code: "NOT_FOUND", message: "Bot not found." } }, { status });
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${url.pathname}` } },
    { status: 500 },
  );
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));
const text = () => win.document.body.textContent ?? "";
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
const base = () => ({
  bot: { id: BOT, name: "Q" },
  timezone: "America/Sao_Paulo",
  days: DAYS,
  routines: { active: 3, paused: 1, runs: 12, failed: 2 },
  calls: { last30: 87, allTime: 400, toolCalls: 215 },
  tokens: {
    input: 40_000,
    cacheRead: 1_000_000,
    cacheWrite: 360_000,
    output: 100_000,
    total: 1_500_000,
    reportedCalls: 75,
  },
  messages: { sent: 64, received: 41 },
  tasks: { open: 5, blocked: 2, done: 9, total: 14 },
  series: { calls: zeros(), messages: zeros(), routineRuns: zeros() },
});

test("the tiles show the numbers and the chart draws the three series", async () => {
  asked.length = 0;
  status = 200;
  const a = base();
  a.series.calls = DAYS.map((_, i) => i % 4);
  a.series.messages = DAYS.map((_, i) => (i % 3) + 1);
  a.series.routineRuns = DAYS.map((_, i) => (i === 9 ? 2 : 0));
  activity = a;
  const { StatsSection } = await import("./stats-section");
  const { unmount } = await mount(
    <StatsSection bot={bot} onBotChange={() => {}} notify={() => {}} />,
  );
  const t = text();
  for (const s of ["Routines", "Calls", "Tokens", "Messages", "Open tasks"]) expect(t).toContain(s);
  for (const s of ["87", "64", "3", "5"]) expect(t).toContain(s);
  expect(t).toContain("1 paused");
  expect(t).toContain("215 tool calls");
  expect(t).toContain("41 received");
  expect(t).toContain("9 done");
  expect(t).toContain("Last 30 days, per day");
  // Tokens: the figure, the four parts with counts, the per-call average and how many calls reported.
  expect(t).toContain("1.5M");
  expect(t).toContain("100K output");
  const panel = win.document.querySelector("[aria-label='Token usage']")!;
  expect(panel.textContent).toContain("New input40K");
  expect(panel.textContent).toContain("Cache read1M");
  expect(panel.textContent).toContain("Cache write360K");
  expect(panel.textContent).toContain("Output100K");
  expect(panel.textContent).toContain("20K per call · 75 of 87 calls reported");
  expect(panel.querySelector("[role=img]")?.getAttribute("aria-label")).toContain(
    "1,500,000 tokens",
  );
  expect(win.document.querySelectorAll("figure svg").length).toBe(1);
  for (const s of ["Calls", "Messages sent", "Routine runs"]) expect(t).toContain(s);
  // The browser's time zone goes to the server so days are counted where the person is.
  expect(asked[0]).toMatch(new RegExp(`^/api/bots/${BOT}/activity\\?tz=`));
  await unmount();
});

test("a bot that did nothing shows zeros and a sentence instead of an empty chart", async () => {
  status = 200;
  const a = base();
  a.routines = { active: 0, paused: 0, runs: 0, failed: 0 };
  a.calls = { last30: 0, allTime: 0, toolCalls: 0 };
  a.tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0, reportedCalls: 0 };
  a.messages = { sent: 0, received: 0 };
  a.tasks = { open: 0, blocked: 0, done: 0, total: 0 };
  activity = a;
  const { StatsSection } = await import("./stats-section");
  const { unmount } = await mount(
    <StatsSection bot={bot} onBotChange={() => {}} notify={() => {}} />,
  );
  expect(text()).toContain("No calls, messages or routine runs in the last 30 days.");
  expect(win.document.querySelector("figure")).toBeNull();
  expect(text()).toContain("Open tasks");
  // No calls: no token panel at all, and the figure is a dash, not a made-up zero.
  expect(win.document.querySelector("[aria-label='Token usage']")).toBeNull();
  await unmount();
});

test("calls from an engine that does not report tokens say so, rather than showing zero", async () => {
  status = 200;
  const a = base();
  a.tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0, reportedCalls: 0 };
  activity = a;
  const { StatsSection } = await import("./stats-section");
  const { unmount } = await mount(
    <StatsSection bot={bot} onBotChange={() => {}} notify={() => {}} />,
  );
  expect(text()).toContain(
    "Tokens are not reported for this bot's calls. Only Claude Code reports them.",
  );
  expect(text()).toContain("not reported");
  expect(win.document.querySelector("[aria-label='Token usage'] [role=img]")).toBeNull();
  await unmount();
});

test("the activity chart fills its container, while the chat's chart keeps its size cap", async () => {
  status = 200;
  const a = base();
  a.series.calls = DAYS.map((_, i) => i % 4);
  activity = a;
  const { StatsSection } = await import("./stats-section");
  const { ChartView } = await import("../chat/chart");
  const stats = await mount(<StatsSection bot={bot} onBotChange={() => {}} notify={() => {}} />);
  const fig = win.document.querySelector("figure")!;
  expect(fig.className).toContain("w-full");
  expect(fig.className).not.toContain("max-w-2xl");
  await stats.unmount();
  const chart = {
    type: "line" as const,
    categories: ["a", "b"],
    series: [{ name: "s", values: [1, 2] }],
  };
  const chat = await mount(<ChartView title="t" chart={chart} />);
  expect(win.document.querySelector("figure")!.className).toContain("max-w-2xl");
  await chat.unmount();
});

test("a failed load says so", async () => {
  status = 404;
  const { StatsSection } = await import("./stats-section");
  const { unmount } = await mount(
    <StatsSection bot={bot} onBotChange={() => {}} notify={() => {}} />,
  );
  expect(win.document.querySelector("[role=alert]")?.textContent).toContain("Bot not found.");
  await unmount();
});

test("Stats is the first section of the bot's page, above Setup's own sections", async () => {
  const { BOT_TABS, parseBotTab } = await import("../chat/bot-settings");
  // The default tab opens on Stats, and Setup's sections follow on scroll.
  expect(BOT_TABS[0].id).toBe("setup");
  expect(BOT_TABS[0].ids[0]).toBe("stats");
  expect(BOT_TABS[0].ids).toContain("general");
  // Stats is not a tab of its own, and no other tab lists it.
  expect(BOT_TABS.map((t) => t.id)).not.toContain("stats");
  expect(BOT_TABS.slice(1).some((t) => (t.ids as readonly string[]).includes("stats"))).toBe(false);
  expect(parseBotTab("stats")).toBeUndefined();
});
