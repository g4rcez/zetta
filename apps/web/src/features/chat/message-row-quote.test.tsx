import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const withQuery = (element: unknown) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {element as never}
  </QueryClientProvider>
);

const win = setupDom();
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
const { MessageRow } = await import("./message-row");

const row = {
  id: "m2",
  role: "user",
  content: "why noon?",
  status: "done",
  createdAt: "2026-11-03T12:00:00.000Z",
  meta: {
    quote: { id: "m1", role: "assistant", botId: "b1", excerpt: "the deploy runs at noon" },
  },
} as never;

const roots: ReturnType<typeof createRoot>[] = [];
// An open toolbar has tooltip animations that would finish after the fake window is gone.
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  await new Promise((done) => setTimeout(done, 20));
});

function mount(props: Record<string, unknown>) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  act(() =>
    root.render(
      withQuery(
        <MessageRow
          row={row}
          author={{ name: "Ana" }}
          quoteAuthor={{ name: "Helper" }}
          continued={false}
          onReact={() => {}}
          onReply={() => {}}
          onSaveToMemory={() => {}}
          {...props}
        />,
      ),
    ),
  );
  return host as unknown as HTMLElement;
}

test("a channel reply shows who and what it quotes, and a click goes to the original", () => {
  const original = win.document.createElement("div");
  original.id = "message-m1";
  let scrolled = 0;
  (original as never as { scrollIntoView: () => void }).scrollIntoView = () => scrolled++;
  win.document.body.append(original);
  const host = mount({});
  expect(host.textContent).toContain("Helper");
  expect(host.textContent).toContain("the deploy runs at noon");
  const quote = host.querySelector('button[aria-label="Go to the message from Helper"]')!;
  act(() => (quote as unknown as HTMLElement).click());
  expect(scrolled).toBe(1);
});

test("the reference comes before the author line, on one line", () => {
  const host = mount({});
  const html = host.innerHTML;
  const at = (needle: string) => html.indexOf(needle);
  expect(at("the deploy runs at noon")).toBeGreaterThan(-1);
  expect(at("the deploy runs at noon")).toBeLessThan(at(">Ana</span>"));
  const excerpt = [...host.querySelectorAll("span")].find((e) =>
    e.textContent?.includes("the deploy runs at noon"),
  )!;
  expect(excerpt.className).toContain("truncate");
});

test("a quote with line breaks is shown on one line", () => {
  const host = mount({
    row: {
      ...(row as object),
      meta: {
        quote: { id: "m1", role: "assistant", botId: "b1", excerpt: "line one\n\nline two" },
      },
    },
  });
  expect(host.textContent).toContain("line one line two");
});

test("a person's message shows who has read it, and a bot's reply never does", () => {
  const read = mount({ row: { ...(row as object), seenBy: ["b1"] } });
  expect(read.querySelector('[aria-label="Read by A bot"]')).not.toBeNull();
  const unread = mount({ row: { ...(row as object), seenBy: [] } });
  expect(unread.querySelector('[aria-label^="Read by"]')).toBeNull();
  const reply = mount({ row: { ...(row as object), role: "assistant", seenBy: ["b1"] } });
  expect(reply.querySelector('[aria-label^="Read by"]')).toBeNull();
});

test("the read mark takes no line of its own: beside the name, or after the text of a follow-up", () => {
  const mark = '[aria-label="Read by A bot"]';
  const named = mount({ row: { ...(row as object), seenBy: ["b1"] } });
  expect(named.querySelector(`[data-slot="message-header"] ${mark}`)).not.toBeNull();
  expect(named.querySelectorAll(mark)).toHaveLength(1);
  const followUp = mount({ row: { ...(row as object), seenBy: ["b1"] }, continued: true });
  const beside = followUp.querySelector(".chat-response")!.parentElement!;
  expect(beside.className).toContain("flex");
  expect(beside.querySelector(mark)).not.toBeNull();
  expect(followUp.querySelectorAll(mark)).toHaveLength(1);
});

test("the toolbar offers Pin where the page can pin, and Unpin on a pinned message", () => {
  const picked: [string, boolean][] = [];
  const plain = mount({});
  openToolbar(plain);
  expect(plain.querySelector('button[aria-label="Pin"]')).toBeNull();
  const host = mount({ onPin: (r: { id: string }, pin: boolean) => picked.push([r.id, pin]) });
  openMenu(host);
  chooseRow("Pin");
  const pinned = mount({
    pinned: true,
    onPin: (r: { id: string }, pin: boolean) => picked.push([r.id, pin]),
  });
  openMenu(pinned);
  expect(menuRows()).not.toContain("Pin");
  chooseRow("Unpin");
  expect(picked).toEqual([
    ["m2", true],
    ["m2", false],
  ]);
  // A pinned message says so beside its time.
  expect(pinned.querySelector('[aria-label="Pinned"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Pinned"]')).toBeNull();
});

const pollRow = (over: object = {}) => ({
  id: "p1",
  role: "user",
  content: "📊 Lunch?",
  status: "done",
  createdAt: "2026-11-03T12:00:00.000Z",
  meta: {
    poll: {
      question: "Lunch?",
      mode: "single",
      status: "open",
      options: [
        { id: "a", label: "Pizza" },
        { id: "b", label: "Sushi" },
      ],
    },
  },
  pollVotes: { a: { count: 2, mine: false, botIds: [] } },
  ...over,
});

test("a poll-only message shows the card and does not repeat its question as text", () => {
  const host = mount({ row: pollRow() });
  const card = host.querySelector('section[aria-label="Poll"]')!;
  expect(card.textContent).toContain("Lunch?");
  expect(card.textContent).toContain("Pizza");
  expect(host.textContent).not.toContain("📊");
});

test("a message that has text and a poll shows both", () => {
  const host = mount({
    row: pollRow({ role: "assistant", content: "Let me ask the room." }),
  });
  expect(host.textContent).toContain("Let me ask the room.");
  expect(host.querySelector('section[aria-label="Poll"]')).not.toBeNull();
});

test("a click on an option hands the row and the choice to the page; without a handler the poll only shows results", () => {
  const votes: [string, string[]][] = [];
  const host = mount({
    row: pollRow(),
    onVote: (r: { id: string }, options: string[]) => votes.push([r.id, options]),
  });
  const sushi = [...host.querySelectorAll("li button")].find((b) =>
    b.textContent?.includes("Sushi"),
  )!;
  act(() => (sushi as unknown as HTMLElement).click());
  expect(votes).toEqual([["p1", ["b"]]]);
  const readOnly = mount({ row: pollRow() });
  expect(readOnly.querySelector("li button")!.hasAttribute("disabled")).toBe(true);
});

/** Tabbing to the row's one tab stop swaps in the real toolbar. */
const openToolbar = (host: HTMLElement) =>
  act(() => {
    (host.querySelector('button[aria-label="Message actions"]') as unknown as HTMLElement).focus();
  });

/** The "⋯" of the toolbar, and the rows of the menu it opens. */
const openMenu = (host: HTMLElement) => {
  // The one tab stop is gone once the toolbar is up.
  if (host.querySelector('button[aria-label="Message actions"]')) openToolbar(host);
  act(() =>
    (host.querySelector('button[aria-label="More actions"]') as unknown as HTMLElement).click(),
  );
};
// The latest menu: one opened by an earlier mount may still be in the document.
const menuItems = () => [
  ...([...win.document.querySelectorAll('[role="menu"]')]
    .at(-1)
    ?.querySelectorAll('[role="menuitem"]') ?? []),
];
const menuRows = () => menuItems().map((b) => b.textContent);
const chooseRow = (name: string) =>
  act(() => (menuItems().find((b) => b.textContent === name) as unknown as HTMLElement).click());

test("the toolbar has four buttons; everything else is in the menu", () => {
  const host = mount({ onQuote: () => {}, onPin: () => {} });
  openToolbar(host);
  const names = [...host.querySelectorAll('[role="toolbar"] button')].map((b) =>
    b.getAttribute("aria-label"),
  );
  expect(names).toEqual(["Add reaction", "Open thread", "Quote", "More actions"]);
  openMenu(host);
  expect(menuRows()).toEqual(["Pin", "Copy"]);
});

test("a message with reactions ends with a chip that adds another", () => {
  const chips = '[role="group"][aria-label="Reactions"] button[aria-label="Add reaction"]';
  const reactions = [{ emoji: "🎉", count: 2, mine: false }];
  const host = mount({ row: { ...(row as object), reactions } });
  expect(host.querySelector(chips)).not.toBeNull();
  expect(mount({}).querySelector(chips)).toBeNull();
  const readOnly = mount({ row: { ...(row as object), reactions }, readOnly: true });
  expect(readOnly.querySelector(chips)).toBeNull();
});

test("the toolbar offers Quote only where the page can quote", () => {
  const withQuote = mount({ onQuote: () => {} });
  openToolbar(withQuote);
  expect(withQuote.querySelector('button[aria-label="Quote"]')).not.toBeNull();
  const plain = mount({});
  openToolbar(plain);
  expect(plain.querySelector('button[aria-label="Open thread"]')).not.toBeNull();
  expect(plain.querySelector('button[aria-label="Quote"]')).toBeNull();
  // The old words are gone.
  expect(plain.querySelector('[aria-label="Reply"], [aria-label="Reply in thread"]')).toBeNull();
});

test("Quote hands the message to the page", () => {
  const picked: string[] = [];
  const host = mount({ onQuote: (r: { id: string }) => picked.push(r.id) });
  openToolbar(host);
  act(() => (host.querySelector('button[aria-label="Quote"]') as unknown as HTMLElement).click());
  expect(picked).toEqual(["m2"]);
});

test("a row inside a thread or room still offers Quote when the page gives it", () => {
  const host = mount({ inThread: true, onQuote: () => {} });
  openToolbar(host);
  expect(host.querySelector('button[aria-label="Quote"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Open thread"]')).toBeNull();
});
