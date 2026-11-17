import { DEFAULT_SPEECH_SETTINGS } from "@zetta/core/speech";
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type {
  Installation,
  TranscribeSettingsPatch,
  TranscribeTest,
} from "../onboarding/installation-api";
import { destinationOf, TranscribeForm } from "./transcribe-settings";

const win = setupDom();
afterEach(() => win.document.body.replaceChildren());

const base = (over: Partial<Installation> = {}): Installation => ({
  networkMode: "local",
  publicUrl: null,
  onboarding: "done",
  laya: "off",
  layaLanguages: ["en"],
  layaModel: "english",
  restartRequired: false,
  transcribeProvider: "local",
  transcribeModel: "",
  transcribeLanguage: "",
  transcribeBaseUrl: "",
  transcribeKey: "none",
  ...DEFAULT_SPEECH_SETTINGS,
  pushPublicKey: null,
  ...over,
});

async function mount(saved: Installation, admin = true) {
  win.document.body.replaceChildren();
  const el = win.document.createElement("div");
  win.document.body.append(el);
  const log = {
    saved: [] as TranscribeSettingsPatch[],
    keys: [] as string[],
    removed: 0,
    tests: 0,
  };
  let testResult: TranscribeTest = { ok: true };
  const root = createRoot(el as unknown as Element);
  await act(async () => {
    root.render(
      createElement(TranscribeForm, {
        saved,
        admin,
        onSave: async (p) => void log.saved.push(p),
        onSaveKey: async (s) => void log.keys.push(s),
        onRemoveKey: async () => void log.removed++,
        onTest: async () => (log.tests++, testResult),
      }),
    );
  });
  return { el, log, setTest: (r: TranscribeTest) => (testResult = r) };
}
const field = (el: Element, name: string) =>
  el.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | null;
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
}
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new win.Event("change", { bubbles: true }));
  });
}
const button = (el: Element, match: RegExp) =>
  [...el.querySelectorAll("button")].find((b) =>
    match.test(b.textContent?.trim() ?? ""),
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

describe("where recordings go is said next to the choice", () => {
  test("the server's own model, OpenAI, and a custom address each have their words", () => {
    expect(destinationOf("local", "")).toBeUndefined();
    expect(destinationOf("openai", "")).toBe("api.openai.com");
    expect(destinationOf("compatible", "https://api.groq.com/openai/v1")).toBe("api.groq.com");
    expect(destinationOf("compatible", "")).toBe("that address");
    expect(destinationOf("compatible", "not a url")).toBe("that address");
  });
});

describe("the speech-to-text settings of the installation", () => {
  test("local: it says recordings stay on the server, and shows no key, model or address", async () => {
    const { el } = await mount(base());
    expect(el.textContent).toContain("Recordings stay on this server");
    expect(field(el, "transcribeKey")).toBeNull();
    expect(field(el, "transcribeModel")).toBeNull();
    expect(field(el, "transcribeBaseUrl")).toBeNull();
    expect(button(el, /^Save$/).disabled).toBe(true);
  });

  test("choosing OpenAI says where recordings will go, and the save button names it", async () => {
    const { el, log } = await mount(base());
    await choose(field(el, "transcribeProvider") as HTMLSelectElement, "openai");
    expect(el.textContent).toContain("sent to api.openai.com");
    expect(button(el, /^Save: recordings go to api\.openai\.com$/).disabled).toBe(false);
    await type(field(el, "transcribeModel") as HTMLInputElement, " gpt-4o-mini-transcribe ");
    await type(field(el, "transcribeLanguage") as HTMLInputElement, "pt");
    await submit(el);
    expect(log.saved).toEqual([
      {
        transcribeProvider: "openai",
        transcribeModel: "gpt-4o-mini-transcribe",
        transcribeLanguage: "pt",
        transcribeBaseUrl: "",
      },
    ]);
  });

  test("a custom provider needs its address before it can be saved", async () => {
    const { el, log } = await mount(base());
    await choose(field(el, "transcribeProvider") as HTMLSelectElement, "compatible");
    expect(button(el, /^Save/).disabled).toBe(true);
    await type(
      field(el, "transcribeBaseUrl") as HTMLInputElement,
      "https://api.groq.com/openai/v1",
    );
    expect(el.textContent).toContain("sent to api.groq.com");
    await submit(el);
    expect(log.saved[0]).toMatchObject({
      transcribeProvider: "compatible",
      transcribeBaseUrl: "https://api.groq.com/openai/v1",
    });
  });

  test("the key is write-only: it is sent once, the field is emptied at once, and the page only says a key is saved", async () => {
    const { el, log } = await mount(base({ transcribeProvider: "openai", transcribeKey: "none" }));
    const input = field(el, "transcribeKey") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(button(el, /^Save key$/).disabled).toBe(true);
    await type(input, "sk-test-0123456789abcdef");
    await click(button(el, /^Save key$/));
    expect(log.keys).toEqual(["sk-test-0123456789abcdef"]);
    expect((field(el, "transcribeKey") as HTMLInputElement).value).toBe("");
    expect(el.textContent).not.toContain("sk-test");
    expect(el.textContent).toContain(
      "Key saved. It is stored encrypted and will not be shown again.",
    );
  });

  test("with a key saved it can be removed, and a key that cannot be read any more asks for a new one", async () => {
    const saved = await mount(base({ transcribeProvider: "openai", transcribeKey: "set" }));
    expect(saved.el.textContent).toContain("A key is saved. It is stored encrypted");
    await click(button(saved.el, /^Remove key$/));
    expect(saved.log.removed).toBe(1);
    const gone = await mount(base({ transcribeProvider: "openai", transcribeKey: "unavailable" }));
    expect(gone.el.textContent).toContain("cannot be read any more");
    expect(button(gone.el, /^Remove key$/)).toBeUndefined();
    const operator = await mount(base({ transcribeProvider: "openai", transcribeKey: "operator" }));
    expect(operator.el.textContent).toContain("the key the operator set on the server is used");
  });

  test("the test uses what is saved: it waits for a save, then shows the provider's sentence", async () => {
    const t = await mount(base({ transcribeProvider: "openai", transcribeKey: "set" }));
    await choose(field(t.el, "transcribeProvider") as HTMLSelectElement, "local");
    expect(button(t.el, /^Test$/).disabled).toBe(true);
    await choose(field(t.el, "transcribeProvider") as HTMLSelectElement, "openai");
    t.setTest({ ok: false, message: "The speech-to-text provider did not accept the API key." });
    await click(button(t.el, /^Test$/));
    expect(t.log.tests).toBe(1);
    // The library's fields keep empty live regions of their own: the message is the one that says something.
    const said = (role: string) =>
      [...t.el.querySelectorAll(`[role="${role}"]`)].map((n) => n.textContent).filter(Boolean);
    expect(said("alert")).toEqual(["The speech-to-text provider did not accept the API key."]);
    t.setTest({ ok: true });
    await click(button(t.el, /^Test$/));
    expect(said("status").join(" ")).toContain("It works");
  });

  test("a member only reads where recordings go and cannot change it", async () => {
    const { el } = await mount(base({ transcribeProvider: "openai" }), false);
    expect(el.textContent).toContain(
      "Recordings are turned into text by OpenAI (api.openai.com). Ask your administrator to change this.",
    );
    expect(el.querySelector("form")).toBeNull();
    expect(el.querySelector("button")).toBeNull();
  });
});
