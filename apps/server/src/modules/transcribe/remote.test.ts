import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createConfiguredTranscriber, NO_KEY, type TranscribeSettings } from "./configured";
import { createRemoteTranscriber, encodeWav, transcriptionsUrl } from "./remote";
import { languageCode, SAMPLE_RATE, TranscribeError, type Transcriber } from "./transcriber";

const KEY = "sk-test-0123456789abcdef";
type Seen = {
  url: string;
  auth: string | null;
  model: string;
  language: string | null;
  format: string | null;
  fileType: string;
  bytes: number;
  riff: string;
};
const seen: Seen[] = [];
let reply: () => Response = () => Response.json({ text: " hello there " });
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/redirect/audio/transcriptions")
      return Response.redirect("http://127.0.0.1:1/x", 302);
    if (url.pathname === "/slow/audio/transcriptions") {
      await Bun.sleep(400);
      return Response.json({ text: "late" });
    }
    const form = await req.formData();
    const file = form.get("file") as File;
    const head = new Uint8Array(await file.arrayBuffer());
    seen.push({
      url: url.pathname,
      auth: req.headers.get("authorization"),
      model: String(form.get("model")),
      language: form.get("language") === null ? null : String(form.get("language")),
      format: form.get("response_format") === null ? null : String(form.get("response_format")),
      fileType: file.type,
      bytes: head.length,
      riff: String.fromCharCode(...head.slice(0, 4)),
    });
    return reply();
  },
});
afterAll(() => server.stop(true));
const base = (path = "/v1") => `http://127.0.0.1:${server.port}${path}`;
const pcm = (seconds = 1) => new Float32Array(SAMPLE_RATE * seconds);
const remote = (
  over: {
    baseUrl?: string;
    model?: string;
    allowPrivate?: boolean;
    deadlineMs?: number;
    defaultLanguage?: string;
  } = {},
) => {
  // A fresh buffer for every recording, as the real key lookup gives: the transcriber wipes the one it is handed.
  const issued: Buffer[] = [];
  return {
    issued,
    wiped: () => issued.length > 0 && issued.every((b) => [...b].every((x) => x === 0)),
    t: createRemoteTranscriber({
      allowPrivate: over.allowPrivate ?? true,
      deadlineMs: over.deadlineMs,
      defaultLanguage: () => over.defaultLanguage,
      resolve: async () => {
        const key = Buffer.from(KEY);
        issued.push(key);
        return {
          provider: "compatible",
          baseUrl: over.baseUrl ?? base(),
          model: over.model ?? "",
          key,
        };
      },
    }),
  };
};
beforeEach(() => {
  seen.length = 0;
  reply = () => Response.json({ text: " hello there " });
});

describe("the recording sent to a provider", () => {
  test("it is a 16 kHz mono 16-bit WAV with the samples in range", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5, 2, -2]));
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(12);
    expect(wav.byteLength).toBe(44 + 12);
    const samples = [0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 32767, -32768, 16383, 32767, -32768]);
    expect(transcriptionsUrl("https://h.test/v1/")).toBe("https://h.test/v1/audio/transcriptions");
    expect(transcriptionsUrl("https://h.test/v1")).toBe("https://h.test/v1/audio/transcriptions");
  });

  test("the provider gets the key, the model, the language as a two-letter code and the audio, and the words come back trimmed", async () => {
    const { t } = remote({ model: "gpt-4o-mini-transcribe" });
    expect(await t.transcribe(pcm(), { language: "pt-BR" })).toBe("hello there");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      url: "/v1/audio/transcriptions",
      auth: `Bearer ${KEY}`,
      model: "gpt-4o-mini-transcribe",
      language: "pt",
      format: "json",
      riff: "RIFF",
    });
    expect(seen[0]!.fileType).toMatch(/audio\/(x-)?wav/);
    expect(seen[0]!.bytes).toBe(44 + SAMPLE_RATE * 2);
  });

  test("the default model, and no language when none is known, are left to the provider", async () => {
    const { t } = remote();
    await t.transcribe(pcm());
    expect(seen[0]).toMatchObject({ model: "whisper-1", language: null });
    await remote({ defaultLanguage: "es" }).t.transcribe(pcm());
    expect(seen[1]!.language).toBe("es");
    // A language Whisper does not know is not invented.
    await t.transcribe(pcm(), { language: "tlh" });
    expect(seen[2]!.language).toBeNull();
  });

  test("the key is wiped from memory after the call, whether it worked or not", async () => {
    const ok = remote();
    await ok.t.transcribe(pcm());
    expect(ok.wiped()).toBe(true);
    reply = () => new Response("nope", { status: 401 });
    const bad = remote();
    await bad.t.transcribe(pcm()).catch(() => undefined);
    expect(bad.wiped()).toBe(true);
  });
});

describe("what goes wrong is said in fixed sentences", () => {
  const fail = async (status: number, body = "provider secret detail " + KEY) => {
    reply = () => new Response(body, { status, statusText: "Provider Status Text" });
    const e = (await remote()
      .t.transcribe(pcm())
      .catch((x) => x)) as TranscribeError;
    expect(e).toBeInstanceOf(TranscribeError);
    // Nothing the provider said, and never the key.
    expect(`${e.message} ${e.safe}`).not.toContain("provider secret detail");
    expect(`${e.message} ${e.safe}`).not.toContain(KEY);
    expect(`${e.message} ${e.safe}`).not.toContain("Provider Status Text");
    return e;
  };
  test("a refused key, a limit, a too big file and any other failure", async () => {
    expect((await fail(401)).code).toBe("PROVIDER_AUTH");
    expect((await fail(403)).code).toBe("PROVIDER_AUTH");
    expect((await fail(429)).code).toBe("BUSY");
    expect((await fail(413)).code).toBe("TOO_BIG");
    expect((await fail(500)).code).toBe("FAILED");
    expect((await fail(404)).code).toBe("FAILED");
  });
  test("an answer that is not the expected JSON, or too large", async () => {
    reply = () => new Response("<html>", { status: 200 });
    expect(
      (
        await remote()
          .t.transcribe(pcm())
          .catch((x) => x)
      ).code,
    ).toBe("FAILED");
    reply = () => Response.json({ nope: 1 });
    expect(
      (
        await remote()
          .t.transcribe(pcm())
          .catch((x) => x)
      ).code,
    ).toBe("FAILED");
    reply = () => new Response(JSON.stringify({ text: "x".repeat(1_100_000) }));
    expect(
      (
        await remote()
          .t.transcribe(pcm())
          .catch((x) => x)
      ).code,
    ).toBe("FAILED");
  });
  test("a redirect is refused so the key cannot follow it, and a slow provider times out", async () => {
    expect(
      (
        await remote({ baseUrl: base("/redirect") })
          .t.transcribe(pcm())
          .catch((x) => x)
      ).code,
    ).toBe("FAILED");
    expect(
      (
        await remote({ baseUrl: base("/slow"), deadlineMs: 50 })
          .t.transcribe(pcm())
          .catch((x) => x)
      ).safe,
    ).toContain("took too long");
  });
  test("an address on a private network is refused unless the operator allowed it; the key never leaves", async () => {
    const r = remote({ allowPrivate: false });
    const e = (await r.t.transcribe(pcm()).catch((x) => x)) as TranscribeError;
    expect(e.code).toBe("NOT_CONFIGURED");
    expect(seen).toHaveLength(0);
    expect(r.wiped()).toBe(true);
  });
  test("a cancelled call stops, and the removed variable changes nothing", async () => {
    process.env.ZETTA_TRANSCRIBE = "off";
    try {
      expect(await remote().t.transcribe(pcm())).toBe("hello there");
    } finally {
      delete process.env.ZETTA_TRANSCRIBE;
    }
    const ctl = new AbortController();
    const p = remote({ baseUrl: base("/slow") })
      .t.transcribe(pcm(), { signal: ctl.signal })
      .catch((x) => x);
    ctl.abort();
    expect((await p).code).toBe("FAILED");
  });
});

describe("the transcriber the server uses chooses by the installation's settings, on every recording", () => {
  const calls: string[] = [];
  const local: Transcriber = {
    async transcribe(_pcm, o) {
      calls.push(`local:${o?.language ?? "-"}`);
      return "from the server model";
    },
  };
  let settings: TranscribeSettings = {
    transcribeProvider: "local",
    transcribeModel: "",
    transcribeLanguage: "",
    transcribeBaseUrl: "",
    transcribeConnectionId: null,
  };
  // A fresh buffer every time, as the real key lookup gives: the transcriber wipes the one it is handed.
  let secret: string | undefined = KEY;
  const configured = createConfiguredTranscriber({
    settings: async () => settings,
    local,
    key: async () => (secret ? Buffer.from(secret) : undefined),
    allowPrivate: true,
  });
  beforeEach(() => {
    calls.length = 0;
    secret = KEY;
  });

  test("local runs on the server, and a change in the settings applies to the next recording", async () => {
    expect(await configured.transcribe(pcm())).toBe("from the server model");
    settings = {
      ...settings,
      transcribeProvider: "compatible",
      transcribeBaseUrl: base(),
      transcribeModel: "m1",
    };
    expect(await configured.transcribe(pcm())).toBe("hello there");
    expect(seen.at(-1)).toMatchObject({ model: "m1", auth: `Bearer ${KEY}` });
    settings = { ...settings, transcribeProvider: "local" };
    expect(await configured.transcribe(pcm())).toBe("from the server model");
    expect(calls).toEqual(["local:-", "local:-"]);
  });

  test("`off` refuses every recording with the sentence, whatever else is saved, and the removed variable does not matter", async () => {
    settings = {
      ...settings,
      transcribeProvider: "off",
      transcribeBaseUrl: "",
      transcribeConnectionId: "c1",
    };
    const e = (await configured.transcribe(pcm()).catch((x) => x)) as TranscribeError;
    expect(e.code).toBe("DISABLED");
    expect(e.safe).toBe("Turning speech into text is switched off on this server.");
    expect(calls).toEqual([]);
    expect(seen).toHaveLength(0);
    // With the variable at the opposite value the saved provider still wins.
    process.env.ZETTA_TRANSCRIBE = "on";
    try {
      expect((await configured.transcribe(pcm()).catch((x) => x)).code).toBe("DISABLED");
    } finally {
      delete process.env.ZETTA_TRANSCRIBE;
    }
    settings = { ...settings, transcribeProvider: "local" };
    process.env.ZETTA_TRANSCRIBE = "off";
    try {
      expect(await configured.transcribe(pcm())).toBe("from the server model");
    } finally {
      delete process.env.ZETTA_TRANSCRIBE;
    }
  });

  test("OpenAI has its own address; the call's language wins over the installation's, which is the default", async () => {
    settings = { ...settings, transcribeProvider: "local", transcribeLanguage: "pt" };
    await configured.transcribe(pcm());
    await configured.transcribe(pcm(), { language: "fr" });
    expect(calls).toEqual(["local:pt", "local:fr"]);
    settings = {
      ...settings,
      transcribeProvider: "compatible",
      transcribeBaseUrl: base(),
      transcribeLanguage: "pt",
    };
    await configured.transcribe(pcm());
    await configured.transcribe(pcm(), { language: "fr-CA" });
    expect(seen.slice(-2).map((s) => s.language)).toEqual(["pt", "fr"]);
  });

  test("a provider with no key, an unreadable key or no address says so instead of switching to another provider", async () => {
    settings = { ...settings, transcribeProvider: "compatible", transcribeBaseUrl: base() };
    secret = undefined;
    expect(await configured.transcribe(pcm()).catch((x) => x)).toBe(NO_KEY);
    const broken = createConfiguredTranscriber({
      settings: async () => settings,
      local,
      key: async () => {
        throw new Error("connection revoked");
      },
    });
    expect(await broken.transcribe(pcm()).catch((x) => x)).toBe(NO_KEY);
    settings = { ...settings, transcribeBaseUrl: "" };
    expect((await configured.transcribe(pcm()).catch((x) => x)).code).toBe("NOT_CONFIGURED");
    expect(calls).toEqual([]);
  });

  test("language codes: tags and names map to two letters, the unknown to nothing", () => {
    expect(languageCode("pt-BR")).toBe("pt");
    expect(languageCode("Portuguese")).toBe("pt");
    expect(languageCode("zh_TW")).toBe("zh");
    expect(languageCode("tlh")).toBeUndefined();
    expect(languageCode("")).toBeUndefined();
  });
});
