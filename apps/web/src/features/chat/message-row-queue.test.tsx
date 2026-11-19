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

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.replaceChildren();
  await new Promise((done) => setTimeout(done, 20));
});

function mount(row: Record<string, unknown>, props: Record<string, unknown> = {}) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  act(() =>
    root.render(
      withQuery(
        <MessageRow
          row={
            {
              id: "m1",
              role: "user",
              content: "also check the logs",
              status: "complete",
              createdAt: "2026-11-10T12:00:00.000Z",
              ...row,
            } as never
          }
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
const buttons = (host: HTMLElement) =>
  [...host.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean);
const press = (host: HTMLElement, label: string) =>
  act(() =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === label)!
      .dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );

test("a message an older Stop held can still be sent or removed", () => {
  const acts: string[] = [];
  const host = mount(
    { queue: "held" },
    { onQueue: (_row: unknown, action: string) => acts.push(action) },
  );
  expect(host.textContent).toContain("Held: you stopped the bot before it read this.");
  expect(buttons(host)).toEqual(expect.arrayContaining(["Send now", "Remove"]));
  press(host, "Send now");
  press(host, "Remove");
  expect(acts).toEqual(["retry", "remove"]);
});

test("a message the bot has not read yet looks like any other message: no waiting text, nothing to press", () => {
  const plain = mount({}, { onQueue: () => {} });
  const waiting = mount({ id: "m2", queue: "pending" }, { onQueue: () => {} });
  expect(waiting.textContent).not.toMatch(/wait|queue|held/i);
  expect(buttons(waiting)).not.toContain("Send now");
  expect(buttons(waiting)).not.toContain("Remove");
  expect(buttons(waiting)).toEqual(buttons(plain));
  // A message the bot took while it worked has no line of its own either: the read mark says it.
  const read = mount(
    { id: "m3", meta: { steer: { replyId: "r1", at: 1 } } },
    { onQueue: () => {} },
  );
  expect(read.textContent).not.toContain("next step");
});

test("a message that keeps a turn of its own says when the bot reads it, with nothing to press", () => {
  const host = mount({ queue: "pending", waits: "after_reply" }, { onQueue: () => {} });
  expect(host.textContent).toContain("The bot reads this when its current reply ends.");
  expect(buttons(host)).not.toContain("Send now");
  expect(buttons(host)).not.toContain("Remove");
});

test("a message being answered says so, and one that was not answered can be sent again or removed", () => {
  const merged = mount({ queue: "merged" }, { onQueue: () => {} });
  expect(merged.textContent).toContain("Answering it with the messages below");
  expect(buttons(merged)).not.toContain("Remove");
  const acts: string[] = [];
  const failed = mount(
    { id: "m2", queue: "failed" },
    { onQueue: (_row: unknown, action: string) => acts.push(action) },
  );
  expect(failed.textContent).toContain("Not answered.");
  press(failed, "Retry");
  press(failed, "Remove");
  expect(acts).toEqual(["retry", "remove"]);
});

test("a read-only log shows the state without actions", () => {
  const host = mount({ queue: "held" }, { onQueue: () => {}, readOnly: true });
  expect(host.textContent).toContain("Held");
  expect(buttons(host)).not.toContain("Send now");
});

test('a "stop" typed in the chat says what it stopped', () => {
  expect(mount({ meta: { stop: { held: 0, rooms: 0 } } }).textContent).toContain(
    "Stopped the bot.",
  );
  const both = mount({ id: "m3", meta: { stop: { unread: 2, rooms: 1 } } }).textContent;
  expect(both).toContain("It had not read 2 of your messages.");
  expect(both).toContain("One room was silenced.");
  // A stop saved before the count was renamed still reads.
  expect(mount({ id: "m4", meta: { stop: { held: 1, rooms: 0 } } }).textContent).toContain(
    "It had not read one of your messages.",
  );
});
