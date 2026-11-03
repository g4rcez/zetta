import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

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
      <MessageRow
        row={row}
        author={{ name: "Ana" }}
        quoteAuthor={{ name: "Helper" }}
        continued={false}
        onReact={() => {}}
        onReply={() => {}}
        onSaveToWiki={() => {}}
        {...props}
      />,
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

/** Tabbing to the row's one tab stop swaps in the real toolbar. */
const openToolbar = (host: HTMLElement) =>
  act(() => {
    (host.querySelector('button[aria-label="Message actions"]') as unknown as HTMLElement).focus();
  });

test("the toolbar offers Reply only where the page can quote", () => {
  const withQuote = mount({ onQuote: () => {} });
  openToolbar(withQuote);
  expect(withQuote.querySelector('button[aria-label="Reply"]')).not.toBeNull();
  const plain = mount({});
  openToolbar(plain);
  expect(plain.querySelector('button[aria-label="Reply in thread"]')).not.toBeNull();
  expect(plain.querySelector('button[aria-label="Reply"]')).toBeNull();
});

test("Reply hands the message to the page", () => {
  const picked: string[] = [];
  const host = mount({ onQuote: (r: { id: string }) => picked.push(r.id) });
  openToolbar(host);
  act(() => (host.querySelector('button[aria-label="Reply"]') as unknown as HTMLElement).click());
  expect(picked).toEqual(["m2"]);
});

test("a row inside a thread or room still offers Reply when the page gives it", () => {
  const host = mount({ inThread: true, onQuote: () => {} });
  openToolbar(host);
  expect(host.querySelector('button[aria-label="Reply"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Reply in thread"]')).toBeNull();
});
