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
const { canEditRow, lastEditable } = await import("./message-edit");

const row = {
  id: "m1",
  seq: 3,
  role: "user",
  content: "see you at noon",
  status: "complete",
  createdAt: "2026-11-03T12:00:00.000Z",
} as never;

const roots: ReturnType<typeof createRoot>[] = [];
const matchMedia = win.matchMedia;
afterEach(async () => {
  win.matchMedia = matchMedia;
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  await new Promise((done) => setTimeout(done, 20));
});

/** A screen that cannot hover: a phone or a tablet. */
const touchScreen = () => {
  win.matchMedia = ((query: string) => ({
    matches: query.includes("hover: none"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
};

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
const click = (el: unknown) => act(() => (el as HTMLElement).click());
const openToolbar = (host: HTMLElement) =>
  act(() => {
    (host.querySelector('button[aria-label="Message actions"]') as unknown as HTMLElement).focus();
  });

test("only what the person wrote in Zetta can be edited", () => {
  const base = { ...(row as object), id: "x" } as never;
  expect(canEditRow(base)).toBe(true);
  expect(canEditRow({ ...(base as object), role: "assistant" } as never)).toBe(false);
  expect(canEditRow({ ...(base as object), role: "system" } as never)).toBe(false);
  // A line a person wrote through a channel plugin is theirs outside, not the signed-in user's.
  expect(
    canEditRow({ ...(base as object), meta: { inbound: { plugin: "whatsapp" } } } as never),
  ).toBe(false);
  expect(canEditRow({ ...(base as object), meta: { poll: {} } } as never)).toBe(false);
  // The live echo of a message the server has not saved yet.
  expect(canEditRow({ ...(base as object), seq: Number.MAX_SAFE_INTEGER } as never)).toBe(false);
  expect(canEditRow({ ...(base as object), streaming: true } as never)).toBe(false);
});

test("the Up arrow picks the last message of the person, not a bot's reply", () => {
  const rows = [
    { ...(row as object), id: "a", seq: 1 },
    { ...(row as object), id: "b", seq: 2, role: "assistant" },
    { ...(row as object), id: "c", seq: 3, role: "user", meta: { poll: {} } },
  ] as never[];
  expect(lastEditable(rows)?.id).toBe("a");
  expect(lastEditable([])).toBeUndefined();
});

/** Opens the "⋯" of the toolbar and answers the rows of its menu. */
const openMenu = (host: HTMLElement) => {
  openToolbar(host);
  click(host.querySelector('button[aria-label="More actions"]'));
  return [...win.document.querySelectorAll('[role="menuitem"]')];
};
const editRow = (rows: { textContent: string | null }[]) =>
  rows.find((r) => r.textContent === "Edit");

test("the menu offers Edit on the person's own message, only where the page can edit", () => {
  expect(editRow(openMenu(mount({})))).toBeUndefined();
  win.document.body.replaceChildren();
  const picked: string[] = [];
  const host = mount({ onEdit: (r: { id: string }) => picked.push(r.id) });
  click(editRow(openMenu(host)));
  expect(picked).toEqual(["m1"]);
  win.document.body.replaceChildren();
  const reply = mount({ row: { ...(row as object), role: "assistant" }, onEdit: () => {} });
  const rows = openMenu(reply);
  expect(editRow(rows)).toBeUndefined();
  expect(rows.map((r) => r.textContent)).toContain("Save to memory");
});

test("the message being edited shows the editor with Save and Cancel instead of its text", () => {
  const cancelled: number[] = [];
  const host = mount({
    onEdit: () => {},
    editing: true,
    bots: [],
    onSaveEdit: async () => {},
    onCancelEdit: () => cancelled.push(1),
  });
  const form = host.querySelector('form[aria-label="Edit message"]')!;
  expect(form).not.toBeNull();
  expect(form.textContent).toContain("see you at noon");
  const names = [...form.querySelectorAll("button")].map((b) => b.textContent);
  expect(names).toEqual(["Save", "Cancel"]);
  // The toolbar is not drawn over the editor.
  expect(host.querySelector('button[aria-label="Message actions"]')).toBeNull();
  click([...form.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!);
  expect(cancelled).toEqual([1]);
});

test("an edited message says so after the time; the author opens the earlier versions", async () => {
  const edited = { ...(row as object), editedAt: "2026-11-03T12:30:00.000Z" };
  const reader = mount({ row: edited });
  expect(reader.textContent).toContain("edited");
  // Without the author's list the mark is only text.
  expect(reader.querySelector('button[aria-label^="edited"]')).toBeNull();
  const loaded: string[] = [];
  const host = mount({
    row: edited,
    onEdit: () => {},
    loadRevisions: async (r: { id: string }) => {
      loaded.push(r.id);
      return [
        { id: "r2", content: "see you at 11", createdAt: "2026-11-03T12:20:00.000Z" },
        { id: "r1", content: "see you at 10", createdAt: "2026-11-03T12:10:00.000Z" },
      ];
    },
  });
  const mark = host.querySelector('button[aria-label="edited, show earlier versions"]')!;
  expect(mark.textContent).toBe("edited");
  click(mark);
  await act(async () => {
    await new Promise((done) => setTimeout(done, 30));
  });
  const list = win.document.querySelector('ol[aria-label="Earlier versions"]')!;
  expect(loaded).toEqual(["m1"]);
  expect([...list.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
    "see you at 11",
    "see you at 10",
  ]);
});

test("a message never edited has no mark", () => {
  expect(mount({}).textContent).not.toContain("edited");
});

test("on a touch screen every message has a visible More button instead of the hover toolbar", () => {
  touchScreen();
  const host = mount({ onQuote: () => {} });
  const more = host.querySelector('button[aria-label="More"]')!;
  expect(more).not.toBeNull();
  expect(more.className).not.toContain("hidden");
  expect(host.querySelector('button[aria-label="Message actions"]')).toBeNull();
  expect(host.querySelector('[role="toolbar"]')).toBeNull();
});

test("on a screen that hovers there is no More button", () => {
  const host = mount({});
  expect(host.querySelector('button[aria-label="More"]')).toBeNull();
  expect(host.querySelector('button[aria-label="Message actions"]')).not.toBeNull();
});

test("the sheet lists Quote, Open thread, React, Pin, Copy and Edit, and each one acts", () => {
  touchScreen();
  const done: string[] = [];
  const host = mount({
    onQuote: () => done.push("quote"),
    onReply: () => done.push("thread"),
    onPin: () => done.push("pin"),
    onEdit: () => done.push("edit"),
  });
  const sheet = () => win.document.querySelector('[role="menu"]')!;
  const items = () => [...sheet().querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
  click(host.querySelector('button[aria-label="More"]'));
  expect(items()).toEqual(["Quote", "Open thread", "React", "Pin", "Copy", "Edit"]);
  const pick = (name: string) =>
    click([...sheet().querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === name)!);
  pick("Quote");
  expect(done).toEqual(["quote"]);
  click(host.querySelector('button[aria-label="More"]'));
  pick("Open thread");
  click(host.querySelector('button[aria-label="More"]'));
  pick("Pin");
  click(host.querySelector('button[aria-label="More"]'));
  pick("Edit");
  expect(done).toEqual(["quote", "thread", "pin", "edit"]);
});

test("the sheet of a bot's answer has no Edit, and a message in a thread has no Open thread", () => {
  touchScreen();
  const host = mount({
    row: { ...(row as object), role: "assistant", botId: "b1" },
    onEdit: () => {},
    inThread: true,
  });
  click(host.querySelector('button[aria-label="More"]'));
  const items = [...win.document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
  expect(items).toContain("React");
  expect(items).not.toContain("Edit");
  expect(items).not.toContain("Open thread");
});
