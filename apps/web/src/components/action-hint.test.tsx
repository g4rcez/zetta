import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();

const render = async () => {
  const { Dropdown } = await import("@g4rcez/components/dropdown");
  const { ActionHint } = await import("./action-hint");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <Dropdown
        asChild
        arrow={false}
        aria-label="Files"
        trigger={
          <ActionHint label="Server files" delay={0}>
            <button type="button" aria-label="Server files" />
          </ActionHint>
        }
      >
        <p>File list</p>
      </Dropdown>,
    ),
  );
  const button = host.querySelector("button") as unknown as HTMLElement;
  return { button, unmount: () => act(async () => root.unmount()) };
};
const hint = () => win.document.querySelector('[role="tooltip"]');
const panel = () => win.document.querySelector('[role="dialog"]');

test("keyboard focus shows the hint on the control and Escape closes it", async () => {
  const { button, unmount } = await render();
  expect(hint()).toBeNull();
  await act(async () => button.focus());
  expect(hint()?.textContent).toBe("Server files");
  await act(async () => {
    button.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event,
    );
  });
  expect(hint()).toBeNull();
  await unmount();
});

test("a click opens the panel of the Dropdown and closes the hint", async () => {
  const { button, unmount } = await render();
  await act(async () => button.focus());
  expect(hint()).not.toBeNull();
  await act(async () => {
    button.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
  });
  expect(panel()?.textContent).toBe("File list");
  expect(hint()).toBeNull();
  await unmount();
});
