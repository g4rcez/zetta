import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const { TaskFilterBar } = await import("./task-filter-bar");
const { DEFAULT_STATE } = await import("./task-filters");

const bots = [
  {
    id: "00000000-0000-7000-8000-000000000001",
    name: "Da Vinci",
    kind: "specialist",
    description: "Draws and designs",
    avatar: null,
  },
  {
    id: "00000000-0000-7000-8000-000000000002",
    name: "Scout",
    kind: "specialist",
    description: "",
    avatar: null,
  },
] as never;

const wait = (ms: number) => act(() => new Promise<void>((done) => setTimeout(done, ms)));

const roots: ReturnType<typeof createRoot>[] = [];
// An open hint of one test must not stay in the document of the next.
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
});

async function mount() {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () => {
    root.render(
      <TaskFilterBar state={DEFAULT_STATE} onChange={() => {}} bots={bots} labels={[]} />,
    );
  });
  return host;
}

const avatar = (host: Element, name: string) =>
  host.querySelector(`[aria-label="${name}"]`) as unknown as HTMLElement;

async function hover(el: HTMLElement) {
  await act(async () => {
    for (const type of [
      "pointerover",
      "pointerenter",
      "mouseover",
      "mouseenter",
      "pointermove",
      "mousemove",
    ])
      el.dispatchEvent(new win.MouseEvent(type, { bubbles: true }) as unknown as Event);
  });
  await wait(800);
}

test("hovering a bot avatar names it and says what it is", async () => {
  const host = await mount();
  expect(win.document.querySelector('[role="tooltip"]')).toBeNull();
  await hover(avatar(host as unknown as Element, "Da Vinci"));
  const popup = win.document.querySelector('[role="tooltip"]');
  expect(popup?.textContent).toBe("Da VinciDraws and designs");
});

test("a bot with no description falls back to its role", async () => {
  const host = await mount();
  await hover(avatar(host as unknown as Element, "Scout"));
  expect(win.document.querySelector('[role="tooltip"]')?.textContent).toBe("ScoutSpecialist");
});

test("the fixed avatars explain themselves", async () => {
  const host = await mount();
  await hover(avatar(host as unknown as Element, "Unassigned"));
  expect(win.document.querySelector('[role="tooltip"]')?.textContent).toBe(
    "UnassignedTasks nobody owns",
  );
});

test("the avatar no longer carries a native title", async () => {
  const host = await mount();
  expect(avatar(host as unknown as Element, "Da Vinci").getAttribute("title")).toBeNull();
});
