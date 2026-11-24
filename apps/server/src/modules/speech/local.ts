import { dataDir } from "@zetta/core/zetta-home";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SAMPLE_RATE, floatToPcm16, resample } from "../voice/core/audio";
import { speakableSentences } from "../voice/core/speakable";
import type { SynthesizeOptions, Synthesizer } from "../voice/core/types";
import { SpeechError } from "./errors";

/**
 * Text to speech that runs inside the server: Kokoro-82M (Apache-2.0) through @huggingface/transformers, the same runtime as local
 * Whisper, with eSpeak NG (WASM, in the `espeak-ng` package) turning the text into phonemes. No key, nothing leaves the machine after
 * the one download. Kokoro v1.0 has American and British English, Spanish and Brazilian Portuguese voices.
 *
 * The files download once into ZETTA_SPEECH_MODEL_DIR (default: the transcribe model folder, then ~/.cache/zetta/models; pre-seed it for
 * an offline server). The installation's `speech_model` (Studio > Voice) picks another Kokoro ONNX repository; empty means the
 * default. It runs only when the provider is `local`: choosing another provider is what turns it off. The model loads on first use and
 * speaks one text at a time; a few others wait their turn, more are told the server is busy.
 */
export const LOCAL_SPEECH_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
/**
 * A model chosen by the administrator is a Hugging Face repository (`owner/name`). Anything else (a provider's model name such as
 * `tts-1`, left in the field from an earlier choice) is ignored by the voice that runs on this server.
 */
export const localSpeechModelOf = (name: string | undefined) =>
  name && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name) ? name : undefined;
/** Kokoro's own rate; the audio is brought to 16 kHz before it leaves this file. */
export const LOCAL_SPEECH_RATE = 24_000;
export const LOCAL_DEFAULT_VOICES = { en: "af_heart", es: "ef_dora", pt: "pf_dora" } as const;
/** The Kokoro voices this adapter knows how to phonemize, by the first letter of their id: American/British English, Spanish, Portuguese. */
const VOICE_LANGUAGE: Record<string, { lang: "en" | "es" | "pt"; espeak: string }> = {
  a: { lang: "en", espeak: "en-us" },
  b: { lang: "en", espeak: "en-gb" },
  e: { lang: "es", espeak: "es" },
  p: { lang: "pt", espeak: "pt-br" },
};
const VOICE_ID = /^[abep][fm]_[a-z]+$/;
/** One style vector is 256 floats; a voice file holds one per token count (510). */
const STYLE_ROWS = 510;
const STYLE_DIM = 256;
const VOICE_BYTES = STYLE_ROWS * STYLE_DIM * 4;
/** The model reads at most 510 phoneme tokens at once: longer sentences are cut at a space. */
export const MAX_PHONEME_CHARS = 400;
/** One text speaks at most this long, then the call fails (a stuck model must not hold the line). */
export const LOCAL_DEADLINE_MS = 120_000;
/** Waiting texts after the one that is speaking; more than this answer BUSY. */
export const LOCAL_MAX_WAITING = 4;
export const LOCAL_MAX_TEXT_CHARS = 4000;

/** What runs the model: a text and a voice to samples. Replaced by a fake in tests. */
export type LocalSpeechEngine = {
  /** Phoneme text of one sentence in the voice's language to float samples at `rate`. */
  speak(
    sentence: string,
    voice: string,
    /** A Kokoro ONNX repository, instead of the default. */
    model?: string,
  ): Promise<{ samples: Float32Array; rate: number }>;
};

export type VoicePick = { voice: string; lang: "en" | "es" | "pt"; espeak: string };

/** The voice to use: the asked one if it is a Kokoro voice we know, else the default of the text's language, else English. */
export function pickLocalVoice(voice: string | undefined, language: string | undefined): VoicePick {
  const asked = (voice ?? "").trim();
  if (VOICE_ID.test(asked)) {
    const info = VOICE_LANGUAGE[asked[0]!]!;
    return { voice: asked, ...info };
  }
  const base = (language ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  const lang = base === "pt" || base === "es" ? base : "en";
  const voiceId = LOCAL_DEFAULT_VOICES[lang];
  return { voice: voiceId, ...VOICE_LANGUAGE[voiceId[0]!]! };
}

const HINTS: Record<"en" | "es" | "pt", RegExp> = {
  en: /\b(the|and|you|is|are|to|of|that|with|for|this|it|my|me|please)\b/gi,
  es: /\b(el|la|los|las|que|de|y|es|en|un|una|para|con|por|no|me|te|se|está|mañana)\b/gi,
  pt: /\b(o|a|os|as|que|de|e|é|em|um|uma|para|com|por|não|me|te|se|está|você|amanhã|já)\b/gi,
};
/** The language of a text with no language given: whichever of English, Spanish and Portuguese has the most common words. English on a tie. */
export function guessLanguage(text: string): "en" | "es" | "pt" {
  const score = (l: keyof typeof HINTS) => (text.match(HINTS[l]) ?? []).length;
  const best = (["pt", "es", "en"] as const).reduce((a, b) => (score(b) > score(a) ? b : a), "en");
  return /[ãõç]/i.test(text) && score("pt") >= score(best) ? "pt" : best;
}

/** Sentences short enough for the model, each at most `max` characters, cut at a space (or hard when there is none). */
export function splitForModel(text: string, max = MAX_PHONEME_CHARS): string[] {
  const out: string[] = [];
  for (const s of speakableSentences(text)) {
    let rest = s.trim();
    while (rest.length > max) {
      const cut = rest.lastIndexOf(" ", max);
      const at = cut > max / 2 ? cut : max;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

const cacheDirOf = (override?: string) =>
  override ??
  process.env.ZETTA_SPEECH_MODEL_DIR ??
  process.env.ZETTA_TRANSCRIBE_MODEL_DIR ??
  process.env.ZETTA_EMBEDDING_MODEL_DIR ??
  dataDir("cache/models", join(homedir(), ".cache", "zetta", "models"));

/** Phonemes of one sentence by eSpeak NG, written the way Kokoro was trained on them (as misaki and kokoro-js do for non-English text). */
export async function phonemize(text: string, espeakVoice: string): Promise<string> {
  const { default: ESpeakNg } = await import("espeak-ng");
  const espeak = await ESpeakNg({
    arguments: ["--phonout", "out", "--sep=", "-q", "--ipa=3", "-v", espeakVoice, text],
    print() {},
    printErr() {},
  });
  const raw = espeak.FS.readFile("out", { encoding: "utf8" }) as string;
  return raw
    .replace(/‍/g, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .trim();
}

async function fetchVoice(
  file: string,
  repo: string,
  fetcher: typeof fetch,
): Promise<Float32Array> {
  if (!existsSync(file)) {
    const res = await fetcher(
      `https://huggingface.co/${repo}/resolve/main/voices/${file.split("/").pop()}`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!res.ok) throw new Error(`voice download ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length !== VOICE_BYTES) throw new Error("voice file has an unexpected size");
    mkdirSync(dirname(file), { recursive: true });
    // Written beside and renamed, so a cut download never leaves a half file that looks complete.
    const part = `${file}.part`;
    writeFileSync(part, bytes);
    renameSync(part, file);
  }
  const buf = readFileSync(file);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
}

/**
 * Loads Kokoro through transformers.js. `dtype` is the model's precision: `q8` (about 92 MB, the default), `fp16` (163 MB) or `fp32`
 * (325 MB).
 */
export function createKokoroEngine(
  opts: {
    cacheDir?: string;
    model?: string;
    dtype?: "q8" | "fp16" | "fp32";
    fetch?: typeof fetch;
  } = {},
): LocalSpeechEngine {
  type Loaded = {
    run: (ids: unknown, style: Float32Array) => Promise<Float32Array>;
    tokenize: (phonemes: string) => unknown;
    ids: (t: unknown) => number;
  };
  // One model in memory at a time: choosing another drops the one that was loaded, and its voices with it.
  let loaded: { repo: string; model: Promise<Loaded> } | undefined;
  let voices = new Map<string, Promise<Float32Array>>();
  const dir = cacheDirOf(opts.cacheDir);
  const load = (repo: string) => {
    if (loaded?.repo !== repo) {
      loaded = undefined;
      voices = new Map();
    }
    const mine = (loaded ??= { repo, model: undefined as never });
    mine.model ??= (async (): Promise<Loaded> => {
      const tf = await import("@huggingface/transformers");
      tf.env.cacheDir = dir;
      const [model, tokenizer] = await Promise.all([
        tf.StyleTextToSpeech2Model.from_pretrained(repo, { dtype: opts.dtype ?? "q8" }),
        tf.AutoTokenizer.from_pretrained(repo),
      ]);
      return {
        tokenize: (p) => (tokenizer(p, { truncation: true }) as { input_ids: unknown }).input_ids,
        ids: (t) => (t as { dims: number[] }).dims.at(-1) ?? 0,
        run: async (ids, style) => {
          const out = (await model({
            input_ids: ids,
            style: new tf.Tensor("float32", style, [1, STYLE_DIM]),
            speed: new tf.Tensor("float32", [1], [1]),
          })) as { waveform: { data: Float32Array } };
          return out.waveform.data;
        },
      };
    })().catch((e) => {
      if (loaded === mine) loaded = undefined; // a failed download is tried again on the next text
      throw e;
    });
    return mine.model;
  };
  return {
    async speak(sentence, voice, asked) {
      const repo = localSpeechModelOf(asked) ?? opts.model ?? LOCAL_SPEECH_MODEL;
      const pick = pickLocalVoice(voice, undefined);
      const m = await load(repo);
      const phonemes = await phonemize(sentence, pick.espeak);
      if (!phonemes) return { samples: new Float32Array(0), rate: LOCAL_SPEECH_RATE };
      const ids = m.tokenize(phonemes);
      const loadedVoices = voices;
      const style = await (loadedVoices.get(pick.voice) ??
        (() => {
          const p = fetchVoice(
            join(dir, repo, "voices", `${pick.voice}.bin`),
            repo,
            opts.fetch ?? fetch,
          );
          loadedVoices.set(pick.voice, p);
          p.catch(() => loadedVoices.delete(pick.voice));
          return p;
        })());
      const at = STYLE_DIM * Math.min(Math.max(m.ids(ids) - 2, 0), STYLE_ROWS - 1);
      return {
        samples: await m.run(ids, style.slice(at, at + STYLE_DIM)),
        rate: LOCAL_SPEECH_RATE,
      };
    },
  };
}

/**
 * The local synthesizer. One text speaks at a time (the model uses most of the machine); up to `maxWaiting` others wait, the rest get
 * BUSY. Each sentence is a chunk, so the first sound plays after one sentence, not after the whole text. A text that runs past the
 * deadline, or whose caller cancels, stops between sentences.
 */
export function createLocalSynthesizer(
  deps: {
    engine?: LocalSpeechEngine;
    cacheDir?: string;
    deadlineMs?: number;
    maxWaiting?: number;
  } = {},
): Synthesizer {
  const engine = deps.engine ?? createKokoroEngine({ cacheDir: deps.cacheDir });
  let busy = false;
  const waiting: Array<() => void> = [];
  const acquire = async (signal?: AbortSignal) => {
    if (!busy) {
      busy = true;
      return;
    }
    if (waiting.length >= (deps.maxWaiting ?? LOCAL_MAX_WAITING))
      throw new SpeechError("BUSY", "The voice on this server is busy. Try again in a moment.");
    await new Promise<void>((resolve, reject) => {
      const turn = () => {
        signal?.removeEventListener("abort", leave);
        resolve();
      };
      const leave = () => {
        const i = waiting.indexOf(turn);
        if (i >= 0) waiting.splice(i, 1);
        reject(new SpeechError("FAILED", "The speech was cancelled."));
      };
      waiting.push(turn);
      signal?.addEventListener("abort", leave, { once: true });
    });
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else busy = false;
  };
  async function* stream(text: string, o?: SynthesizeOptions): AsyncGenerator<Int16Array> {
    const spoken = text.trim();
    if (!spoken) return;
    if (spoken.length > LOCAL_MAX_TEXT_CHARS)
      throw new SpeechError(
        "TOO_LONG",
        `One request can speak up to ${LOCAL_MAX_TEXT_CHARS} characters.`,
      );
    if (o?.signal?.aborted) throw new SpeechError("FAILED", "The speech was cancelled.");
    await acquire(o?.signal);
    const started = Date.now();
    const limit = deps.deadlineMs ?? LOCAL_DEADLINE_MS;
    try {
      const pick = pickLocalVoice(o?.voice, o?.language || guessLanguage(spoken));
      let total = 0;
      for (const sentence of splitForModel(spoken)) {
        if (o?.signal?.aborted) throw new SpeechError("FAILED", "The speech was cancelled.");
        const left = limit - (Date.now() - started);
        if (left <= 0) throw new SpeechError("FAILED", "The voice took too long.");
        let timer: ReturnType<typeof setTimeout> | undefined;
        const out = await Promise.race([
          engine.speak(sentence, pick.voice, o?.model),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new SpeechError("FAILED", "The voice took too long.")),
              left,
            );
          }),
        ])
          .catch((e: unknown) => {
            if (e instanceof SpeechError) throw e;
            throw new SpeechError(
              "FAILED",
              "The voice model could not run. Try again in a moment.",
            );
          })
          .finally(() => clearTimeout(timer));
        if (!out.samples.length) continue;
        const pcm = floatToPcm16(out.samples);
        const chunk = out.rate === SAMPLE_RATE ? pcm : resample(pcm, out.rate, SAMPLE_RATE);
        total += chunk.length;
        yield chunk;
      }
      if (!total) throw new SpeechError("FAILED", "The voice produced no audio.");
    } finally {
      release();
    }
  }
  return {
    stream,
    async synthesize(text, o) {
      const chunks: Int16Array[] = [];
      for await (const c of stream(text, o)) chunks.push(c);
      const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    },
  };
}
