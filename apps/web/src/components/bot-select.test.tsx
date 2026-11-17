import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();
// The library builds `new Event("change")` from the global, and happy-dom only takes its own Event class.
const realEvent = globalThis.Event;
globalThis.Event = win.Event as unknown as typeof Event;
afterAll(() => {
  globalThis.Event = realEvent;
});

const { BotSelect } = await import("./bot-select");

const bots = [
  { id: "00000000-0000-7000-8000-000000000001", name: "Ana", role: "Support lead" },
  {
    id: "00000000-0000-7000-8000-000000000002",
    name: "Ana",
    description: "Writes the weekly report\nsecond line",
    kind: "specialist" as const,
  },
  { id: "00000000-0000-7000-8000-000000000003", name: "Zetta", kind: "chief" as const },
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

const press = (el: unknown) =>
  act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      (el as Element).dispatchEvent(
        new win.MouseEvent(type, { bubbles: true, button: 0 }) as unknown as Event,
      );
  });
const combobox = (host: Element) => host.querySelector('[role="combobox"]') as HTMLInputElement;
const options = () => [...win.document.querySelectorAll('[role="option"]')];
const hidden = (host: Element, name: string) =>
  host.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement;

async function open(host: Element) {
  await press(combobox(host));
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
}

test("every option shows the bot and what it is for: the role, the description line, or the kind", async () => {
  const host = await mount(<BotSelect label="Bot" name="botId" bots={bots} />);
  await open(host);
  const text = options().map((o) => o.textContent);
  expect(text).toHaveLength(3);
  expect(text[0]).toContain("Support lead");
  expect(text[1]).toContain("Writes the weekly report");
  expect(text[1]).not.toContain("second line");
  expect(text[2]).toContain("Chief");
  // Two bots with the same name can be told apart.
  expect(text[0]).not.toBe(text[1]);
});

test("choosing an option reports the bot id and shows the name", async () => {
  const onChange = mock((_id: string) => {});
  const host = await mount(<BotSelect label="Bot" name="botId" bots={bots} onChange={onChange} />);
  await open(host);
  await press(options()[2]!);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0]![0]).toBe(bots[2]!.id);
  expect(combobox(host).value).toBe("Zetta");
});

test("in a form it writes the chosen id under its name, and an empty string before a choice", async () => {
  const host = await mount(
    <form aria-label="routine">
      <BotSelect label="Bot" name="botId" bots={bots} />
    </form>,
  );
  const form = host.querySelector("form")!;
  const read = () => new win.FormData(form as never).get("botId");
  expect(read()).toBe("");
  await open(host);
  await press(options()[0]!);
  expect(read()).toBe(bots[0]!.id);
});

test("a default value is chosen from the start, and a controlled value follows its owner", async () => {
  const host = await mount(
    <form aria-label="routine">
      <BotSelect label="Bot" name="botId" bots={bots} defaultValue={bots[1]!.id} />
    </form>,
  );
  expect(combobox(host).value).toBe("Ana");
  expect(hidden(host, "botId").value).toBe(bots[1]!.id);

  const controlled = await mount(
    <BotSelect label="Other" name="other" bots={bots} value={bots[2]!.id} />,
  );
  expect(combobox(controlled).value).toBe("Zetta");
  expect(hidden(controlled, "other").value).toBe(bots[2]!.id);
});

test("it can be required and disabled, and carries its label", async () => {
  const host = await mount(
    <BotSelect
      label="Which bot"
      name="botId"
      bots={bots}
      required
      disabled
      placeholder="Pick one"
    />,
  );
  const input = combobox(host);
  expect(input.required).toBe(true);
  expect(input.disabled).toBe(true);
  expect(input.getAttribute("placeholder")).toBe("Pick one");
  expect(host.textContent).toContain("Which bot");
});

test("clearing the choice empties the form value", async () => {
  const onChange = mock((_id: string) => {});
  const host = await mount(
    <form aria-label="routine">
      <BotSelect
        label="Bot"
        name="botId"
        bots={bots}
        defaultValue={bots[0]!.id}
        onChange={onChange}
      />
    </form>,
  );
  const clear = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label"));
  expect(clear).toBeDefined();
  await press(clear);
  expect(hidden(host, "botId").value).toBe("");
  expect(onChange).toHaveBeenCalled();
  expect(onChange.mock.calls.at(-1)![0]).toBe("");
  expect(combobox(host).value).toBe("");
});
