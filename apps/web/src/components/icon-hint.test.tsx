import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();

const render = async () => {
  const { IconHint } = await import("./icon-hint");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <IconHint label="Chief">
        <svg data-testid="crown" />
      </IconHint>,
    ),
  );
  const trigger = host.querySelector('[aria-label="Chief"]') as unknown as HTMLElement;
  return { trigger, unmount: () => act(async () => root.unmount()) };
};
const popup = () => win.document.querySelector('[role="dialog"]');

test("the icon has one accessible name and the svg is hidden", async () => {
  const { trigger, unmount } = await render();
  expect(trigger.getAttribute("aria-label")).toBe("Chief");
  expect(trigger.getAttribute("tabindex")).toBe("0");
  expect(trigger.getAttribute("role")).toBe("button");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  expect(popup()).toBeNull();
  await unmount();
});

test("keyboard focus shows the label and Escape closes it", async () => {
  const { trigger, unmount } = await render();
  await act(async () => trigger.focus());
  expect(popup()?.textContent).toBe("Chief");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(async () => {
    win.document.activeElement?.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(popup()).toBeNull();
  await unmount();
});
