import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_SPEECH_SETTINGS } from "@zetta/core/speech";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});
const { BotVoiceSection } = await import("./bot-voice-section");
const { queryClient } = await import("@/lib/query-client");

const bot = {
  id: "0192f000-0000-7000-8000-000000000001",
  name: "Ana",
  version: 3,
  canEdit: true,
  voice: null,
  voiceLanguage: null,
} as never;
type Sent = { url: string; method?: string; body?: { expectedVersion: number; patch: unknown } };
let sent: Sent[] = [];
const realFetch = globalThis.fetch;
const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
  sent = [];
  store.clear();
  globalThis.fetch = (async (url: URL, init: RequestInit) => {
    sent.push({
      url: String(url),
      method: init.method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json({ bot: { id: "b", version: 4, voice: "nova", voiceLanguage: "pt-BR" } });
  }) as never;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.replaceChildren();
});

const provider = (p: string, speechVoice = "") =>
  queryClient.setQueryData(["installation"], {
    ...DEFAULT_SPEECH_SETTINGS,
    speechProvider: p,
    speechVoice,
  });
async function mount(onBotChange?: (b: unknown) => void, own = bot) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(BotVoiceSection, { bot: own, onBotChange: onBotChange as never }),
      ),
    ),
  );
  return host as unknown as HTMLElement;
}
const type = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
};

describe("the voice of a bot", () => {
  test("with a provider it is saved on the bot, on the server, with the version it was read at", async () => {
    provider("openai", "alloy");
    const changed: unknown[] = [];
    const host = await mount((b) => changed.push(b));
    const [voice, language] = [...host.querySelectorAll("input")] as HTMLInputElement[];
    expect(voice!.getAttribute("placeholder")).toContain("alloy");
    const save = host.querySelector("button[type=submit]") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await type(voice!, "nova");
    await type(language!, "pt-BR");
    expect(save.disabled).toBe(false);
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: expect.stringContaining("/api/bots/0192f000-0000-7000-8000-000000000001"),
      method: "PATCH",
      body: { expectedVersion: 3, patch: { voice: "nova", voiceLanguage: "pt-BR" } },
    });
    expect(changed).toHaveLength(1);
    expect(host.textContent).toContain("Voice saved.");
  });

  test("a voice this device kept before is offered again, and leaves the device once it is saved", async () => {
    provider("compatible");
    store.set(`zetta:bot-voice:${(bot as { id: string }).id}`, "shimmer");
    const host = await mount();
    const [voice] = [...host.querySelectorAll("input")] as HTMLInputElement[];
    expect(voice!.value).toBe("shimmer");
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(sent[0]!.body!.patch).toEqual({ voice: "shimmer", voiceLanguage: null });
    expect(store.has(`zetta:bot-voice:${(bot as { id: string }).id}`)).toBe(false);
  });

  test("with the browser's voice the choice stays on this device and nothing is sent", async () => {
    provider("browser");
    const host = await mount();
    // A filterable Autocomplete, not a native select.
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector("input")).not.toBeNull();
    expect(host.querySelector("button[type=submit]")).toBeNull();
    expect(host.textContent).toContain("kept on this device");
    expect(sent).toHaveLength(0);
  });

  test("with speech off it says so, and a bot you may not edit has a read-only voice", async () => {
    provider("off");
    expect((await mount()).textContent).toContain("Text to speech is off");
    provider("openai");
    const host = await mount(undefined, { ...(bot as object), canEdit: false } as never);
    expect(
      ([...host.querySelectorAll("input")] as HTMLInputElement[]).every((i) => i.disabled),
    ).toBe(true);
  });
});

describe("Listen voice", () => {
  const { listenDeps, stopListening } =
    require("./speech-player") as typeof import("./speech-player");
  const realDeps = { ...listenDeps };
  const played: string[] = [];
  const spoken: { text: string; voice?: unknown }[] = [];
  /** The speech route: audio from a provider, or the text for the device's own voice. */
  const speechAnswers = (kind: "audio" | "browser") => {
    const before = globalThis.fetch;
    globalThis.fetch = (async (url: URL, init: RequestInit) => {
      if (!String(url).endsWith("/api/speech")) return before(url, init);
      sent.push({ url: String(url), method: init.method, body: JSON.parse(String(init.body)) });
      return kind === "audio"
        ? new Response(new Blob(["RIFF"], { type: "audio/wav" }), {
            headers: { "content-type": "audio/wav" },
          })
        : Response.json({ mode: "browser", text: JSON.parse(String(init.body)).text });
    }) as never;
  };
  beforeEach(() => {
    played.length = 0;
    spoken.length = 0;
    Object.assign(listenDeps, {
      createUrl: () => "blob:sample",
      revokeUrl: () => {},
      createAudio: () => ({
        onended: null,
        onerror: null,
        pause() {},
        play: async () => void played.push("played"),
      }),
      synth: () => ({
        speak: (u: { text: string; voice?: unknown }) => void spoken.push(u),
        cancel() {},
        getVoices: () => [
          { name: "Luciana", lang: "pt-BR" },
          { name: "Grandma (Portuguese (Brazil))", lang: "pt-BR" },
        ],
      }),
      utterance: (text: string) => ({ text }),
    });
  });
  afterEach(() => {
    stopListening();
    Object.assign(listenDeps, realDeps);
  });
  const listen = (host: HTMLElement) =>
    [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Listen voice"),
    ) as HTMLButtonElement;
  const press = async (b: HTMLButtonElement) =>
    act(async () => {
      b.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });

  test("a provider voice is heard as it is chosen on the page, before it is saved", async () => {
    provider("openai", "alloy");
    const host = await mount();
    speechAnswers("audio");
    const [voice, language] = [...host.querySelectorAll("input")] as HTMLInputElement[];
    await type(voice!, "nova");
    await type(language!, "pt-BR");
    await press(listen(host));
    const speech = sent.filter((s) => s.url.endsWith("/api/speech"));
    expect(speech).toHaveLength(1);
    expect(speech[0]!.body).toMatchObject({ voice: "nova", language: "pt-BR" });
    expect((speech[0]!.body as unknown as { text: string }).text).toContain("Olá, eu sou Ana");
    expect(played).toEqual(["played"]);
    // Nothing was saved by listening.
    expect(sent.some((s) => s.method === "PATCH")).toBe(false);
    expect(listen(host)).toBeUndefined();
    expect(host.textContent).toContain("Stop");
  });

  test("with no voice typed, the installation's voice is used (no bot, no voice in the request)", async () => {
    provider("openai", "alloy");
    const host = await mount();
    speechAnswers("audio");
    await press(listen(host));
    const body = sent.find((s) => s.url.endsWith("/api/speech"))!.body as unknown as Record<
      string,
      unknown
    >;
    expect(body.voice).toBeUndefined();
    expect(body.botId).toBeUndefined();
    expect(body.text).toContain("Hello, I'm Ana");
  });

  test("a provider that refuses is said in words next to the button", async () => {
    provider("openai", "alloy");
    const host = await mount();
    const before = globalThis.fetch;
    globalThis.fetch = (async (url: URL, init: RequestInit) =>
      String(url).endsWith("/api/speech")
        ? Response.json(
            { error: { code: "SPEECH_KEY", message: "The speech key was refused." } },
            { status: 502 },
          )
        : before(url, init)) as never;
    await press(listen(host));
    expect(host.textContent).toContain("The speech key was refused.");
    expect(listen(host)).toBeDefined();
  });

  test("with the browser's voices the chosen device voice speaks, in its own language", async () => {
    provider("browser");
    const host = await mount();
    speechAnswers("browser");
    await press(listen(host));
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.text.length).toBeGreaterThan(5);
  });

  test("a device voice with spaces and parentheses is spoken locally and never sent to the server", async () => {
    store.set(`zetta:bot-voice:${(bot as { id: string }).id}`, "Grandma (Portuguese (Brazil))");
    provider("browser");
    const host = await mount();
    speechAnswers("browser");
    await press(listen(host));
    const speech = sent.filter((s) => s.url.endsWith("/api/speech"));
    expect(speech).toHaveLength(1);
    expect(speech[0]!.body).not.toHaveProperty("voice");
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.voice).toMatchObject({ name: "Grandma (Portuguese (Brazil))" });
  });
});
