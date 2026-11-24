import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

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
const { useVoiceCall } = await import("./use-voice-call");
const { VoiceButton, VoicePanel } = await import("./voice-panel");
const { MIC_CONSTRAINTS } = await import("./voice-call");
const { Composer } = await import("../chat/composer");

// ---- fakes: a socket, a microphone, the audio session and the device's voice -----------------------------------------------------------
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = "blob";
  sent: (string | Uint8Array)[] = [];
  closed: number[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly ticket: string) {
    FakeSocket.all.push(this);
  }
  send(d: string | Uint8Array) {
    this.sent.push(d);
  }
  close(code = 1000) {
    this.closed.push(code);
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  say(m: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  audio(bytes: ArrayBuffer) {
    this.onmessage?.({ data: bytes });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  get texts() {
    return this.sent.filter((s): s is string => typeof s === "string").map((s) => JSON.parse(s));
  }
}
const sock = () => FakeSocket.all.at(-1)!;

type AudioRec = {
  handlers: { onFrame(b: Uint8Array): void; onLevel(n: number): void; onPlayed(n: number): void };
  pushed: number[];
  cleared: number;
  resets: number;
  closed: number;
};
let audio: AudioRec | undefined;
let stops = 0;
let micError: { name: string } | undefined;
let constraints: unknown;
let tickets: string[] = [];
let ticketError: Error | undefined;
let spoken: { text: string; lang?: string; voice?: unknown }[] = [];
let cancelled = 0;
let voice: "on" | "off" = "on";
let ticketDelay = 0;

const deps = {
  ticket: async (id: string) => {
    tickets.push(id);
    if (ticketDelay) await new Promise((r) => setTimeout(r, ticketDelay));
    if (ticketError) throw ticketError;
    return { ticket: `t-${tickets.length}` };
  },
  socket: (t: string) => new FakeSocket(t) as unknown as WebSocket,
  getUserMedia: async (c: MediaStreamConstraints) => {
    constraints = c;
    if (micError) throw micError;
    return { getTracks: () => [{ stop: () => void stops++ }] } as unknown as MediaStream;
  },
  openAudio: async (_s: MediaStream, handlers: AudioRec["handlers"]) => {
    const rec: AudioRec = { handlers, pushed: [], cleared: 0, resets: 0, closed: 0 };
    audio = rec;
    return {
      push: (b: ArrayBuffer) => void rec.pushed.push(b.byteLength),
      clear: () => void rec.cleared++,
      resetPlayed: () => void rec.resets++,
      close: () => void rec.closed++,
    };
  },
  synth: () => ({
    speak: (u: unknown) => void spoken.push(u as never),
    cancel: () => void cancelled++,
    getVoices: () => [{ name: "Luciana", lang: "pt-BR" }],
  }),
  utterance: (text: string) => ({ text }) as never,
  language: () => "en-US",
};

Object.defineProperty(win.navigator, "mediaDevices", {
  value: { getUserMedia: async () => undefined },
  configurable: true,
});

function Probe({ id, kind, name }: { id?: string; kind?: string; name?: string }) {
  const v = useVoiceCall({ conversationId: id, kind, botId: "bot1", deps });
  const idle = v.view.phase === "idle" || v.view.phase === "ended";
  return createElement(
    "div",
    null,
    v.availability === "on" && v.call
      ? createElement(VoiceButton, {
          call: idle ? "idle" : "active",
          botName: name,
          onToggle: () => (idle ? void v.call!.start() : v.call!.end()),
        })
      : null,
    v.call ? createElement(VoicePanel, { call: v.call, view: v.view }) : null,
  );
}

const roots: ReturnType<typeof createRoot>[] = [];
let root: ReturnType<typeof createRoot>;
let host: HTMLElement;
const client = () => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return c;
};
let qc = client();
const settle = (ms = 10) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
async function mount(props: { id?: string; kind?: string; name?: string }) {
  host = win.document.createElement("div") as never;
  win.document.body.append(host);
  root = createRoot(host as never);
  roots.push(root);
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe, props))),
  );
  await settle();
  return host;
}
async function rerender(props: { id?: string; kind?: string }) {
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe, props))),
  );
  await settle();
}
const button = () =>
  host.querySelector(
    "button[aria-label*='voice' i], button[aria-label^='Talk']",
  ) as HTMLButtonElement | null;
const byText = (t: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === t) as
    | HTMLButtonElement
    | undefined;
const click = (b: Element | undefined | null) =>
  act(async () => {
    (b as HTMLElement).dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
  });
const status = () => host.querySelector("[role=status]")?.textContent ?? "";

beforeEach(() => {
  FakeSocket.all = [];
  audio = undefined;
  stops = 0;
  micError = undefined;
  constraints = undefined;
  tickets = [];
  ticketError = undefined;
  spoken = [];
  cancelled = 0;
  voice = "on";
  ticketDelay = 0;
  qc = client();
  win.document.body.replaceChildren();
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes("/api/voice/capabilities"))
      return new Response(JSON.stringify({ voice, phone: "off" }), {
        headers: { "content-type": "application/json" },
      });
    return new Response("{}", { status: 404 });
  }) as never;
});
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
});

/** Starts a call and opens its socket. */
async function begin(props: { id?: string; kind?: string } = { id: "c1", kind: "chat" }) {
  await mount(props);
  await click(button());
  await settle();
  await act(async () => sock().open());
  await settle();
}

describe("the Voice button", () => {
  test("it is there for a plain chat when voice is on, with a name and no visible text", async () => {
    await mount({ id: "c1", kind: "chat", name: "Ada" });
    const b = button()!;
    expect(b.getAttribute("aria-label")).toBe("Talk with Ada by voice");
    expect(b.textContent?.trim()).toBe("");
    expect(b.getAttribute("title")).toBeNull();
  });
  test("a chat with no kind yet (an older row) counts as a plain chat", async () => {
    await mount({ id: "c1" });
    expect(button()).not.toBeNull();
  });
  test("it is not there when voice is off on this installation", async () => {
    voice = "off";
    await mount({ id: "c1", kind: "chat" });
    expect(button()).toBeNull();
  });
  test("it is not there in a room, in a chat with outside people, or before the chat exists", async () => {
    await mount({ id: "c1", kind: "discussion" });
    expect(button()).toBeNull();
    await mount({ id: "c1", kind: "inbound" });
    expect(button()).toBeNull();
    await mount({});
    expect(button()).toBeNull();
  });
  test("the message box shows it next to the microphone, and not without the prop", async () => {
    const box = async (voiceProp: unknown) => {
      const el = win.document.createElement("div");
      win.document.body.append(el);
      const r = createRoot(el as never);
      roots.push(r);
      await act(async () =>
        r.render(
          createElement(
            QueryClientProvider,
            { client: qc },
            createElement(Composer, {
              value: "",
              onChange: () => {},
              placeholder: "Message",
              bots: [],
              busy: false,
              onSubmit: () => true,
              onError: () => {},
              voice: voiceProp as never,
            }),
          ),
        ),
      );
      return el as unknown as HTMLElement;
    };
    const withIt = await box({ call: "idle", botName: "Ada", onToggle: () => {} });
    const labels = [...withIt.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Talk with Ada by voice");
    expect(labels.indexOf("Talk with Ada by voice")).toBe(labels.indexOf("Record a message") + 1);
    const without = await box(undefined);
    expect(
      [...without.querySelectorAll("button")].some((b) =>
        /voice/i.test(b.getAttribute("aria-label") ?? ""),
      ),
    ).toBe(false);
  });
});

describe("a call", () => {
  test("it asks for the microphone with the echo canceller on, gets a ticket for the chat, and says start with the language", async () => {
    await begin();
    expect(constraints).toEqual(MIC_CONSTRAINTS);
    expect(constraints).toEqual({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    expect(tickets).toEqual(["c1"]);
    expect(sock().ticket).toBe("t-1");
    expect(sock().binaryType).toBe("arraybuffer");
    expect(sock().texts).toEqual([{ type: "start", language: "en-US" }]);
    expect(status()).toBe("Listening");
    expect(button()!.getAttribute("aria-label")).toBe("End the voice call");
  });

  test("the states are written out in words in a polite live region", async () => {
    await begin();
    const live = host.querySelector("[role=status]")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    await act(async () => sock().say({ type: "state", state: "thinking" }));
    expect(status()).toBe("Thinking");
    await act(async () => sock().say({ type: "state", state: "speaking" }));
    expect(status()).toBe("Speaking");
    await act(async () => sock().say({ type: "state", state: "listening" }));
    expect(status()).toBe("Listening");
  });

  test("frames go out while the microphone is live and stop while it is muted", async () => {
    await begin();
    const frame = new Uint8Array(640);
    audio!.handlers.onFrame(frame);
    expect(sock().sent.filter((s) => typeof s !== "string")).toHaveLength(1);
    await click(byText("Mute"));
    expect(sock().texts.at(-1)).toEqual({ type: "mute" });
    expect(status()).toBe("Listening, microphone muted");
    audio!.handlers.onFrame(frame);
    expect(sock().sent.filter((s) => typeof s !== "string")).toHaveLength(1);
    expect(byText("Unmute")!.getAttribute("aria-pressed")).toBe("true");
    await click(byText("Unmute"));
    expect(sock().texts.at(-1)).toEqual({ type: "unmute" });
    audio!.handlers.onFrame(frame);
    expect(sock().sent.filter((s) => typeof s !== "string")).toHaveLength(2);
  });

  test("what was just heard shows on one line until the bot speaks, and the chat is told to refresh", async () => {
    await begin();
    await act(async () =>
      sock().say({ type: "transcript", text: "remind me on Friday", final: true }),
    );
    expect(host.textContent).toContain("remind me on Friday");
    await act(async () => sock().say({ type: "state", state: "speaking" }));
    expect(host.textContent).not.toContain("remind me on Friday");
  });

  test("the bot's audio goes to the player, `clear` flushes it at once, and what was played is reported", async () => {
    await begin();
    await act(async () => sock().audio(new Uint8Array(640).buffer));
    expect(audio!.pushed).toEqual([640]);
    audio!.handlers.onPlayed(0);
    expect(sock().texts.some((m) => m.type === "played")).toBe(false);
    audio!.handlers.onPlayed(1600);
    expect(sock().texts.at(-1)).toEqual({ type: "played", samples: 1600 });
    await act(async () => sock().say({ type: "clear" }));
    expect(audio!.cleared).toBe(1);
    expect(cancelled).toBeGreaterThan(0);
  });

  test("`say` speaks the sentence in the device's voice and `clear` cancels it", async () => {
    await begin();
    await act(async () => sock().say({ type: "say", text: "Sure, on Friday." }));
    expect(spoken).toEqual([{ text: "Sure, on Friday.", lang: "en-US" }]);
    const before = cancelled;
    await act(async () => sock().say({ type: "clear" }));
    expect(cancelled).toBe(before + 1);
  });

  test("a voice chosen for the bot on this device is the one that speaks", async () => {
    store.set("zetta:bot-voice:bot1", "Luciana");
    await begin();
    await act(async () => sock().say({ type: "say", text: "Oi." }));
    expect(spoken[0]!.voice).toEqual({ name: "Luciana", lang: "pt-BR" });
    expect(spoken[0]!.lang).toBe("pt-BR");
    store.clear();
  });

  test("End says end, lets go of the microphone and the audio, and the panel says the call ended", async () => {
    await begin();
    await click(byText("End call"));
    expect(sock().texts.at(-1)).toEqual({ type: "end" });
    expect(stops).toBe(1);
    expect(audio!.closed).toBe(1);
    expect(cancelled).toBeGreaterThan(0);
    expect(host.textContent).toContain("The call ended.");
    expect(byText("Start again")).toBeDefined();
  });

  test("Escape in the panel ends the call; outside the panel it does nothing", async () => {
    await begin();
    await act(async () => {
      host.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(stops).toBe(0);
    const panel = host.querySelector("section")!;
    await act(async () => {
      panel.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(stops).toBe(1);
    expect(sock().texts.at(-1)).toEqual({ type: "end" });
  });

  test("switching to another chat ends the call, and a new call asks for its own ticket", async () => {
    await begin({ id: "c1", kind: "chat" });
    await rerender({ id: "c2", kind: "chat" });
    expect(sock().texts.at(-1)).toEqual({ type: "end" });
    expect(stops).toBe(1);
    expect(audio!.closed).toBe(1);
    expect(host.querySelector("section")).toBeNull();
    await click(button());
    await settle();
    expect(tickets).toEqual(["c1", "c2"]);
  });

  test("leaving the page (unmount) ends the call and lets go of the microphone", async () => {
    await begin();
    await act(async () => root.unmount());
    expect(sock().texts.at(-1)).toEqual({ type: "end" });
    expect(stops).toBe(1);
    expect(audio!.closed).toBe(1);
  });

  test("a call that cannot finish starting (ended before the ticket) leaves nothing running", async () => {
    ticketDelay = 40;
    await mount({ id: "c1", kind: "chat" });
    await click(button());
    await rerender({ id: "c2", kind: "chat" });
    await settle(80);
    expect(stops).toBe(1);
    expect(audio!.closed).toBe(1);
    expect(FakeSocket.all).toHaveLength(0);
  });
});

describe("what the person is told", () => {
  test("microphone permission denied: how to allow it, and a way to try again", async () => {
    micError = { name: "NotAllowedError" };
    await mount({ id: "c1", kind: "chat" });
    await click(button());
    expect(host.querySelector("[role=alert]")!.textContent).toContain("Microphone: Allow");
    expect(byText("Start again")).toBeDefined();
    micError = undefined;
    await click(byText("Start again"));
    await settle();
    await act(async () => sock().open());
    await settle();
    expect(status()).toBe("Listening");
  });
  test("no microphone", async () => {
    micError = { name: "NotFoundError" };
    await mount({ id: "c1", kind: "chat" });
    await click(button());
    expect(host.textContent).toContain("No microphone was found");
  });
  test("the ticket is refused: the server's sentence is shown and nothing is left open", async () => {
    ticketError = new Error("You can only talk by voice in a one-to-one chat with a bot.");
    await mount({ id: "c1", kind: "chat" });
    await click(button());
    await settle();
    expect(host.textContent).toContain("one-to-one chat with a bot");
    expect(stops).toBe(1);
    expect(audio!.closed).toBe(1);
  });
  test("the connection is lost: it says so and offers to start again", async () => {
    await begin();
    await act(async () => sock().drop(1006));
    expect(host.querySelector("[role=alert]")!.textContent).toContain(
      "connection to the call was lost",
    );
    expect(stops).toBe(1);
    expect(byText("Start again")).toBeDefined();
  });
  test("a call replaced by another tab or device says so (state message and close code)", async () => {
    await begin();
    await act(async () => sock().say({ type: "state", state: "ended", reason: "replaced" }));
    expect(host.textContent).toContain("another tab or on another device");
    expect(stops).toBe(1);
    await click(byText("Start again"));
    await settle();
    await act(async () => sock().drop(4409));
    expect(host.textContent).toContain("another tab or on another device");
  });
  test("the time limit and idle end each say what happened", async () => {
    await begin();
    await act(async () => sock().say({ type: "state", state: "ended", reason: "time_limit" }));
    expect(host.textContent).toContain("30 minutes");
    await click(byText("Start again"));
    await settle();
    await act(async () => sock().open());
    await act(async () => sock().say({ type: "state", state: "ended", reason: "idle" }));
    expect(host.textContent).toContain("2 minutes of silence");
  });
  test("a link that expired, and a server error", async () => {
    await begin();
    await act(async () => sock().drop(4401));
    expect(host.textContent).toContain("link expired");
    await click(byText("Start again"));
    await settle();
    await act(async () => sock().open());
    await act(async () => sock().say({ type: "state", state: "ended", reason: "error" }));
    expect(host.textContent).toContain("problem on the server");
  });
  test("an error message in the middle of a call is shown and the call goes on", async () => {
    await begin();
    await act(async () =>
      sock().say({ type: "error", code: "VOICE_ERROR", message: "Something went wrong." }),
    );
    expect(host.querySelector("[role=alert]")!.textContent).toBe("Something went wrong.");
    expect(byText("End call")).toBeDefined();
  });
  test("Close puts the panel away", async () => {
    await begin();
    await act(async () => sock().drop(1006));
    await click(byText("Close"));
    expect(host.querySelector("section")).toBeNull();
  });
});
