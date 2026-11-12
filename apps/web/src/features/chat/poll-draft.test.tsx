import { afterEach, expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import {
  MAX_POLL_OPTIONS,
  NEW_POLL,
  pollDraftReady,
  pollOptionsOf,
  type PollDraft,
} from "./poll-draft";

const win = setupDom();
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
const { PollDraftEditor } = await import("./poll-draft");

test("the options are trimmed and the empty ones dropped", () => {
  expect(pollOptionsOf({ options: [" Pizza ", "", "  ", "Sushi"], mode: "single" })).toEqual([
    "Pizza",
    "Sushi",
  ]);
});

test("a poll is ready with 2 to 10 different options; no poll is always ready", () => {
  const draft = (options: string[]): PollDraft => ({ options, mode: "single" });
  expect(pollDraftReady(undefined)).toBe(true);
  expect(pollDraftReady(NEW_POLL)).toBe(false);
  expect(pollDraftReady(draft(["a", ""]))).toBe(false);
  expect(pollDraftReady(draft(["a", "A"]))).toBe(false);
  expect(pollDraftReady(draft(["a", "b"]))).toBe(true);
  expect(pollDraftReady(draft(Array.from({ length: MAX_POLL_OPTIONS }, (_, i) => `o${i}`)))).toBe(
    true,
  );
  expect(
    pollDraftReady(draft(Array.from({ length: MAX_POLL_OPTIONS + 1 }, (_, i) => `o${i}`))),
  ).toBe(false);
});

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  await new Promise((done) => setTimeout(done, 20));
});

function Harness({ onDraft, onClose }: { onDraft: (d: PollDraft) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<PollDraft>(NEW_POLL);
  return (
    <PollDraftEditor
      draft={draft}
      onChange={(d) => {
        setDraft(d);
        onDraft(d);
      }}
      onClose={onClose}
    />
  );
}
function mount(onDraft: (d: PollDraft) => void = () => {}, onClose: () => void = () => {}) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  act(() => root.render(<Harness onDraft={onDraft} onClose={onClose} />));
  return host as unknown as HTMLElement;
}
const click = (el: Element | null) => act(() => (el as unknown as HTMLElement).click());
const byLabel = (host: HTMLElement, label: string) => host.querySelector(`[aria-label="${label}"]`);

test("starts with two empty options, and options can be added and removed", () => {
  const seen: PollDraft[] = [];
  const host = mount((d) => seen.push(d));
  expect(host.querySelectorAll("ol li")).toHaveLength(2);
  // With two options there is nothing to remove.
  expect(byLabel(host, "Remove option 1")).toBeNull();
  click(
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Add an option")) ??
      null,
  );
  expect(host.querySelectorAll("ol li")).toHaveLength(3);
  click(byLabel(host, "Remove option 2"));
  expect(host.querySelectorAll("ol li")).toHaveLength(2);
  expect(seen.at(-1)!.options).toHaveLength(2);
});

test("the option field cannot hold more than a label", () => {
  const host = mount();
  expect(byLabel(host, "Option 1")!.getAttribute("maxlength")).toBe("80");
});

test("the mode switches between one choice and several, and the poll can be removed", () => {
  const seen: PollDraft[] = [];
  let closed = 0;
  const host = mount(
    (d) => seen.push(d),
    () => closed++,
  );
  const several = [...host.querySelectorAll('[aria-label="How many choices"] button')].find((b) =>
    b.textContent?.includes("Several"),
  )!;
  click(several);
  expect(seen.at(-1)!.mode).toBe("multiple");
  expect(several.getAttribute("aria-pressed")).toBe("true");
  click(byLabel(host, "Remove the poll"));
  expect(closed).toBe(1);
});

test("Add an option goes away at ten", () => {
  const host = mount();
  const add = () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Add an option"));
  for (let i = 0; i < MAX_POLL_OPTIONS - 2; i++) click(add() ?? null);
  expect(host.querySelectorAll("ol li")).toHaveLength(MAX_POLL_OPTIONS);
  expect(add()).toBeUndefined();
});
