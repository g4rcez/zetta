import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
const { QuoteSelection, flatten, quoteChip, quoteFields, quoteRow, selectionInContent } =
  await import("./quote-selection");

const row = {
  id: "m1",
  seq: 1,
  role: "assistant",
  botId: "b1",
  content:
    "The deploy runs **at noon** on [Friday](https://example.invalid/cal).\n\n- first step\n- second step",
  status: "complete",
  createdAt: "2026-11-03T12:00:00.000Z",
} as never;

test("a selection of the rendered text is found in the Markdown of the message", () => {
  const content = (row as { content: string }).content;
  expect(selectionInContent(content, "runs at noon on Friday")).toBe(true);
  expect(selectionInContent(content, "at noon  on\nFriday.")).toBe(true);
  expect(selectionInContent(content, "first step second step")).toBe(true);
  expect(selectionInContent(content, "at midnight")).toBe(false);
  expect(selectionInContent(content, "   ")).toBe(false);
  expect(flatten("a   b\n\nc")).toBe("a b c");
});

test("the quote carries the selection, cut at 500 characters", () => {
  expect(quoteFields(undefined)).toEqual({});
  expect(quoteFields(quoteRow(row))).toEqual({ quotedMessageId: "m1" });
  const part = quoteRow(row, "  at noon ");
  expect(quoteFields(part)).toEqual({ quotedMessageId: "m1", quoteExcerpt: "at noon" });
  expect(quoteRow(row, "x".repeat(900)).quoteSelection).toHaveLength(500);
  const chip = quoteChip(part, "Helper", () => {});
  expect(chip).toMatchObject({ name: "Helper", excerpt: "at noon", selection: true });
  expect(quoteChip(quoteRow(row), "Helper", () => {})).toMatchObject({ selection: false });
});

const roots: ReturnType<typeof createRoot>[] = [];
const getSelection = win.getSelection;
afterEach(async () => {
  win.getSelection = getSelection;
  win.document.body.innerHTML = "";
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
});

/** A page with the rendered message, and a selection of `text` inside the node `inside` picks. */
function select(text: string, inside: (message: { firstChild: any }) => unknown) {
  const message = win.document.createElement("div");
  message.id = "message-m1";
  message.innerHTML = "<p>The deploy runs at noon on Friday.</p><p>first step second step</p>";
  const quote = win.document.createElement("div");
  quote.id = "outside";
  quote.textContent = "not a message";
  win.document.body.append(message as never, quote as never);
  const node = inside(message as never);
  win.getSelection = (() => ({
    isCollapsed: text === "",
    rangeCount: 1,
    toString: () => text,
    removeAllRanges() {},
    getRangeAt: () => ({
      commonAncestorContainer: node,
      getBoundingClientRect: () => ({ left: 100, width: 40, top: 200 }),
    }),
  })) as never;
  act(() => {
    win.document.dispatchEvent(new win.Event("selectionchange") as never);
  });
}

function mount(onQuote: (row: unknown) => void) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  act(() => root.render(<QuoteSelection rows={[row]} onQuote={onQuote as never} />));
}
const button = () =>
  [...win.document.querySelectorAll("button")].find((b) => b.textContent === "Quote selection");

test("selecting text inside a message shows Quote selection, and the click quotes the selection", () => {
  const quoted: { id: string; quoteSelection?: string }[] = [];
  mount((r) => quoted.push(r as never));
  expect(button()).toBeUndefined();
  select("at noon on Friday", (m) => m.firstChild!.firstChild!);
  expect(button()).toBeDefined();
  act(() => (button() as unknown as HTMLElement).click());
  expect(quoted).toHaveLength(1);
  expect(quoted[0]).toMatchObject({ id: "m1", quoteSelection: "at noon on Friday" });
  // The button goes once it is used.
  expect(button()).toBeUndefined();
});

test("a selection that is not part of one message gets no button", () => {
  mount(() => {});
  // Text that is not in the message (the author line, a quote line above it).
  select("Ana", (m) => m.firstChild!.firstChild!);
  expect(button()).toBeUndefined();
  // Outside every message.
  select("not a message", () => win.document.getElementById("outside")!.firstChild);
  expect(button()).toBeUndefined();
  // An empty selection (a click).
  select("", (m) => m.firstChild!.firstChild!);
  expect(button()).toBeUndefined();
});
