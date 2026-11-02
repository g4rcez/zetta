import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { ResizeHandle } from "./resize-handle";

// React DOM reads these globals. This test file does not run in a browser.
const win = new Window();
const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"] as const;
const saved = globals.map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
);
Object.assign(globalThis, {
  window: win,
  document: win.document,
  navigator: win.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
});
// Bun runs every test file in one process: leave the globals as they were.
afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

const press = (edge: "left" | "right", key: string) => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const calls: number[] = [];
  const root = createRoot(host as unknown as Element);
  act(() => {
    root.render(
      <ResizeHandle
        edge={edge}
        label="Resize"
        value={500}
        min={400}
        max={800}
        fallback={640}
        onChange={(width) => calls.push(width)}
      />,
    );
  });
  const separator = host.querySelector('[role="separator"]')!;
  act(() => {
    separator.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true }));
  });
  act(() => root.unmount());
  return calls;
};

// A panel on the right of the page grows when its left edge moves left.
test("ArrowLeft makes a left-edge panel wider", () => {
  expect(press("left", "ArrowLeft")).toEqual([516]);
});

test("ArrowLeft makes a right-edge panel narrower", () => {
  expect(press("right", "ArrowLeft")).toEqual([484]);
});
