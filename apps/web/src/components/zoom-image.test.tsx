import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();

const mount = async () => {
  const { ZoomImage, zoomAt } = await import("@/components/zoom-image");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<ZoomImage src="data:image/png;base64,AAAA" alt="Chart" />));
  return { host, zoomAt, unmount: () => act(async () => root.unmount()) };
};
const click = (el: Element) =>
  act(async () => void el.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));

test("zooming keeps the point under the cursor in place and stays between 1x and 8x", async () => {
  const { zoomAt, unmount } = await mount();
  const fit = { scale: 1, x: 0, y: 0 };
  const z = zoomAt(fit, 2, 100, 50);
  expect(z).toEqual({ scale: 2, x: -100, y: -50 });
  expect(zoomAt(z, 100, 0, 0).scale).toBe(8);
  expect(zoomAt(z, 0.1, 0, 0)).toEqual(fit);
  await unmount();
});

test("a click on the image opens the fullscreen viewer and the buttons zoom it", async () => {
  const { host, unmount } = await mount();
  const img = host.querySelector("img[alt='Chart']")!;
  expect(win.document.querySelector("dialog")).toBeNull();
  await click(img);
  const dialog = win.document.querySelector("dialog")!;
  expect(dialog).not.toBeNull();
  const level = () => dialog.querySelector("button[aria-label='Fit to screen']")!.textContent;
  expect(level()).toBe("100%");
  await click(dialog.querySelector("button[aria-label='Zoom in']")!);
  expect(level()).toBe("150%");
  await click(dialog.querySelector("button[aria-label='Fit to screen']")!);
  expect(level()).toBe("100%");
  await unmount();
});
