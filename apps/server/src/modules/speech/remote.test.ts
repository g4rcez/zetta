import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_SPEECH_SETTINGS, type SpeechSettings } from "@zetta/core/speech";
import { tone } from "../voice/core/test-audio";
import { pcm16ToBytes } from "../voice/core/audio";
import { createConfiguredSynthesizer, NO_SPEECH_KEY } from "./configured";
import { SpeechError } from "./errors";
import { createPcmNormalizer, pcm16ToWav } from "./pcm";
import {
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_DEFAULT_VOICE,
  MAX_TEXT_CHARS,
  OPENAI_DEFAULT_MODEL,
  createRemoteSynthesizer,
  speechRequest,
  type RemoteSpeech,
} from "./remote";

const KEY = "sk-test-0123456789abcdef";
type Seen = {
  path: string;
  query: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};
const seen: Seen[] = [];
/** What the fake provider answers: 24 kHz audio (OpenAI style) unless a path says otherwise. */
let reply: (path: string) => Response = () =>
  new Response(pcm16ToBytes(tone(500, 0.3, 440, 24000)));
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/redirect/audio/speech")
      return Response.redirect("http://127.0.0.1:1/x", 302);
    if (url.pathname === "/slow/audio/speech") {
      await Bun.sleep(400);
      return new Response(new Uint8Array(4));
    }
    seen.push({
      path: url.pathname,
      query: url.search,
      headers: Object.fromEntries(req.headers),
      body: (await req.json()) as Record<string, unknown>,
    });
    return reply(url.pathname);
  },
});
afterAll(() => server.stop(true));
beforeEach(() => {
  seen.length = 0;
  reply = () => new Response(pcm16ToBytes(tone(500, 0.3, 440, 24000)));
});
const base = (path = "/v1") => `http://127.0.0.1:${server.port}${path}`;
const hzOf = (pcm: Int16Array, rate: number) => {
  let n = 0;
  for (let i = 1; i < pcm.length; i++) if (pcm[i - 1]! < 0 && pcm[i]! >= 0) n++;
  return (n * rate) / pcm.length;
};

function synth(
  over: Partial<Omit<RemoteSpeech, "key">> & { allowPrivate?: boolean; deadlineMs?: number } = {},
) {
  const issued: Buffer[] = [];
  const { allowPrivate = true, deadlineMs, ...cfg } = over;
  const s = createRemoteSynthesizer({
    allowPrivate,
    deadlineMs,
    resolve: async () => {
      const key = Buffer.from(KEY);
      issued.push(key);
      return { provider: "openai", baseUrl: base(), model: "", voice: "", ...cfg, key };
    },
  });
  return { s, issued };
}
const code = async (p: Promise<unknown>) =>
  p.then(
    () => "none",
    (e: unknown) => (e instanceof SpeechError ? e.code : "other"),
  );

describe("openai and compatible (/audio/speech)", () => {
  test("sends the model, voice and pcm format with the key, and returns 16 kHz samples", async () => {
    const { s } = synth({ model: "tts-x", voice: "nova" });
    const pcm = await s.synthesize("Hello there.");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe("/v1/audio/speech");
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(seen[0]!.body).toEqual({
      model: "tts-x",
      input: "Hello there.",
      voice: "nova",
      response_format: "pcm",
    });
    // 500 ms of 24 kHz audio became 500 ms of 16 kHz audio with the same pitch
    expect(pcm.length).toBe(8000);
    expect(hzOf(pcm, 16000)).toBeGreaterThan(425);
    expect(hzOf(pcm, 16000)).toBeLessThan(455);
  });

  test("defaults: gpt-4o-mini-tts and alloy for OpenAI, tts-1 for another server", () => {
    const o = speechRequest(
      { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "", voice: "" },
      "x",
    );
    expect(o.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(o.body).toMatchObject({ model: OPENAI_DEFAULT_MODEL, voice: "alloy" });
    const c = speechRequest(
      { provider: "compatible", baseUrl: "http://h/v1/", model: "", voice: "" },
      "x",
    );
    expect(c.url).toBe("http://h/v1/audio/speech");
    expect(c.body).toMatchObject({ model: "tts-1" });
  });

  test("chunks cut anywhere (even through a sample) give the same audio", async () => {
    const bytes = pcm16ToBytes(tone(300, 0.3, 440, 24000));
    reply = () =>
      new Response(
        new ReadableStream({
          async start(c) {
            for (let i = 0; i < bytes.length; i += 1001) {
              c.enqueue(bytes.slice(i, i + 1001));
              await Bun.sleep(1);
            }
            c.close();
          },
        }),
      );
    const { s } = synth();
    const chunks: Int16Array[] = [];
    for await (const c of s.stream("Hi.")) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(2);
    const whole = await synth().s.synthesize("Hi.");
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(whole.length);
  });

  test("a trailing slash and a bare host work", async () => {
    await synth({ baseUrl: base("/v1/") }).s.synthesize("a");
    expect(seen[0]!.path).toBe("/v1/audio/speech");
  });

  test("the key buffer is zeroed after a call, after a failure and after a cancel", async () => {
    const ok = synth();
    await ok.s.synthesize("a");
    expect(ok.issued[0]!.every((b) => b === 0)).toBe(true);
    reply = () => new Response("no", { status: 500 });
    const bad = synth();
    expect(await code(bad.s.synthesize("a"))).toBe("FAILED");
    expect(bad.issued[0]!.every((b) => b === 0)).toBe(true);
    const ctl = new AbortController();
    ctl.abort();
    const cancelled = synth();
    expect(await code(cancelled.s.synthesize("a", { signal: ctl.signal }))).toBe("FAILED");
    expect(cancelled.issued[0]!.every((b) => b === 0)).toBe(true);
  });

  test("provider errors become fixed sentences and nothing else leaks", async () => {
    const cases: [number, string][] = [
      [401, "PROVIDER_AUTH"],
      [403, "PROVIDER_AUTH"],
      [429, "BUSY"],
      [413, "TOO_LONG"],
      [500, "FAILED"],
    ];
    for (const [status, expected] of cases) {
      reply = () => new Response(`secret detail ${KEY}`, { status, statusText: "leaky text" });
      const { s } = synth();
      const err = await s.synthesize("a").catch((e: unknown) => e as SpeechError);
      expect((err as SpeechError).code as string).toBe(expected);
      expect((err as SpeechError).safe).not.toContain(KEY);
      expect((err as SpeechError).safe).not.toContain("leaky");
    }
  });

  test("empty audio, empty text and too long text", async () => {
    reply = () => new Response(new Uint8Array(0));
    expect(await code(synth().s.synthesize("a"))).toBe("FAILED");
    seen.length = 0;
    expect(await synth().s.synthesize("   ")).toHaveLength(0);
    expect(seen).toHaveLength(0);
    expect(await code(synth().s.synthesize("x".repeat(MAX_TEXT_CHARS + 1)))).toBe("TOO_LONG");
    expect(seen).toHaveLength(0);
  });

  test("redirects are refused, so the key cannot follow one", async () => {
    expect(await code(synth({ baseUrl: base("/redirect") }).s.synthesize("a"))).toBe("FAILED");
  });

  test("a slow provider is cut off", async () => {
    expect(await code(synth({ baseUrl: base("/slow"), deadlineMs: 100 }).s.synthesize("a"))).toBe(
      "FAILED",
    );
  });

  test("a cancel in the middle stops the stream", async () => {
    const bytes = pcm16ToBytes(tone(2000, 0.3, 440, 24000));
    reply = () =>
      new Response(
        new ReadableStream({
          async start(c) {
            for (let i = 0; i < bytes.length; i += 4000) {
              c.enqueue(bytes.slice(i, i + 4000));
              await Bun.sleep(20);
            }
            c.close();
          },
        }),
      );
    const ctl = new AbortController();
    const got: Int16Array[] = [];
    const { s } = synth();
    const done = (async () => {
      for await (const c of s.stream("long", { signal: ctl.signal })) {
        got.push(c);
        if (got.length === 2) ctl.abort();
      }
    })();
    expect(await code(done)).toBe("FAILED");
    expect(got.length).toBeLessThan(10);
  });

  test("the private-address rule applies to a custom address, not to the fixed ones", async () => {
    expect(
      await code(
        synth({ provider: "compatible", baseUrl: base(), allowPrivate: false }).s.synthesize("a"),
      ),
    ).toBe("NOT_CONFIGURED");
    expect(seen).toHaveLength(0);
  });
});

describe("elevenlabs (streaming endpoint)", () => {
  test("asks for 16 kHz pcm with the voice in the path and the key in xi-api-key", async () => {
    const audio = pcm16ToBytes(tone(400, 0.3, 440, 16000));
    reply = () => new Response(audio);
    const { s } = synth({
      provider: "elevenlabs",
      baseUrl: base("/v1"),
      model: "",
      voice: "VOICE123",
    });
    const pcm = await s.synthesize("Olá, tudo bem?", { language: "pt-BR" } as never);
    expect(seen[0]!.path).toBe("/v1/text-to-speech/VOICE123/stream");
    expect(seen[0]!.query).toBe("?output_format=pcm_16000");
    expect(seen[0]!.headers["xi-api-key"]).toBe(KEY);
    expect(seen[0]!.headers.authorization).toBeUndefined();
    expect(seen[0]!.body).toEqual({ text: "Olá, tudo bem?", model_id: ELEVENLABS_DEFAULT_MODEL });
    expect(pcm.length).toBe(6400);
  });

  test("default voice, and a language code only for models that take one", () => {
    const flash = speechRequest(
      { provider: "elevenlabs", baseUrl: "https://api.elevenlabs.io/v1", model: "", voice: "" },
      "x",
      "es",
    );
    expect(flash.url).toContain(`/text-to-speech/${ELEVENLABS_DEFAULT_VOICE}/stream`);
    expect(flash.body).toMatchObject({ language_code: "es" });
    const multi = speechRequest(
      {
        provider: "elevenlabs",
        baseUrl: "https://api.elevenlabs.io/v1",
        model: "eleven_multilingual_v2",
        voice: "v",
      },
      "x",
      "es",
    );
    expect(multi.body).not.toHaveProperty("language_code");
  });
});

describe("the configured synthesizer reads the settings on every call", () => {
  function configured(
    settings: () => SpeechSettings,
    key: () => Buffer | undefined = () => Buffer.from(KEY),
  ) {
    return createConfiguredSynthesizer({
      settings: async () => settings(),
      key: async () => key(),
      allowPrivate: true,
    });
  }
  test("off and browser never reach the network; a changed setting applies at once", async () => {
    let s: SpeechSettings = { ...DEFAULT_SPEECH_SETTINGS, speechProvider: "off" };
    const c = configured(() => s);
    expect(await c.mode()).toBe("off");
    expect(await code(c.synthesize("a"))).toBe("OFF");
    s = { ...s, speechProvider: "browser" };
    expect(await c.mode()).toBe("browser");
    expect(await code(c.synthesize("a"))).toBe("BROWSER");
    s = {
      ...s,
      speechProvider: "compatible",
      speechBaseUrl: base(),
      speechModel: "m1",
      speechVoice: "v1",
      speechLanguage: "pt",
    };
    expect(await c.mode()).toBe("remote");
    await c.synthesize("a", { voice: "bot-voice" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.body).toMatchObject({ model: "m1", voice: "bot-voice" });
    await c.synthesize("a");
    expect(seen[1]!.body).toMatchObject({ voice: "v1" });
  });

  test("a missing key is a fixed error and no request is made", async () => {
    const c = configured(
      () => ({ ...DEFAULT_SPEECH_SETTINGS, speechProvider: "compatible", speechBaseUrl: base() }),
      () => undefined,
    );
    const err = await c.synthesize("a").catch((e: unknown) => e);
    expect(err).toBe(NO_SPEECH_KEY);
    expect(seen).toHaveLength(0);
  });

  test("compatible without an address is not configured", async () => {
    const c = configured(() => ({ ...DEFAULT_SPEECH_SETTINGS, speechProvider: "compatible" }));
    expect(await code(c.synthesize("a"))).toBe("NOT_CONFIGURED");
  });
});

describe("pcm helpers", () => {
  test("the normalizer carries an odd byte and a partial group between chunks", () => {
    const bytes = pcm16ToBytes(tone(100, 0.3, 440, 24000));
    const n = createPcmNormalizer(24000);
    const parts = [
      n.push(bytes.slice(0, 7)),
      n.push(bytes.slice(7, 100)),
      n.push(bytes.slice(100)),
      n.flush(),
    ];
    expect(parts.reduce((t, p) => t + p.length, 0)).toBe(1600);
  });
  test("a wav has the header of 16 kHz mono 16-bit", () => {
    const wav = pcm16ToWav(new Int16Array(10));
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(40, true)).toBe(20);
    expect(wav.length).toBe(64);
  });
});
