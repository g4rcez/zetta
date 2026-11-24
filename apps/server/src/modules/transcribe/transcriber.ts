import { homedir } from "node:os";
import { dataDir } from "@zetta/core/zetta-home";
import { join } from "node:path";

/** Why a recording could not be turned into text. `safe` is a sentence for the person. */
export class TranscribeError extends Error {
  constructor(
    readonly code:
      | "DISABLED"
      | "TOO_LONG"
      | "TOO_BIG"
      | "NO_DECODER"
      | "UNREADABLE"
      | "BUSY"
      | "PROVIDER_AUTH"
      | "NOT_CONFIGURED"
      | "FAILED",
    readonly safe: string,
  ) {
    super(code);
  }
}

/** 16 kHz mono: what Whisper reads. Every recording is brought to this before it gets here. */
export const SAMPLE_RATE = 16_000;
export const MAX_AUDIO_SECONDS = 300;
export const MAX_SAMPLES = SAMPLE_RATE * MAX_AUDIO_SECONDS;

/** Speech to text. `pcm` is 16 kHz mono floats between -1 and 1. */
export type Transcriber = {
  /** `language` is a BCP 47 tag or its first part ("pt-BR", "pt"): Whisper assumes English when it is not told. */
  transcribe(
    pcm: Float32Array,
    opts?: { signal?: AbortSignal; language?: string; model?: string },
  ): Promise<string>;
};

/**
 * A Whisper model chosen by an operator is a Hugging Face repository (`owner/name`). Anything else (a provider's name such as `whisper-1`,
 * left in the field from an earlier choice) is ignored by the model that runs on this server.
 */
export const localModelOf = (name: string | undefined) =>
  name && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name) ? name : undefined;

/**
 * The small model, not the base one: tried on Portuguese speech, `base` was unusable and `small` close. About 250 MB once.
 * Without a language Whisper assumes English, and the small model can then loop on one word, so a language is always passed when known.
 */
export const TRANSCRIBE_MODEL = "Xenova/whisper-small";

const LANGUAGES: Record<string, string> = {
  en: "english",
  pt: "portuguese",
  es: "spanish",
  fr: "french",
  de: "german",
  it: "italian",
  nl: "dutch",
  pl: "polish",
  ru: "russian",
  uk: "ukrainian",
  tr: "turkish",
  ar: "arabic",
  hi: "hindi",
  ja: "japanese",
  ko: "korean",
  zh: "chinese",
  sv: "swedish",
  da: "danish",
  fi: "finnish",
  no: "norwegian",
  cs: "czech",
  el: "greek",
  he: "hebrew",
  id: "indonesian",
  vi: "vietnamese",
  ro: "romanian",
  hu: "hungarian",
  ca: "catalan",
};
/** The two-letter code of a language tag or Whisper name ("pt-BR", "portuguese" -> "pt"), for providers that take ISO 639-1. */
export const languageCode = (tag: string | undefined) => {
  const name = whisperLanguage(tag);
  return name ? Object.keys(LANGUAGES).find((k) => LANGUAGES[k] === name) : undefined;
};
/** Whisper's name for a language tag, or undefined when it is not one it knows (it then guesses English). */
export const whisperLanguage = (tag: string | undefined) => {
  const base = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return LANGUAGES[base] ?? (Object.values(LANGUAGES).includes(base) ? base : undefined);
};
const DEADLINE_MS = 120_000;

/**
 * The speech model runs inside the server process (ONNX through @huggingface/transformers, like the embedding model): no API key, and
 * the audio never leaves the machine. The files download once into ZETTA_TRANSCRIBE_MODEL_DIR (default ~/.cache/zetta/models; pre-seed
 * it for an offline server). The model is the installation's `transcribe_model` (Studio > Voice; empty means the default). It
 * loads on first use and works on one recording at a time; others wait their turn. The provider `off` is decided before it gets here.
 */
export function createLocalTranscriber(
  opts: {
    cacheDir?: string;
    /** A Whisper ONNX repository, instead of the default. */
    model?: string;
    recognizer?: (pcm: Float32Array, language?: string) => Promise<string>;
  } = {},
): Transcriber {
  type Recognizer = (pcm: Float32Array, language?: string) => Promise<string>;
  // One model in memory at a time: choosing another drops the one that was loaded.
  let loaded: { model: string; recognizer: Promise<Recognizer> } | undefined;
  let turn: Promise<unknown> = Promise.resolve();
  const load = (asked?: string) => {
    const model = localModelOf(asked) ?? opts.model ?? TRANSCRIBE_MODEL;
    if (loaded?.model !== model) loaded = undefined;
    const recognizer = (loaded ??= {
      model,
      recognizer: opts.recognizer
        ? Promise.resolve(opts.recognizer)
        : (async () => {
            const { pipeline, env } = await import("@huggingface/transformers");
            env.cacheDir =
              opts.cacheDir ??
              process.env.ZETTA_TRANSCRIBE_MODEL_DIR ??
              process.env.ZETTA_EMBEDDING_MODEL_DIR ??
              dataDir("cache/models", join(homedir(), ".cache", "zetta", "models"));
            const asr = await pipeline("automatic-speech-recognition", model, { dtype: "q8" });
            return async (pcm: Float32Array, language?: string) => {
              const out = (await asr(pcm, {
                chunk_length_s: 30,
                stride_length_s: 5,
                task: "transcribe",
                ...(language ? { language } : {}),
                // A pass of 30 seconds is about 120 words; this stops a runaway loop on one word.
                max_new_tokens: 220,
                no_repeat_ngram_size: 6,
              })) as { text?: string } | { text?: string }[];
              return (
                Array.isArray(out) ? out.map((o) => o.text ?? "").join(" ") : (out.text ?? "")
              ).trim();
            };
          })().catch((e) => {
            if (loaded?.model === model) loaded = undefined; // a failed download is tried again on the next recording
            throw e;
          }),
    });
    return recognizer.recognizer;
  };
  return {
    async transcribe(pcm, o) {
      if (pcm.length > MAX_SAMPLES)
        throw new TranscribeError("TOO_LONG", "A recording can be up to 5 minutes.");
      // One recording at a time: the model uses most of the machine, and a second one would only make both slow.
      const mine = turn.then(async () => {
        if (o?.signal?.aborted) throw new TranscribeError("FAILED", "The recording was cancelled.");
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const run = await load(o?.model);
          return await Promise.race([
            run(pcm, whisperLanguage(o?.language)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new TranscribeError("FAILED", "Turning the recording into text took too long."),
                  ),
                DEADLINE_MS,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      });
      turn = mine.catch(() => undefined);
      try {
        return await mine;
      } catch (e) {
        if (e instanceof TranscribeError) throw e;
        throw new TranscribeError(
          "FAILED",
          "The speech model could not run. Try again in a moment.",
        );
      }
    },
  };
}
