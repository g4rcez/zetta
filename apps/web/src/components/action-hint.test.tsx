import { afterEach, expect, jest, mock, test } from "bun:test";
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

// A status icon sits inside a row that is a link: the hint is for the mouse only; the row keeps focus and tap.
const STATUS_ROW = (
  <a href="#row">
    <ActionHint hoverOnly label="Paused">
      <svg role="img" aria-label="Paused" />
    </ActionHint>
    <span>Nightly report</span>
  </a>
);

test("hoverOnly: the mouse shows the hint after the delay, and the icon stays a plain image", async () => {
  jest.useFakeTimers();
  try {
    const host = await mount(STATUS_ROW);
    const icon = host.querySelector("svg")!;
    await fire(icon, ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]);
    expect(tooltip()).toBeNull();
    await act(async () => void jest.advanceTimersByTime(300));
    expect(tooltip()?.textContent).toBe("Paused");
    expect(icon.getAttribute("role")).toBe("img");
    expect(icon.getAttribute("aria-label")).toBe("Paused");
    for (const name of ["tabindex", "aria-haspopup", "aria-expanded"])
      expect(icon.hasAttribute(name)).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("hoverOnly: a click on the icon reaches the row and keeps no hint open", async () => {
  jest.useFakeTimers();
  try {
    const onClick = mock((e: { preventDefault: () => void }) => e.preventDefault());
    const host = await mount(<div onClick={onClick}>{STATUS_ROW}</div>);
    const icon = host.querySelector("svg")!;
    await fire(icon, ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]);
    await act(async () => void jest.advanceTimersByTime(300));
    await press(icon);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(tooltip()).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test("hoverOnly: keyboard focus shows no hint, but a hint without hoverOnly does", async () => {
  const host = await mount(
    <>
      <ActionHint hoverOnly label="Only mouse">
        <button type="button" aria-label="Only mouse" />
      </ActionHint>
      <ActionHint label="Mouse and keys">
        <button type="button" aria-label="Mouse and keys" />
      </ActionHint>
    </>,
  );
  const [first, second] = host.querySelectorAll("button") as unknown as HTMLButtonElement[];
  await act(async () => first!.focus());
  expect(tooltip()).toBeNull();
  await act(async () => second!.focus());
  expect(tooltip()?.textContent).toBe("Mouse and keys");
});

test("hoverOnly: a touch pointer shows no hint", async () => {
  jest.useFakeTimers();
  try {
    const host = await mount(STATUS_ROW);
    const icon = host.querySelector("svg")!;
    await act(async () => {
      for (const type of ["pointerover", "pointerenter", "pointerdown"])
        icon.dispatchEvent(
          new win.PointerEvent(type, { bubbles: true, pointerType: "touch" }) as unknown as Event,
        );
    });
    // A touch tap makes the browser fire the compatibility mouse events after the pointer events.
    await fire(icon, ["mouseover", "mouseenter", "mousemove"]);
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(tooltip()).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
