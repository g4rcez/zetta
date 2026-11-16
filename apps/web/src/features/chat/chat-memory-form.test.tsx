import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { MemoryPatch } from "@zetta/core/chat-memory";

import { setupDom } from "../skills/dom-env";
import type { Bot } from "./chat-client";
import { ChatMemoryForm } from "./chat-memory-form";

const win = setupDom();
afterEach(() => win.document.body.replaceChildren());

const bot = (over: Partial<Bot> = {}) =>
  ({
    id: "00000000-0000-7000-8000-0000000000a1",
    name: "Q",
    version: 2,
    contextBytes: null,
    summaryMode: "chief",
    summaryMaxChars: null,
    summaryGapBytes: null,
    chatSearchLimit: null,
    ...over,
  }) as Bot;

async function mount(b: Bot, saving = false) {
  win.document.body.replaceChildren();
  const el = win.document.createElement("div");
  win.document.body.append(el);
  const saved: MemoryPatch[] = [];
  const root = createRoot(el as unknown as Element);
  await act(async () => {
    root.render(
      createElement(ChatMemoryForm, { bot: b, saving, onSave: (p) => void saved.push(p) }),
    );
  });
  return { el, saved };
}
const field = (el: Element, name: string) =>
  el.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement;
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
}
const button = (el: Element, text: string) =>
  [...el.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement;
async function click(b: HTMLButtonElement) {
  await act(async () => {
    b.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  });
}
async function submit(el: Element) {
  await act(async () => {
    el.querySelector("form")!.dispatchEvent(
      new win.Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("the chat memory form", () => {
  test("it shows what the bot has now, with defaults as placeholders, and nothing to save yet", async () => {
    const { el } = await mount(
      bot({ contextBytes: 40_000, summaryMode: "bot", chatSearchLimit: 3 }),
    );
    expect((field(el, "contextBytes") as HTMLInputElement).value).toBe("40000");
    expect((field(el, "summaryMode") as HTMLSelectElement).value).toBe("bot");
    expect((field(el, "chatSearchLimit") as HTMLInputElement).value).toBe("3");
    expect((field(el, "summaryMaxChars") as HTMLInputElement).placeholder).toContain(
      "2,000 (default)",
    );
    expect(button(el, "Save chat memory").disabled).toBe(true);
    expect(el.textContent).toContain("About 10,000 tokens");
  });

  test("a preset fills the size, and any number in range can be typed instead", async () => {
    const { el, saved } = await mount(bot());
    expect(button(el, "Default").getAttribute("aria-pressed")).toBe("true");
    await click(button(el, "Long"));
    expect((field(el, "contextBytes") as HTMLInputElement).value).toBe("40000");
    // Only the preset that matches the number is pressed.
    expect(button(el, "Long").getAttribute("aria-pressed")).toBe("true");
    expect(button(el, "Default").getAttribute("aria-pressed")).toBe("false");
    expect(button(el, "Short").getAttribute("aria-pressed")).toBe("false");
    await type(field(el, "contextBytes") as HTMLInputElement, "33,333");
    await type(field(el, "summaryMaxChars") as HTMLInputElement, "4000");
    await type(field(el, "summaryGapBytes") as HTMLInputElement, "9000");
    await type(field(el, "chatSearchLimit") as HTMLInputElement, "4");
    await act(async () => {
      const s = field(el, "summaryMode") as HTMLSelectElement;
      s.value = "off";
      s.dispatchEvent(new win.Event("change", { bubbles: true }));
    });
    await submit(el);
    expect(saved).toEqual([
      {
        contextBytes: 33_333,
        summaryMaxChars: 4_000,
        summaryGapBytes: 9_000,
        chatSearchLimit: 4,
        summaryMode: "off",
      },
    ]);
  });

  test("a value out of range is explained before anything is sent, and Save stays off", async () => {
    const { el, saved } = await mount(bot());
    await type(field(el, "contextBytes") as HTMLInputElement, "70000");
    await type(field(el, "chatSearchLimit") as HTMLInputElement, "11");
    expect(el.textContent).toContain(
      "How much of the chat it reads back must be between 4,000 and 60,000.",
    );
    expect(el.textContent).toContain("Search results must be between 1 and 10.");
    expect(button(el, "Save chat memory").disabled).toBe(true);
    await submit(el);
    expect(saved).toEqual([]);
  });

  test("an empty field goes back to the default, and 'Use the defaults' clears every field", async () => {
    const { el, saved } = await mount(
      bot({ contextBytes: 40_000, summaryMaxChars: 3_000, summaryMode: "off" }),
    );
    await click(button(el, "Use the defaults"));
    expect((field(el, "contextBytes") as HTMLInputElement).value).toBe("");
    expect((field(el, "summaryMode") as HTMLSelectElement).value).toBe("chief");
    await submit(el);
    expect(saved).toEqual([
      {
        contextBytes: null,
        summaryMaxChars: null,
        summaryGapBytes: null,
        chatSearchLimit: null,
        summaryMode: "chief",
      },
    ]);
  });

  test("with the summary off its two fields are disabled and the page says what that means", async () => {
    const { el } = await mount(bot({ summaryMode: "off" }));
    expect((field(el, "summaryMaxChars") as HTMLInputElement).disabled).toBe(true);
    expect((field(el, "summaryGapBytes") as HTMLInputElement).disabled).toBe(true);
    expect(el.textContent).toContain(
      "With no summary the bot only knows the newest part of the chat",
    );
  });
});
