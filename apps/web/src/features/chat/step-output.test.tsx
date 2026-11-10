import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

/** What a browser's EventSource does for the part the component uses: open, messages, a refusal. */
class FakeSource {
  static all: FakeSource[] = [];
  static CLOSED = 2;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(
    readonly url: string,
    readonly init: unknown,
  ) {
    FakeSource.all.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  send(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}
const saved = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
beforeEach(() => {
  FakeSource.all = [];
  Object.assign(globalThis, { EventSource: FakeSource });
});
afterEach(() => {
  if (saved) Object.defineProperty(globalThis, "EventSource", saved);
  else Reflect.deleteProperty(globalThis, "EventSource");
});

const timeline = [
  { at: 1_000, label: "Reading a.ts" },
  { at: 2_000, label: "Running sed", stepId: "toolu_1" },
  { at: 3_000, label: "Running cd", stepId: "toolu_2" },
];

const render = async (working: boolean, withUrl = true) => {
  const { WorkTimeline } = await import("./work-timeline");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <WorkTimeline
        row={{ id: "r1", createdAt: "2026-11-09T01:00:00.000Z", timeline } as never}
        working={working}
        stepOutputUrl={
          withUrl ? (id) => `https://api.example.invalid/steps/${id}/output` : undefined
        }
      />,
    ),
  );
  const buttons = () => [...host.querySelectorAll("button[aria-expanded]")];
  return { host, buttons, unmount: () => act(async () => root.unmount()) };
};
const click = (el: unknown) =>
  act(async () => {
    (el as EventTarget).dispatchEvent(
      new win.MouseEvent("click", { bubbles: true }) as unknown as Event,
    );
  });

test("only the commands of a running turn are buttons", async () => {
  const { buttons, unmount } = await render(true);
  expect(buttons().map((b) => b.textContent)).toEqual(["Running sed", "Running cd"]);
  await unmount();
});

test("a finished turn, or a page without the stream, has no buttons and opens no connection", async () => {
  const done = await render(false);
  expect(done.buttons()).toEqual([]);
  await done.unmount();
  const bare = await render(true, false);
  expect(bare.buttons()).toEqual([]);
  await bare.unmount();
  expect(FakeSource.all).toEqual([]);
});

test("clicking a command streams its output, and clicking again closes the stream", async () => {
  const { host, buttons, unmount } = await render(true);
  await click(buttons()[0]!);
  const source = FakeSource.all[0]!;
  expect(source.url).toBe("https://api.example.invalid/steps/toolu_1/output");
  expect(buttons()[0]!.getAttribute("aria-expanded")).toBe("true");
  await act(async () => source.onopen?.());
  await act(async () => source.send({ type: "chunk", text: "count-1\n" }));
  await act(async () => source.send({ type: "chunk", text: "count-2\n" }));
  const pre = host.querySelector("pre")!;
  expect(pre.textContent).toBe("count-1\ncount-2\n");
  expect(pre.getAttribute("aria-label")).toBe("Output of Running sed");
  expect(host.textContent).toContain("Live · not saved");
  await act(async () => source.send({ type: "end" }));
  expect(host.textContent).toContain("Finished · not saved");
  expect(source.closed).toBe(true);
  await click(buttons()[0]!);
  expect(host.querySelector("pre")).toBeNull();
  await unmount();
});

test("one command is open at a time, and closing a step ends its connection", async () => {
  const { host, buttons, unmount } = await render(true);
  await click(buttons()[0]!);
  await click(buttons()[1]!);
  expect(host.querySelectorAll("pre").length).toBe(1);
  expect(FakeSource.all.map((s) => [s.url.split("/").at(-2), s.closed])).toEqual([
    ["toolu_1", true],
    ["toolu_2", false],
  ]);
  await unmount();
  expect(FakeSource.all.at(-1)!.closed).toBe(true);
});

test("a reconnect starts the text over, and a refusal says the output is not available", async () => {
  const { host, buttons, unmount } = await render(true);
  await click(buttons()[1]!);
  const source = FakeSource.all[0]!;
  await act(async () => source.onopen?.());
  await act(async () => source.send({ type: "chunk", text: "old\n" }));
  await act(async () => source.onopen?.());
  expect(host.querySelector("pre")!.textContent).toBe("Waiting for output…");
  await act(async () => {
    source.readyState = 2;
    source.onerror?.();
  });
  expect(host.querySelector("pre")!.textContent).toBe("Output is not available here.");
  expect(host.textContent).toContain("Not available · not saved");
  await unmount();
});
