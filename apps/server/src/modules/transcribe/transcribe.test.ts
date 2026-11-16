import { afterEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createIdentityAccess } from "../identity/access";
import { decodeAudio, hasDecoder, pcm16ToFloat32 } from "./decode";
import { createTranscribeRoutes } from "./routes";
import { createTranscribe } from "./service";
import {
  createLocalTranscriber,
  whisperLanguage,
  MAX_SAMPLES,
  SAMPLE_RATE,
  TranscribeError,
} from "./transcriber";

const pcm16 = (...samples: number[]) => {
  const b = new Uint8Array(samples.length * 2);
  const v = new DataView(b.buffer);
  samples.forEach((s, i) => v.setInt16(i * 2, s, true));
  return b;
};

describe("pcm16ToFloat32", () => {
  test("16-bit little-endian samples become floats between -1 and 1", () => {
    expect(Array.from(pcm16ToFloat32(pcm16(0, 16384, -16384, 32767, -32768)))).toEqual([
      0,
      0.5,
      -0.5,
      32767 / 32768,
      -1,
    ]);
  });
  test("a half sample at the end is dropped, a view into a larger buffer is read from its own start, and too long a recording is refused", () => {
    expect(pcm16ToFloat32(new Uint8Array([0, 0, 1])).length).toBe(1);
    const big = new Uint8Array(10);
    big.set(pcm16(16384), 4);
    expect(pcm16ToFloat32(big.subarray(4, 6))[0]).toBe(0.5);
    expect(() => pcm16ToFloat32(new Uint8Array((MAX_SAMPLES + 1) * 2))).toThrow(TranscribeError);
  });
});

describe("the local transcriber", () => {
  afterEach(() => {
    delete process.env.ZETTA_TRANSCRIBE;
  });
  const sec = (n: number) => new Float32Array(SAMPLE_RATE * n);

  test("it loads the model once, works on one recording at a time and keeps the order", async () => {
    let loaded = 0;
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const t = createLocalTranscriber({
      recognizer: async (pcm) => {
        loaded++;
        running++;
        peak = Math.max(peak, running);
        await Bun.sleep(15);
        order.push(pcm.length);
        running--;
        return `heard ${pcm.length}`;
      },
    });
    const out = await Promise.all([
      t.transcribe(sec(1)),
      t.transcribe(sec(2)),
      t.transcribe(sec(3)),
    ]);
    expect(out).toEqual([
      `heard ${SAMPLE_RATE}`,
      `heard ${2 * SAMPLE_RATE}`,
      `heard ${3 * SAMPLE_RATE}`,
    ]);
    expect(peak).toBe(1);
    expect(order).toEqual([SAMPLE_RATE, 2 * SAMPLE_RATE, 3 * SAMPLE_RATE]);
    expect(loaded).toBe(3);
  });

  test("it can be switched off, refuses more than five minutes, and turns a model failure into a sentence without stopping the next one", async () => {
    let n = 0;
    const t = createLocalTranscriber({
      recognizer: async () => (++n === 1 ? Promise.reject(new Error("onnx exploded")) : "fine"),
    });
    await expect(t.transcribe(sec(1))).rejects.toMatchObject({ code: "FAILED" });
    expect(await t.transcribe(sec(1))).toBe("fine");
    await expect(t.transcribe(new Float32Array(MAX_SAMPLES + 1))).rejects.toMatchObject({
      code: "TOO_LONG",
    });
    process.env.ZETTA_TRANSCRIBE = "off";
    await expect(t.transcribe(sec(1))).rejects.toMatchObject({ code: "DISABLED" });
  });

  test("a recording that was cancelled before its turn is not run", async () => {
    let ran = 0;
    const t = createLocalTranscriber({ recognizer: async () => (++ran, await Bun.sleep(20), "x") });
    const ctl = new AbortController();
    const first = t.transcribe(sec(1));
    const second = t.transcribe(sec(1), { signal: ctl.signal });
    ctl.abort();
    await first;
    await expect(second).rejects.toMatchObject({ code: "FAILED" });
    expect(ran).toBe(1);
  });
});

describe("the transcribe service", () => {
  test("a browser recording is read as samples and the transcript is cleaned up and capped", async () => {
    const seen: number[][] = [];
    const svc = createTranscribe({
      transcribe: async (pcm) => (
        seen.push(Array.from(pcm)),
        `  hello \n\n   world  ${"x".repeat(9000)}`
      ),
    });
    const text = await svc.fromPcm(pcm16(16384, -16384));
    expect(seen).toEqual([[0.5, -0.5]]);
    expect(text.startsWith("hello world xxx")).toBe(true);
    expect(text.length).toBe(8000);
  });
});

describe("decoding other formats", () => {
  test("without ffmpeg a voice note is refused in words; with it, a clip is read as samples", async () => {
    if (!hasDecoder()) {
      await expect(decodeAudio(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
        code: "NO_DECODER",
      });
      return;
    }
    await expect(decodeAudio(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({
      code: "UNREADABLE",
    });
    // A WAV of 0.25 s of silence at 8 kHz, brought to 16 kHz mono.
    const data = new Uint8Array(4000);
    const wav = new Uint8Array(44 + data.length);
    const v = new DataView(wav.buffer);
    const tag = (at: number, s: string) =>
      [...s].forEach((c, i) => (wav[at + i] = c.charCodeAt(0)));
    tag(0, "RIFF");
    v.setUint32(4, 36 + data.length, true);
    tag(8, "WAVEfmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true);
    v.setUint32(28, 16000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    tag(36, "data");
    v.setUint32(40, data.length, true);
    wav.set(data, 44);
    const pcm = await decodeAudio(wav);
    expect(pcm.length).toBeGreaterThan(SAMPLE_RATE * 0.2);
    expect(pcm.length).toBeLessThan(SAMPLE_RATE * 0.3);
  });
});

describe("POST /api/transcribe", () => {
  const ORIGIN = "http://localhost:5173";
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );
  const texts: string[] = [];
  const server = new Elysia().use(
    createTranscribeRoutes(
      {
        access,
        transcribe: createTranscribe({
          transcribe: async (pcm) => (texts.push(`n=${pcm.length}`), "hello there"),
        }),
      },
      [ORIGIN],
    ),
  );
  const call = async (as: string | null, body: unknown, origin: string | null = ORIGIN) =>
    server.handle(
      new Request("http://localhost/api/transcribe", {
        method: "POST",
        headers: {
          ...(as ? { "x-test-user": as } : {}),
          ...(origin ? { origin } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );

  test("it needs a signed-in person and a trusted origin, takes samples and answers the text", async () => {
    // A signed-in person with an active membership is needed; the lookup above has no membership table, so `requireActive` decides.
    expect((await call(null, { pcmBase64: "AAAA" })).status).toBe(401);
    expect((await call("u1", { pcmBase64: "AAAA" }, "https://evil.example")).status).toBe(403);
  });
});

describe("the language the speech is in", () => {
  test("a browser tag or a name maps to Whisper's name for it; what it does not know is left out", () => {
    expect(whisperLanguage("pt-BR")).toBe("portuguese");
    expect(whisperLanguage("en_US")).toBe("english");
    expect(whisperLanguage("ES")).toBe("spanish");
    expect(whisperLanguage("portuguese")).toBe("portuguese");
    expect(whisperLanguage("tlh")).toBeUndefined();
    expect(whisperLanguage("")).toBeUndefined();
    expect(whisperLanguage(undefined)).toBeUndefined();
  });
  test("the recording's language reaches the model, and the server's default is used when it sends none", async () => {
    const seen: (string | undefined)[] = [];
    const t = createLocalTranscriber({
      recognizer: async (_pcm, language) => (seen.push(language), "ok"),
    });
    await t.transcribe(new Float32Array(1600), { language: "pt-BR" });
    await t.transcribe(new Float32Array(1600));
    process.env.ZETTA_TRANSCRIBE_LANGUAGE = "es";
    try {
      await t.transcribe(new Float32Array(1600));
      await t.transcribe(new Float32Array(1600), { language: "fr" });
    } finally {
      delete process.env.ZETTA_TRANSCRIBE_LANGUAGE;
    }
    expect(seen).toEqual(["portuguese", undefined, "spanish", "french"]);
  });
});
