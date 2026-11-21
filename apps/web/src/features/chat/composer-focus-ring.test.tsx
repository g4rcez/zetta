import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const { InputGroup, InputGroupAddon, InputGroupButton } =
  await import("@zetta/ui/components/input-group");

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
});

test("composer icon buttons take keyboard focus and carry the 2px --ring focus-visible outline (WCAG 2.4.7)", async () => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () =>
    root.render(
      <InputGroup>
        <InputGroupAddon align="block-end">
          <InputGroupButton size="icon-xs" aria-label="Attach files or images" />
          <InputGroupButton size="icon-sm" variant="default" type="submit" aria-label="Send" />
        </InputGroupAddon>
      </InputGroup>,
    ),
  );
  const buttons = [...host.querySelectorAll("button")] as unknown as HTMLButtonElement[];
  expect(buttons).toHaveLength(2);
  for (const b of buttons) {
    // Tab reaches it: a native button without tabindex=-1.
    expect(b.tabIndex).toBe(0);
    b.focus();
    expect(win.document.activeElement as unknown).toBe(b);
    const cls = b.className.split(/\s+/);
    // :focus-visible only, so a mouse click shows no ring; the colour is the --ring token.
    expect(cls).toContain("focus-visible:outline-2");
    expect(cls).toContain("focus-visible:outline-ring");
    expect(cls).toContain("focus-visible:outline-offset-2");
    expect(cls).not.toContain("outline-none!");
  }
  // The ring is drawn outside the button, so no ancestor up to the group may clip it.
  for (let el = buttons[0]!.parentElement; el && el !== (host as unknown); el = el.parentElement)
    expect(el.className).not.toMatch(/overflow-(hidden|clip)/);
});
