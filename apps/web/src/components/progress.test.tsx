import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();

const { Progress } = await import("./ui");

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
});

async function mount(node: React.ReactNode) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

/** The accessible name: `aria-label`, or the text of the element `aria-labelledby` points to. */
const nameOf = (node: unknown) => {
  const el = node as Element;
  return (
    el.getAttribute("aria-label") ??
    win.document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent
  );
};

test("it is a progressbar with its value, range and an accessible name", async () => {
  const host = await mount(<Progress label="Storage used" value={40} />);
  const bar = host.querySelector('[role="progressbar"]')!;
  expect(bar.getAttribute("aria-valuenow")).toBe("40");
  expect(bar.getAttribute("aria-valuemin")).toBe("0");
  expect(bar.getAttribute("aria-valuemax")).toBe("100");
  expect(nameOf(bar)).toBe("Storage used");
});

test("a range that does not start at 0 keeps its own values (onboarding steps)", async () => {
  const host = await mount(<Progress label="Onboarding progress" min={1} max={5} value={2} />);
  const bar = host.querySelector('[role="progressbar"]')!;
  expect(bar.getAttribute("aria-valuemin")).toBe("1");
  expect(bar.getAttribute("aria-valuemax")).toBe("5");
  expect(bar.getAttribute("aria-valuenow")).toBe("2");
});

test("the percentage text over the track is hidden for the eye, and the size and color are tokens", async () => {
  const host = await mount(
    <Progress label="Instruction quality" value={90} tone="danger" size="small" className="w-40" />,
  );
  expect(host.firstElementChild!.className).toBe("w-40");
  const bar = host.querySelector('[role="progressbar"]')!;
  expect(bar.className).toContain("--var-progress-track-block-size");
  expect(bar.className).toContain("--var-color-primary:var(--destructive)");
  const label = host.querySelector('[data-slot="label"]');
  expect(label?.className).toContain("sr-only");
});
