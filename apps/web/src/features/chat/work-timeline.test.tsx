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
  await act(async () => root.render(<WorkTimeline row={row(count) as never} working={working} />));
  return { list: host.querySelector("ol")!, unmount: () => act(async () => root.unmount()) };
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

test("a finished turn starts at the top", async () => {
  layout(1000, 240);
  const { list, unmount } = await render(30, false);
  expect(list.scrollTop).toBe(0);
  await unmount();
});
