import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();
const { StatusHint } = await import("./status-hint");

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
});

test("a status icon has a name, hides its svg, and is not a tab stop (focus belongs to the row)", async () => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () =>
    root.render(
      <a href="/x">
        Row
        <StatusHint label="Paused">
          <svg data-testid="icon" />
        </StatusHint>
      </a>,
    ),
  );
  const mark = host.querySelector('[role="img"]')!;
  expect(mark.getAttribute("aria-label")).toBe("Paused");
  expect(mark.hasAttribute("tabindex")).toBe(false);
  expect(mark.getAttribute("aria-haspopup")).toBeNull();
  expect(mark.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
});
