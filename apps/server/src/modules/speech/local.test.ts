import { describe, expect, test } from "bun:test";
import { DEFAULT_SPEECH_SETTINGS, type SpeechSettings } from "@zetta/core/speech";
import { createConfiguredSynthesizer, speechModeOf } from "./configured";
import { SpeechError } from "./errors";
import {
  createLocalSynthesizer,
  guessLanguage,
  localSpeechModelOf,
  pickLocalVoice,
  splitForModel,
  type LocalSpeechEngine,
} from "./local";

/** A model that answers `n` samples of 0.5 at 24 kHz per sentence, after `ms`, and records what it was asked. */
const fake = (n = 2400, ms = 0) => {
  const log = {
    asked: [] as { sentence: string; voice: string; model?: string }[],
    running: 0,
    peak: 0,
  };
  const engine: LocalSpeechEngine = {
    async speak(sentence, voice, model) {
      log.asked.push({ sentence, voice, model });
      log.running++;
      log.peak = Math.max(log.peak, log.running);
      if (ms) await Bun.sleep(ms);
      log.running--;
      return { samples: new Float32Array(n).fill(0.5), rate: 24_000 };
    },
  };
  return { engine, log };
};
const fails = async (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as SpeechError,
  );

describe("which voice speaks", () => {
  test("a Kokoro voice id wins; anything else falls back to the voice of the text's language", () => {
    expect(pickLocalVoice("pm_alex", "en").voice).toBe("pm_alex");
    expect(pickLocalVoice("pm_alex", "en")).toMatchObject({ lang: "pt", espeak: "pt-br" });
    expect(pickLocalVoice("bf_emma", undefined)).toMatchObject({ lang: "en", espeak: "en-gb" });
    expect(pickLocalVoice("alloy", "pt-BR").voice).toBe("pf_dora");
    expect(pickLocalVoice("", "es_MX").voice).toBe("ef_dora");
    expect(pickLocalVoice(undefined, "fr").voice).toBe("af_heart");
    expect(pickLocalVoice(undefined, undefined).voice).toBe("af_heart");
  });
  test("with no language given, the words of the text say it", () => {
    expect(guessLanguage("Por favor, me lembre de enviar a fatura para o cliente.")).toBe("pt");
    expect(guessLanguage("Recuérdame enviar la factura al cliente para mañana.")).toBe("es");
    expect(guessLanguage("Please remind me to send the invoice to the client.")).toBe("en");
    expect(guessLanguage("12345")).toBe("en");
  });
});

describe("a text is cut into sentences the model can read", () => {
  test("whole sentences, and a very long one is cut at a space", () => {
    expect(splitForModel("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
    const long = Array.from({ length: 200 }, () => "word").join(" ");
    const parts = splitForModel(long, 100);
    expect(parts.length).toBeGreaterThan(4);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join(" ")).toBe(long);
  });
});

describe("the local synthesizer", () => {
  test("the audio is 16 kHz mono 16-bit samples, one chunk per sentence, from a 24 kHz model", async () => {
    const { engine, log } = fake(2400);
    const s = createLocalSynthesizer({ engine });
    const chunks: Int16Array[] = [];
    for await (const c of s.stream("First one. Second one.", { language: "en" })) chunks.push(c);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBeInstanceOf(Int16Array);
    expect(chunks[0]!.length).toBe(1600); // 2400 samples at 24 kHz are 1600 at 16 kHz
    expect(Math.abs(chunks[0]![800]! - 16384)).toBeLessThan(40); // 0.5 full scale
    expect(log.asked.map((a) => a.sentence)).toEqual(["First one.", "Second one."]);
    expect(log.asked[0]!.voice).toBe("af_heart");
    const all = await s.synthesize("First one. Second one.", { language: "pt-BR" });
    expect(all.length).toBe(3200);
    expect(log.asked.at(-1)!.voice).toBe("pf_dora");
  });

  test("one text speaks at a time, in order; texts beyond the waiting room are told it is busy", async () => {
    const { engine, log } = fake(240, 25);
    const s = createLocalSynthesizer({ engine, maxWaiting: 2 });
    const done: number[] = [];
    const run = (i: number) => s.synthesize(`Text ${i}.`).then(() => done.push(i));
    const all = [run(1), run(2), run(3)];
    const busy = await fails(s.synthesize("Text 4."));
    expect(busy?.code).toBe("BUSY");
    await Promise.all(all);
    expect(done).toEqual([1, 2, 3]);
    expect(log.peak).toBe(1);
    // The room is free again afterwards.
    expect((await s.synthesize("Text 5.")).length).toBeGreaterThan(0);
  });

  test("a text that takes longer than the deadline fails, and the next one still speaks", async () => {
    let slow = true;
    const engine: LocalSpeechEngine = {
      async speak() {
        if (slow) await Bun.sleep(300);
        return { samples: new Float32Array(240), rate: 24_000 };
      },
    };
    const s = createLocalSynthesizer({ engine, deadlineMs: 40 });
    const e = await fails(s.synthesize("Too slow."));
    expect(e).toBeInstanceOf(SpeechError);
    expect(e?.code).toBe("FAILED");
    slow = false;
    expect((await s.synthesize("Quick.")).length).toBe(160);
  });

  test("a model that throws gives a fixed sentence, never its own message", async () => {
    const engine: LocalSpeechEngine = {
      speak: async () => {
        throw new Error("/secret/path/model.onnx missing");
      },
    };
    const e = await fails(createLocalSynthesizer({ engine }).synthesize("Hello."));
    expect(e?.code).toBe("FAILED");
    expect(e?.safe).not.toContain("secret");
  });

  test("cancel: between sentences it stops, while waiting it leaves, and a cancelled call never starts", async () => {
    const { engine, log } = fake(240, 20);
    const s = createLocalSynthesizer({ engine });
    const first = new AbortController();
    const heard: Int16Array[] = [];
    const run = (async () => {
      for await (const c of s.stream("One. Two. Three.", { signal: first.signal })) {
        heard.push(c);
        first.abort();
      }
    })();
    const waiting = new AbortController();
    const queued = fails(s.synthesize("Waits.", { signal: waiting.signal }));
    waiting.abort();
    expect((await queued)?.code).toBe("FAILED");
    expect((await fails(run))?.code).toBe("FAILED");
    expect(heard.length).toBe(1);
    expect(log.asked.map((a) => a.sentence)).toEqual(["One."]);
    const done = new AbortController();
    done.abort();
    expect((await fails(s.synthesize("Never.", { signal: done.signal })))?.code).toBe("FAILED");
    expect(log.asked.length).toBe(1);
    // The turn was handed back: the next text speaks at once.
    expect((await s.synthesize("Again.")).length).toBe(160);
  });

  test("empty text is silence and too long a text is refused", async () => {
    const { engine, log } = fake();
    const s = createLocalSynthesizer({ engine });
    expect((await s.synthesize("   ")).length).toBe(0);
    expect((await fails(s.synthesize("a ".repeat(2500))))?.code).toBe("TOO_LONG");
    expect(log.asked.length).toBe(0);
  });

  test("the removed variable has no effect: the local voice speaks whatever it says", async () => {
    const { engine, log } = fake();
    const s = createLocalSynthesizer({ engine });
    process.env.ZETTA_SPEECH_LOCAL = "off";
    try {
      expect((await s.synthesize("Hello.")).length).toBeGreaterThan(0);
    } finally {
      delete process.env.ZETTA_SPEECH_LOCAL;
    }
    expect(log.asked.length).toBe(1);
  });
});

describe("the configured synthesizer with the local provider", () => {
  const settings = (over: Partial<SpeechSettings>) => async () => ({
    ...DEFAULT_SPEECH_SETTINGS,
    ...over,
  });
  test("local speaks inside the server with the installation's voice, needs no key, and never calls fetch", async () => {
    const { engine, log } = fake(2400);
    const calls: string[] = [];
    const s = createConfiguredSynthesizer({
      settings: settings({ speechProvider: "local", speechVoice: "pm_alex" }),
      key: async () => undefined,
      local: createLocalSynthesizer({ engine }),
      fetch: (async (u: string) => (calls.push(u), new Response("no"))) as unknown as typeof fetch,
    });
    expect(await s.mode()).toBe("local");
    expect((await s.synthesize("Olá.", { language: "pt-BR" })).length).toBe(1600);
    expect(log.asked[0]!.voice).toBe("pm_alex");
    // The call's own voice wins over the installation's.
    await s.synthesize("Hola.", { voice: "ef_dora" });
    expect(log.asked[1]!.voice).toBe("ef_dora");
    expect(calls).toEqual([]);
  });
  test("local is the only provider that uses the model: the saved `speech_model` reaches it, a provider's own name does not", async () => {
    const { engine, log } = fake();
    const make = (speechModel: string) =>
      createConfiguredSynthesizer({
        settings: settings({ speechProvider: "local", speechModel }),
        key: async () => undefined,
        local: createLocalSynthesizer({ engine }),
      });
    await make("owner/Kokoro-other").synthesize("Hello.");
    expect(log.asked[0]!.model).toBe("owner/Kokoro-other");
    // Empty means the built-in default (the engine picks it); a provider's name such as `tts-1` is not a repository.
    await make("").synthesize("Hello.");
    expect(log.asked[1]!.model).toBeUndefined();
    expect(localSpeechModelOf("tts-1")).toBeUndefined();
    expect(localSpeechModelOf("owner/name")).toBe("owner/name");
    expect(localSpeechModelOf("../etc/passwd")).toBeUndefined();
  });
  test("the variables of the old switch and model do nothing: with another provider the local model never runs, with local the saved model wins", async () => {
    const { engine, log } = fake();
    process.env.ZETTA_SPEECH_LOCAL = "off";
    process.env.ZETTA_SPEECH_MODEL = "owner/from-env";
    try {
      const local = createConfiguredSynthesizer({
        settings: settings({ speechProvider: "local", speechModel: "owner/saved" }),
        key: async () => undefined,
        local: createLocalSynthesizer({ engine }),
      });
      await local.synthesize("Hello.");
      expect(log.asked[0]!.model).toBe("owner/saved");
      const other = createConfiguredSynthesizer({
        settings: settings({ speechProvider: "browser" }),
        key: async () => undefined,
        local: createLocalSynthesizer({ engine }),
      });
      expect((await fails(other.synthesize("Hello.")))?.code).toBe("BROWSER");
      expect(log.asked.length).toBe(1);
    } finally {
      delete process.env.ZETTA_SPEECH_LOCAL;
      delete process.env.ZETTA_SPEECH_MODEL;
    }
  });
  test("the mode of each provider", () => {
    expect(speechModeOf("local")).toBe("local");
    expect(speechModeOf("browser")).toBe("browser");
    expect(speechModeOf("openai")).toBe("remote");
    expect(speechModeOf("off")).toBe("off");
  });
});
