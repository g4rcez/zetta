import { DEFAULT_SPEECH_SETTINGS } from "@zetta/core/speech";
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type { Installation, SpeechSettingsPatch, SpeechTest } from "../onboarding/installation-api";

const win = setupDom();
const { SpeechForm, speechDestinationOf } = await import("./speech-settings");
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
  speechKey: "none",
  pushPublicKey: null,
  ...over,
});

async function mount(saved: Installation, admin = true) {
  win.document.body.replaceChildren();
  const el = win.document.createElement("div");
  win.document.body.append(el);
  const log = { saved: [] as SpeechSettingsPatch[], keys: [] as string[], removed: 0, tests: 0 };
  let testResult: SpeechTest = { ok: true };
  const root = createRoot(el as unknown as Element);
  await act(async () => {
    root.render(
      createElement(SpeechForm, {
        saved,
        admin,
        onSave: async (p) => void log.saved.push(p),
        onSaveKey: async (s) => void log.keys.push(s),
        onRemoveKey: async () => void log.removed++,
        onTest: async () => (log.tests++, testResult),
      }),
    );
  });
  return { el, log, setTest: (r: SpeechTest) => (testResult = r) };
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
const said = (el: Element, role: string) =>
  [...el.querySelectorAll(`[role="${role}"]`)].map((n) => n.textContent).filter(Boolean);

describe("where the text goes is said next to the choice", () => {
  test("the browser, the providers and a custom address each have their words", () => {
    expect(speechDestinationOf("browser", "")).toBeUndefined();
    expect(speechDestinationOf("off", "")).toBeUndefined();
    expect(speechDestinationOf("openai", "")).toBe("api.openai.com");
    expect(speechDestinationOf("elevenlabs", "")).toBe("api.elevenlabs.io");
    expect(speechDestinationOf("compatible", "https://tts.example.com/v1")).toBe("tts.example.com");
    expect(speechDestinationOf("compatible", "")).toBe("that address");
  });
});

describe("the text-to-speech settings of the installation", () => {
  test("the browser: the text stays on the page, and there is no key, model or address", async () => {
    const { el } = await mount(base());
    expect(el.textContent).toContain("The text stays on the page");
    expect(field(el, "speechKey")).toBeNull();
    expect(field(el, "speechModel")).toBeNull();
    expect(field(el, "speechBaseUrl")).toBeNull();
    expect(button(el, /^Save$/).disabled).toBe(true);
  });

  test("the local voice: nothing leaves the machine, one download, no key or address, and a voice and a model can be chosen", async () => {
    const { el, log } = await mount(base());
    await choose(field(el, "speechProvider") as HTMLSelectElement, "local");
    expect(speechDestinationOf("local", "")).toBeUndefined();
    expect(el.textContent).toContain("nothing leaves the machine");
    expect(el.textContent).toContain("about 100 MB");
    expect(field(el, "speechKey")).toBeNull();
    expect(field(el, "speechBaseUrl")).toBeNull();
    // The model of the local voice is a stored value now (it used to be an environment variable): empty means the built-in one.
    expect((field(el, "speechModel") as HTMLInputElement).placeholder).toContain("Kokoro");
    expect(button(el, /^Save$/).disabled).toBe(false);
    await type(field(el, "speechVoice") as HTMLInputElement, " pm_alex ");
    await type(field(el, "speechModel") as HTMLInputElement, " owner/kokoro-other ");
    await submit(el);
    expect(log.saved).toEqual([
      {
        speechProvider: "local",
        speechModel: "owner/kokoro-other",
        speechVoice: "pm_alex",
        speechLanguage: "",
        speechBaseUrl: "",
      },
    ]);
  });

  test("choosing ElevenLabs says where the text goes and the save button names it", async () => {
    const { el, log } = await mount(base());
    await choose(field(el, "speechProvider") as HTMLSelectElement, "elevenlabs");
    expect(el.textContent).toContain("sent to api.elevenlabs.io");
    expect(button(el, /^Save: text goes to api\.elevenlabs\.io$/).disabled).toBe(false);
    await type(field(el, "speechVoice") as HTMLInputElement, " VOICE123 ");
    await type(field(el, "speechLanguage") as HTMLInputElement, "pt");
    await submit(el);
    expect(log.saved).toEqual([
      {
        speechProvider: "elevenlabs",
        speechModel: "",
        speechVoice: "VOICE123",
        speechLanguage: "pt",
        speechBaseUrl: "",
      },
    ]);
  });

  test("a custom provider needs its address before it can be saved", async () => {
    const { el, log } = await mount(base());
    await choose(field(el, "speechProvider") as HTMLSelectElement, "compatible");
    expect(button(el, /^Save/).disabled).toBe(true);
    await type(field(el, "speechBaseUrl") as HTMLInputElement, "https://tts.example.com/v1");
    expect(el.textContent).toContain("sent to tts.example.com");
    await submit(el);
    expect(log.saved[0]).toMatchObject({
      speechProvider: "compatible",
      speechBaseUrl: "https://tts.example.com/v1",
    });
  });

  test("off says nothing is read aloud and offers no key", async () => {
    const { el, log } = await mount(base());
    await choose(field(el, "speechProvider") as HTMLSelectElement, "off");
    expect(el.textContent).toContain("the Listen button is hidden");
    expect(field(el, "speechKey")).toBeNull();
    expect(field(el, "speechLanguage")).toBeNull();
    await submit(el);
    expect(log.saved[0]).toMatchObject({ speechProvider: "off" });
  });

  test("the key is write-only: sent once, the field is emptied at once, only 'a key is saved' is shown", async () => {
    const { el, log } = await mount(base({ speechProvider: "openai" }));
    const input = field(el, "speechKey") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(button(el, /^Save key$/).disabled).toBe(true);
    await type(input, "sk-test-0123456789abcdef");
    await click(button(el, /^Save key$/));
    expect(log.keys).toEqual(["sk-test-0123456789abcdef"]);
    expect((field(el, "speechKey") as HTMLInputElement).value).toBe("");
    expect(el.textContent).not.toContain("sk-test");
    expect(el.textContent).toContain(
      "Key saved. It is stored encrypted and will not be shown again.",
    );
  });

  test("a saved key can be removed; one that cannot be read asks for a new one; no operator key is ever offered", async () => {
    const saved = await mount(base({ speechProvider: "openai", speechKey: "set" }));
    await click(button(saved.el, /^Remove key$/));
    expect(saved.log.removed).toBe(1);
    const gone = await mount(base({ speechProvider: "openai", speechKey: "unavailable" }));
    expect(gone.el.textContent).toContain("cannot be read any more");
    expect(button(gone.el, /^Remove key$/)).toBeUndefined();
    const none = await mount(base({ speechProvider: "openai", speechKey: "none" }));
    expect(none.el.textContent).toContain("No key saved.");
    expect(none.el.textContent).not.toContain("operator");
  });

  test("the test uses what is saved and shows the server's sentence", async () => {
    const t = await mount(base({ speechProvider: "openai", speechKey: "set" }));
    await choose(field(t.el, "speechProvider") as HTMLSelectElement, "browser");
    expect(button(t.el, /^Test$/).disabled).toBe(true);
    await choose(field(t.el, "speechProvider") as HTMLSelectElement, "openai");
    t.setTest({ ok: false, message: "The text-to-speech provider did not accept the API key." });
    await click(button(t.el, /^Test$/));
    expect(t.log.tests).toBe(1);
    expect(said(t.el, "alert")).toEqual([
      "The text-to-speech provider did not accept the API key.",
    ]);
    t.setTest({ ok: true });
    await click(button(t.el, /^Test$/));
    expect(said(t.el, "status").join(" ")).toContain("It works");
  });

  test("a member only reads who reads messages aloud and cannot change it", async () => {
    const { el } = await mount(base({ speechProvider: "openai" }), false);
    expect(el.textContent).toContain(
      "Messages are read aloud by OpenAI (api.openai.com). Ask your administrator to change this.",
    );
    expect(el.querySelector("form")).toBeNull();
    expect(el.querySelector("button")).toBeNull();
  });
});
