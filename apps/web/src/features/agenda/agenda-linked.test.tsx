import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const { LinkedEventLabel, LinkedEventModal } = await import("./agenda-linked");

const event = {
  id: "ics-1",
  calendar: "Work",
  title: "Planning <b>now</b>",
  startAt: "2026-12-03T00:00:00.000Z",
  endAt: null,
  allDay: true,
  location: "Room 4",
  description: "Line one\nLine two <script>alert(1)</script>",
  recurring: true,
};

async function mount(node: React.ReactNode) {
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(node));
  return { host: host as unknown as HTMLElement, root };
}

test("a linked event is marked as a read-only link in the calendar", async () => {
  const { host, root } = await mount(<LinkedEventLabel event={event} />);
  expect(host.textContent).toContain("All day");
  expect(host.textContent).toContain("Link");
  expect(host.textContent).toContain("read-only");
  await act(async () => root.unmount());
});

test("its details are plain text with no way to edit, complete or delete", async () => {
  let closed = 0;
  const { root } = await mount(
    <LinkedEventModal event={event} onClose={() => void (closed += 1)} />,
  );
  const text = win.document.body.textContent ?? "";
  expect(text).toContain("From the calendar link “Work”. It is read-only");
  expect(text).toContain("2026-12-03");
  expect(text).toContain("(repeats)");
  expect(text).toContain("Room 4");
  // The feed's markup is shown as text, never run or parsed.
  expect(text).toContain("<b>now</b>");
  expect(win.document.body.querySelector("script")).toBeNull();
  expect(win.document.body.querySelector("b")).toBeNull();
  expect(win.document.body.querySelector("form")).toBeNull();
  expect(win.document.body.querySelector("input, textarea, select")).toBeNull();
  const labels = [...win.document.body.querySelectorAll("button")].map((b) =>
    b.textContent?.trim(),
  );
  for (const edit of ["Save", "Delete", "Mark done", "Add"]) expect(labels).not.toContain(edit);
  const close = [...win.document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Close",
  );
  await act(async () => void close?.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  expect(closed).toBeGreaterThan(0);
  await act(async () => root.unmount());
});
