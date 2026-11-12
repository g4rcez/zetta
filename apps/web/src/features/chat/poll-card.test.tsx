import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type { PollView, PollVotes } from "./chat-client";

const win = setupDom();
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
const { BotsContext } = await import("@/components/bot-identity");
const { PollCard } = await import("./poll-card");

const poll = (over: Partial<PollView> = {}): PollView => ({
  question: "Lunch?",
  mode: "single",
  status: "open",
  options: [
    { id: "a", label: "Pizza" },
    { id: "b", label: "Sushi" },
  ],
  ...over,
});

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  await new Promise((done) => setTimeout(done, 20));
});

function mount(props: Partial<Parameters<typeof PollCard>[0]> & { votes?: PollVotes }) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  act(() =>
    root.render(
      <BotsContext.Provider value={new Map([["bot1", { id: "bot1", name: "Dev" }]])}>
        <PollCard poll={poll()} votes={{}} {...props} />
      </BotsContext.Provider>,
    ),
  );
  return host as unknown as HTMLElement;
}
const click = (el: Element | null) => act(() => (el as unknown as HTMLElement).click());
const option = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("li button")].find((b) => b.textContent?.includes(label)) ?? null;

test("shows the question, the options and how many voted", () => {
  const host = mount({
    votes: { a: { count: 3, mine: false, botIds: [] }, b: { count: 1, mine: false, botIds: [] } },
  });
  expect(host.textContent).toContain("Lunch?");
  expect(host.textContent).toContain("One choice");
  expect(host.textContent).toContain("4 votes");
  expect(option(host, "Pizza")!.textContent).toContain("3 · 75%");
  expect(option(host, "Sushi")!.textContent).toContain("1 · 25%");
});

test("a click votes for the option; a click on the one you picked takes the vote back", () => {
  const picked: string[][] = [];
  const host = mount({
    onVote: (o) => picked.push(o),
    votes: { b: { count: 1, mine: true, botIds: [] } },
  });
  click(option(host, "Pizza"));
  click(option(host, "Sushi"));
  expect(picked).toEqual([["a"], []]);
  expect(option(host, "Sushi")!.getAttribute("aria-pressed")).toBe("true");
  expect(option(host, "Pizza")!.getAttribute("aria-pressed")).toBe("false");
});

test("a several-choice poll adds to what you picked", () => {
  const picked: string[][] = [];
  const host = mount({
    poll: poll({ mode: "multiple" }),
    onVote: (o) => picked.push(o),
    votes: { a: { count: 1, mine: true, botIds: [] } },
  });
  expect(host.textContent).toContain("Several choices");
  click(option(host, "Sushi"));
  expect(picked).toEqual([["a", "b"]]);
});

test("a closed poll keeps its results and takes no clicks", () => {
  const picked: string[][] = [];
  const host = mount({ poll: poll({ status: "closed" }), onVote: (o) => picked.push(o) });
  expect(host.textContent).toContain("Closed");
  expect(option(host, "Pizza")!.hasAttribute("disabled")).toBe(true);
  click(option(host, "Pizza"));
  expect(picked).toEqual([]);
  expect(host.textContent).not.toContain("Close the poll");
});

test("a page that cannot vote shows the results only", () => {
  const host = mount({});
  expect(option(host, "Pizza")!.hasAttribute("disabled")).toBe(true);
});

test("Close the poll is only offered to whoever may close it, while it is open", () => {
  let closed = 0;
  expect(mount({}).textContent).not.toContain("Close the poll");
  const host = mount({ onClose: () => closed++ });
  click(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Close the poll") ?? null,
  );
  expect(closed).toBe(1);
});

test("the bots that voted show their names to a screen reader", () => {
  const host = mount({ votes: { a: { count: 1, mine: false, botIds: ["bot1"] } } });
  expect(option(host, "Pizza")!.textContent).toContain("Voted: Dev");
});
