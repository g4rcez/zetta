import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
const { PinsBar } = await import("./pins-bar");

const pin = (messageId: string, excerpt: string, minutesAgo = 5) => ({
  messageId,
  role: "assistant" as const,
  botId: "b1",
  excerpt,
  pinnedByUserId: "u1",
  pinnedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
});
const authorOfPin = () => ({ name: "Helper" });

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  await new Promise((done) => setTimeout(done, 20));
});

function mount(pins: ReturnType<typeof pin>[], onUnpin: (id: string) => void = () => {}) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <PinsBar pins={pins} authorOfPin={authorOfPin} onUnpin={onUnpin} />
      </QueryClientProvider>,
    ),
  );
  return host as unknown as HTMLElement;
}
const click = (el: Element | null) => act(() => (el as unknown as HTMLElement).click());

test("nothing shows while nothing is pinned", () => {
  expect(mount([]).innerHTML).toBe("");
});

test("the newest pin shows its author and first words on one line", () => {
  const host = mount([pin("m2", "the deploy runs at noon"), pin("m1", "older note")]);
  const bar = host.querySelector('section[aria-label="Pinned messages"]')!;
  expect(bar.textContent).toContain("Helper");
  expect(bar.textContent).toContain("the deploy runs at noon");
  expect(bar.textContent).not.toContain("older note");
  expect(host.querySelector("span.truncate")).not.toBeNull();
});

test("a click on the pin goes to the message", () => {
  const target = win.document.createElement("div");
  target.id = "message-m1";
  let scrolled = 0;
  (target as never as { scrollIntoView: () => void }).scrollIntoView = () => scrolled++;
  win.document.body.append(target);
  const host = mount([pin("m1", "note")]);
  click(host.querySelector('button[aria-label="Go to the pinned message from Helper"]'));
  expect(scrolled).toBe(1);
});

test("with several pins a count opens the whole list, each with its own Unpin", () => {
  const unpinned: string[] = [];
  const host = mount([pin("m3", "third"), pin("m2", "second"), pin("m1", "first")], (id) =>
    unpinned.push(id),
  );
  expect(host.querySelector('ul[aria-label="All pinned messages"]')).toBeNull();
  const count = host.querySelector('button[aria-expanded="false"]')!;
  expect(count.textContent).toContain("3 pins");
  click(count);
  const list = host.querySelector('ul[aria-label="All pinned messages"]')!;
  expect(list.textContent).toContain("first");
  expect(list.textContent).toContain("second");
  click(list.querySelectorAll('button[aria-label^="Unpin the message"]')[1]!);
  expect(unpinned).toEqual(["m2"]);
});

test("a single pin has its Unpin right in the bar", () => {
  const unpinned: string[] = [];
  const host = mount([pin("m1", "only one")], (id) => unpinned.push(id));
  expect(host.querySelector("button[aria-expanded]")).toBeNull();
  click(host.querySelector('button[aria-label^="Unpin the message"]'));
  expect(unpinned).toEqual(["m1"]);
});
