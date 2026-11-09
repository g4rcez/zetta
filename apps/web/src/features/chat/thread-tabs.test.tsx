import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const { ThreadTabs } = await import("./thread-tabs");

const threads = [
  { id: "c1", botId: "b1", title: "Plan the launch", updatedAt: "2026-11-07T10:00:00Z" },
  { id: "c2", botId: "b1", title: "Fix the build", updatedAt: "2026-11-06T10:00:00Z" },
];

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
});

async function mount(props: Partial<Parameters<typeof ThreadTabs>[0]> = {}) {
  const onUpdate = mock(() => {});
  const onDelete = mock(() => {});
  const onOpen = mock(() => {});
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <ThreadTabs
          threads={threads}
          botId="b1"
          chatId="c1"
          onOpen={onOpen}
          onNew={() => {}}
          onUpdate={onUpdate}
          onDelete={onDelete}
          {...props}
        />
      </QueryClientProvider>,
    ),
  );
  return { host: host as unknown as Element, onUpdate, onDelete, onOpen };
}

const press = (el: unknown) =>
  act(async () => {
    const target = el as HTMLElement;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      target.dispatchEvent(
        new win.MouseEvent(type, { bubbles: true, button: 0 }) as unknown as Event,
      );
  });
const byLabel = (label: string) =>
  win.document.querySelector(`[aria-label="${label}"]`) as unknown as HTMLElement;
const items = () => [...win.document.querySelectorAll('[role="menu"] [role="menuitem"]')];

test("the actions button opens a menu and an item runs its action", async () => {
  const { onUpdate } = await mount();
  const trigger = byLabel("Actions for Plan the launch");
  expect(win.document.querySelector('[role="menu"]')).toBeNull();
  await press(trigger);
  expect(win.document.querySelector('[role="menu"]')).not.toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(trigger.hasAttribute("data-open")).toBe(true);
  expect(items().map((i) => i.textContent?.trim())).toEqual(["Rename", "Archive", "Delete"]);
  await press(items()[1]!);
  expect(onUpdate).toHaveBeenCalledWith("c1", { archived: true });
  // Choosing an item closes the menu.
  expect(win.document.querySelector('[role="menu"]')).toBeNull();
});

test("Delete is the danger item and calls onDelete", async () => {
  const { onDelete } = await mount();
  await press(byLabel("Actions for Plan the launch"));
  const del = items()[2]! as unknown as HTMLElement;
  expect(del.className).toContain("danger");
  await press(del);
  expect(onDelete).toHaveBeenCalledWith("c1");
});

test("Escape closes the menu", async () => {
  await mount();
  await press(byLabel("Actions for Plan the launch"));
  expect(win.document.querySelector('[role="menu"]')).not.toBeNull();
  await act(async () => {
    win.document.activeElement?.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(win.document.querySelector('[role="menu"]')).toBeNull();
});

test("the title opens the chat switcher with the search field focused, and a pick opens that chat", async () => {
  const { host, onOpen } = await mount();
  const trigger = host.querySelector("button[aria-expanded]") as unknown as HTMLElement;
  expect(trigger.textContent).toContain("Plan the launch");
  await press(trigger);
  const panel = win.document.querySelector('[role="dialog"][aria-label="Switch chat"]');
  expect(panel).not.toBeNull();
  const search = win.document.querySelector('[role="combobox"]') as unknown as HTMLElement;
  expect(win.document.activeElement).toBe(search as never);
  const options = [...win.document.querySelectorAll('[role="option"]')];
  expect(options.map((o) => o.textContent?.trim())).toEqual([
    "Plan the launch (open)",
    "Fix the build",
  ]);
  await press(options[1]!);
  expect(onOpen).toHaveBeenCalledWith("c2");
  expect(win.document.querySelector('[role="dialog"][aria-label="Switch chat"]')).toBeNull();
});
