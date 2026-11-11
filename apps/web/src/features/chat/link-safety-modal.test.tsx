import { afterEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const { LinkSafetyModal } = await import("./link-safety-modal");

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
});

const URL_UNDER_TEST = "https://example.invalid/status/1";

test("the link check is the library dialog with the url and both actions", async () => {
  const onClose = mock(() => {});
  const onConfirm = mock(() => {});
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () =>
    root.render(
      <LinkSafetyModal isOpen onClose={onClose} onConfirm={onConfirm} url={URL_UNDER_TEST} />,
    ),
  );
  const dialog = win.document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog!.textContent).toContain("Open external link?");
  expect(dialog!.textContent).toContain(URL_UNDER_TEST);
  const open = [...dialog!.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Open link"),
  );
  expect(dialog!.textContent).toContain("Copy link");
  await act(async () => {
    (open as unknown as Element).dispatchEvent(
      new win.MouseEvent("click", { bubbles: true }) as unknown as Event,
    );
  });
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});
