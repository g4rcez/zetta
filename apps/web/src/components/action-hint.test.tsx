import { afterEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();

const { ActionHint } = await import("./action-hint");
const { Dropdown, Menu, MenuItem } = await import("./ui");

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
  return host as unknown as Element;
}

const tooltip = () => win.document.querySelector('[role="tooltip"]');
const fire = (el: unknown, types: string[]) =>
  act(async () => {
    for (const type of types)
      (el as Element).dispatchEvent(
        new win.MouseEvent(type, { bubbles: true, button: 0 }) as unknown as Event,
      );
  });
const hover = async (el: unknown) => {
  await fire(el, [
    "pointerover",
    "pointerenter",
    "mouseover",
    "mouseenter",
    "pointermove",
    "mousemove",
  ]);
  await act(async () => void (await new Promise((r) => setTimeout(r, 400))));
};
const press = (el: unknown) =>
  fire(el, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);

test("the hint goes onto the child itself: no wrapper, the child keeps its props", async () => {
  const onClick = mock(() => {});
  const host = await mount(
    <ActionHint label="Reply">
      <button type="button" aria-label="Reply" onClick={onClick}>
        r
      </button>
    </ActionHint>,
  );
  expect(host.children).toHaveLength(1);
  const button = host.querySelector("button")!;
  expect(button.parentElement).toBe(host as never);
  await press(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("hovering shows the label with aria-describedby, and a click closes it", async () => {
  const host = await mount(
    <ActionHint label="Reply">
      <button type="button" aria-label="Reply">
        r
      </button>
    </ActionHint>,
  );
  const button = host.querySelector("button")!;
  expect(tooltip()).toBeNull();
  await hover(button);
  expect(tooltip()?.textContent).toBe("Reply");
  expect(button.getAttribute("aria-describedby")).toBe(tooltip()!.id);
  expect(button.hasAttribute("aria-haspopup")).toBe(false);
  await press(button);
  expect(tooltip()).toBeNull();
});

test("closeOnClick={false} keeps the hint, so a label that changes on click can be read", async () => {
  const host = await mount(
    <ActionHint label="Copy" closeOnClick={false}>
      <button type="button" aria-label="Copy">
        c
      </button>
    </ActionHint>,
  );
  const button = host.querySelector("button")!;
  await hover(button);
  await press(button);
  expect(tooltip()?.textContent).toBe("Copy");
});

test("a Menu trigger can carry a hint: hover shows it, a click opens the menu and the item runs", async () => {
  const onPick = mock(() => {});
  const host = await mount(
    <Menu
      asChild
      hover={false}
      restoreFocus
      title=""
      label={
        <ActionHint label="More actions">
          <button type="button" aria-label="More actions">
            ⋯
          </button>
        </ActionHint>
      }
    >
      <MenuItem title="Save" onClick={onPick}>
        Save
      </MenuItem>
    </Menu>,
  );
  const button = host.querySelector("button")!;
  // `title=""` keeps the native tooltip away from the one of the hint.
  expect(button.getAttribute("title") ?? "").toBe("");
  await hover(button);
  expect(tooltip()?.textContent).toBe("More actions");
  await press(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(win.document.querySelector('[role="menu"]')).not.toBeNull();
  await press(win.document.querySelector('[role="menuitem"]')!);
  expect(onPick).toHaveBeenCalledTimes(1);
});

test("a Dropdown trigger can carry a hint and opens its panel on a click", async () => {
  const host = await mount(
    <Dropdown
      asChild
      aria-label="Panel"
      trigger={
        <ActionHint label="Open the panel">
          <button type="button" aria-label="Open the panel">
            o
          </button>
        </ActionHint>
      }
    >
      <p>inside</p>
    </Dropdown>,
  );
  const button = host.querySelector("button")!;
  await hover(button);
  expect(tooltip()?.textContent).toBe("Open the panel");
  await press(button);
  expect(win.document.querySelector('[role="dialog"][aria-label="Panel"]')?.textContent).toContain(
    "inside",
  );
});
