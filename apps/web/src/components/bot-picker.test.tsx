import { afterEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";
import type { Bot } from "../features/chat/chat-client";

const win = setupDom();
const { BotPicker } = await import("./bot-picker");

const bot = (over: Partial<Bot>): Bot =>
  ({
    id: "00000000-0000-7000-8000-000000000001",
    kind: "specialist",
    name: "Ana",
    description: "",
    ...over,
  }) as Bot;
const bots = [
  bot({ role: "Support lead" }),
  bot({ id: "00000000-0000-7000-8000-000000000002", description: "Writes the weekly report" }),
  bot({ id: "00000000-0000-7000-8000-000000000003", name: "Zetta", kind: "chief" }),
];

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.replaceChildren();
});

async function mount(node: React.ReactNode) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () => root.render(node));
  return host as unknown as Element;
}

test("each bot is listed with its role line under the name", async () => {
  const host = await mount(<BotPicker bots={bots} selected={[]} onChange={() => {}} />);
  const rows = [...host.querySelectorAll("li")].map((li) => li.textContent);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toContain("Support lead");
  expect(rows[1]).toContain("Writes the weekly report");
  expect(rows[2]).toContain("Chief");
});

test("ticking a bot adds its id, unticking removes it", async () => {
  const onChange = mock((_ids: string[]) => {});
  const host = await mount(<BotPicker bots={bots} selected={[bots[1]!.id]} onChange={onChange} />);
  const boxes = [
    ...host.querySelectorAll('input[type="checkbox"]'),
  ] as unknown as HTMLInputElement[];
  expect(boxes.map((b) => b.checked)).toEqual([false, true, false]);
  await act(async () => void boxes[0]!.click());
  expect(onChange.mock.calls.at(-1)![0]).toEqual([bots[1]!.id, bots[0]!.id]);
  await act(async () => void boxes[1]!.click());
  expect(onChange.mock.calls.at(-1)![0]).toEqual([]);
});

test("with no bots it says so", async () => {
  const host = await mount(<BotPicker bots={[]} selected={[]} onChange={() => {}} />);
  expect(host.textContent).toContain("You have no bots");
});
