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
const { ListenButton } = await import("./listen-button");
const { listenDeps, stopListening, getListenState, toggleListen, getBotVoice, setBotVoice } =
  await import("./speech-player");
const { queryClient } = await import("@/lib/query-client");

type Call = { url: string; body: { text: string; voice?: string; botId?: string } };
let calls: Call[] = [];
let answer: () => Response = () => audio();
const audio = () => new Response(new Uint8Array(44), { headers: { "content-type": "audio/wav" } });
let played: { url: string; paused: boolean; end?: () => void }[] = [];
let spoken: { text: string; voice?: unknown }[] = [];
let cancelled = 0;

beforeEach(() => {
  calls = [];
  played = [];
  spoken = [];
  cancelled = 0;
  answer = audio;
  stopListening();
  listenDeps.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return answer();
  };
  listenDeps.createUrl = () => "blob:fake";
  listenDeps.revokeUrl = () => {};
  listenDeps.createAudio = (url) => {
    const rec = { url, paused: false } as (typeof played)[number];
    played.push(rec);
    const a = {
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      play: async () => void (rec.end = () => a.onended?.()),
      pause: () => void (rec.paused = true),
    };
    return a as never;
  };
  listenDeps.synth = () => ({
    speak: (u: unknown) =>
      void spoken.push({
        text: (u as { text: string }).text,
        voice: (u as { voice?: unknown }).voice,
      }),
    cancel: () => void cancelled++,
    getVoices: () => [{ name: "Luciana", lang: "pt-BR" }],
  });
  listenDeps.utterance = (text) => ({ text }) as never;
});
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.replaceChildren();
});

const setProvider = (provider: string | undefined) =>
  queryClient.setQueryData(
    ["installation"],
    provider === undefined ? undefined : { ...DEFAULT_SPEECH_SETTINGS, speechProvider: provider },
  );
async function mount(props: { id?: string; text?: string; botId?: string } = {}) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ListenButton, { id: "m1", text: "Hello there.", ...props }),
      ),
    ),
  );
  return host as unknown as HTMLElement;
}
const btn = (el: HTMLElement) => el.querySelector("button") as HTMLButtonElement | null;
const press = async (b: HTMLButtonElement) => {
  await act(async () => {
    b.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
  });
};

describe("the Listen button of a bot message", () => {
  test("it is not there when text to speech is off, or while the setting is not known", async () => {
    setProvider("off");
    expect(btn(await mount())).toBeNull();
    setProvider(undefined);
    expect(btn(await mount())).toBeNull();
  });

  test("it has a name and no visible text, and it is not there for empty text", async () => {
    setProvider("openai");
    const b = btn(await mount())!;
    expect(b.getAttribute("aria-label")).toBe("Listen");
    expect(b.getAttribute("title")).toBeNull();
    expect(btn(await mount({ text: "  " }))).toBeNull();
  });

  test("a provider answers audio: it plays, pressing again stops it, and the end returns it to Listen", async () => {
    setProvider("openai");
    const el = await mount({ botId: "b1" });
    await press(btn(el)!);
    expect(calls).toEqual([
      { url: expect.stringContaining("/api/speech"), body: { text: "Hello there.", botId: "b1" } },
    ]);
    expect(played).toHaveLength(1);
    expect(btn(el)!.getAttribute("aria-label")).toBe("Stop listening");
    await press(btn(el)!);
    expect(played[0]!.paused).toBe(true);
    expect(getListenState().phase).toBe("idle");
    expect(btn(el)!.getAttribute("aria-label")).toBe("Listen");
    await press(btn(el)!);
    await act(async () => played[1]!.end!());
    expect(getListenState().phase).toBe("idle");
  });

  test("the voice chosen for the bot on this device is sent", async () => {
    setProvider("openai");
    setBotVoice("b1", "nova");
    expect(getBotVoice("b1")).toBe("nova");
    await press(btn(await mount({ botId: "b1" }))!);
    expect(calls[0]!.body).toEqual({ text: "Hello there.", voice: "nova" });
    setBotVoice("b1", "");
    expect(getBotVoice("b1")).toBe("");
  });

  test("without a device voice the request names the bot, so the server uses the voice saved on it", async () => {
    setProvider("openai");
    await press(btn(await mount({ botId: "0192f000-0000-7000-8000-000000000009" }))!);
    expect(calls[0]!.body).toEqual({
      text: "Hello there.",
      botId: "0192f000-0000-7000-8000-000000000009",
    });
  });

  test("with the browser's voice the server sends text and the device speaks it", async () => {
    setProvider("browser");
    answer = () => Response.json({ mode: "browser", text: "Hello there.", truncated: false });
    setBotVoice("b2", "Luciana");
    await press(btn(await mount({ botId: "b2" }))!);
    expect(spoken).toEqual([{ text: "Hello there.", voice: { name: "Luciana", lang: "pt-BR" } }]);
    expect(played).toHaveLength(0);
    await act(async () => stopListening());
    expect(cancelled).toBe(1);
    setBotVoice("b2", "");
  });

  test("one message at a time: starting another stops the first", async () => {
    setProvider("openai");
    await act(async () => toggleListen("a", "One."));
    await act(async () => toggleListen("b", "Two."));
    expect(played[0]!.paused).toBe(true);
    expect(getListenState()).toEqual({ id: "b", phase: "playing" });
  });

  test("an error says why, in the button's name, and the button can be pressed again", async () => {
    setProvider("openai");
    answer = () =>
      Response.json(
        {
          error: {
            code: "SPEECH_PROVIDER_AUTH",
            message: "The text-to-speech provider did not accept the API key.",
          },
        },
        { status: 502 },
      );
    const el = await mount();
    await press(btn(el)!);
    expect(btn(el)!.getAttribute("aria-label")).toBe(
      "The text-to-speech provider did not accept the API key.",
    );
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("did not accept");
    answer = audio;
    await press(btn(el)!);
    expect(played).toHaveLength(1);
  });
});
