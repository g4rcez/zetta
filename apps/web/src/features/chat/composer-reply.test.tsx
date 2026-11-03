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
const { Composer } = await import("./composer");

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  await new Promise((done) => setTimeout(done, 20));
});

function mount(replyTo: { id: string; name: string; excerpt: string; onCancel: () => void }) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  act(() =>
    root.render(
      <Composer
        value=""
        onChange={() => {}}
        placeholder="Message"
        bots={[]}
        busy={false}
        onSubmit={() => true}
        onError={() => {}}
        replyTo={replyTo}
      />,
    ),
  );
  return host as unknown as HTMLElement;
}

test("a reply shows who it answers and what, and the X cancels it", () => {
  let cancelled = 0;
  const host = mount({
    id: "m1",
    name: "Helper",
    excerpt: "the deploy runs at noon",
    onCancel: () => cancelled++,
  });
  expect(host.textContent).toContain("Replying to");
  expect(host.textContent).toContain("Helper");
  expect(host.textContent).toContain("the deploy runs at noon");
  act(() =>
    (host.querySelector('button[aria-label="Cancel reply"]') as unknown as HTMLElement).click(),
  );
  expect(cancelled).toBe(1);
});
