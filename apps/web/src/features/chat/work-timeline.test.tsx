import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const row = (count: number) => ({
  id: "r1",
  createdAt: "2026-11-06T10:00:00.000Z",
  timeline: Array.from({ length: count }, (_, i) => ({ at: 1_000 * i, label: `Step ${i + 1}` })),
});

const render = async (count: number, working: boolean) => {
  const { WorkTimeline } = await import("./work-timeline");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const show = (n: number, w: boolean) =>
    act(async () => root.render(<WorkTimeline row={row(n) as never} working={w} />));
  await show(count, working);
  return {
    host,
    list: host.querySelector("ol")!,
    rerender: show,
    scroll: (top: number) =>
      act(async () => {
        host.querySelector("ol")!.scrollTop = top;
        host.querySelector("ol")!.dispatchEvent(new win.Event("scroll"));
      }),
    unmount: () => act(async () => root.unmount()),
  };
};

// happy-dom has no layout engine: give the list the sizes a browser would measure.
const proto = win.HTMLElement.prototype;
const layout = (scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(proto, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => clientHeight });
};
afterEach(() => {
  Reflect.deleteProperty(proto, "scrollHeight");
  Reflect.deleteProperty(proto, "clientHeight");
});

test("the list has a fixed maximum height and scrolls inside it", async () => {
  const { list, unmount } = await render(30, true);
  expect(list.className).toContain("max-h-60");
  expect(list.className).toContain("overflow-y-auto");
  await unmount();
});

// The step icons carry an `sr-only` (position: absolute) label. A list that is not positioned does not clip them, so each step added
// to the chat log's scroll height (31,716px for a long task) and the log scrolled into empty space.
test("the list is positioned so it clips its sr-only step labels", async () => {
  const { list, unmount } = await render(30, true);
  expect(list.className).toMatch(/(^|\s)relative(\s|$)/);
  await unmount();
});

test("a list that fits has no Tab stop", async () => {
  layout(120, 120);
  const { list, unmount } = await render(3, true);
  expect(list.hasAttribute("tabindex")).toBe(false);
  await unmount();
});

test("a list that overflows is reachable with the keyboard and keeps its name", async () => {
  layout(1000, 240);
  const { list, unmount } = await render(30, true);
  expect(list.getAttribute("tabindex")).toBe("0");
  expect(list.getAttribute("aria-label")).toBe("Work timeline");
  await unmount();
});

test("while the bot works the list opens at the newest step", async () => {
  layout(1000, 240);
  const { list, unmount } = await render(30, true);
  expect(list.scrollTop).toBe(1000);
  await unmount();
});

test("a finished turn goes back to the top", async () => {
  layout(1000, 240);
  const { list, rerender, unmount } = await render(30, true);
  expect(list.scrollTop).toBe(1000);
  await rerender(30, false);
  expect(list.scrollTop).toBe(0);
  await unmount();
});

test("a new step does not pull the list down after the reader scrolled up", async () => {
  layout(1000, 240);
  const { list, rerender, scroll, unmount } = await render(30, true);
  await scroll(100);
  await rerender(31, true);
  expect(list.scrollTop).toBe(100);
  await unmount();
});

test("a new step still follows when the reader is within 8px of the bottom", async () => {
  layout(1000, 240);
  const { list, rerender, scroll, unmount } = await render(30, true);
  await scroll(755);
  await rerender(31, true);
  expect(list.scrollTop).toBe(1000);
  await unmount();
});

// The timeline is one quiet line that opens on click, not a box that is open while the bot works.
test("the rail starts closed, also while the bot works", async () => {
  const { host, unmount } = await render(5, true);
  expect(host.querySelector("details")!.hasAttribute("open")).toBe(false);
  await unmount();
});

test("while the bot works the line names the newest step", async () => {
  const { host, unmount } = await render(5, true);
  const line = host.querySelector("summary")!.textContent ?? "";
  expect(line).toContain("Step 5");
  expect(line).not.toContain("Step 4");
  await unmount();
});

test("a finished turn says how many steps it took", async () => {
  const { host, unmount } = await render(6, false);
  expect(host.querySelector("summary")!.textContent).toMatch(/^Worked · 6 steps · \d+s$/);
  await unmount();
});

test("the line has no dashed box around it", async () => {
  const { host, unmount } = await render(6, false);
  expect(host.querySelector("details")!.className).not.toContain("border-dashed");
  await unmount();
});
