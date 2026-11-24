import { assertPublicUrl } from "../computer/service";
import { privateAllowed, type PrivateNetwork } from "../settings/private-network";
import { SAMPLE_RATE } from "../voice/core/audio";
import type { SynthesizeOptions, Synthesizer } from "../voice/core/types";
import { SpeechError } from "./errors";
import { createPcmNormalizer } from "./pcm";

/**
 * Text to speech through a provider: OpenAI's `/audio/speech` (OpenAI itself, or any server that copies it), or ElevenLabs' streaming
 * endpoint. The text leaves this machine for that address, so the administrator chooses it on purpose (Studio > Voice) and the page
 * says so. Both are asked for raw 16-bit PCM and the audio is passed on as it arrives.
 *
 * Safety, as for speech to text: an address someone typed goes through the private-network rule (`assertPublicUrl`, unless the
 * operator allowed private networks); redirects are refused so the key cannot follow one; the key is read for the call and zeroed after;
 * nothing the provider says (status text, body) is passed on, only a fixed sentence; text, size and time are capped.
 */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini-tts";
/** `alloy` exists on every OpenAI speech model (the newer voices exist only on `gpt-4o-mini-tts`). */
export const OPENAI_DEFAULT_VOICE = "alloy";
/** What servers that copy OpenAI's API usually answer to when nothing else is said. */
export const COMPATIBLE_DEFAULT_MODEL = "tts-1";
/** OpenAI's `pcm` format: raw 24 kHz, 16-bit signed, little-endian, no header. A server that copies the API is assumed to do the same. */
export const OPENAI_PCM_RATE = 24_000;

export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
/** Low latency, 32 languages including Portuguese and Spanish. */
export const ELEVENLABS_DEFAULT_MODEL = "eleven_flash_v2_5";
/** "Rachel", one of the premade voices; the administrator can choose any voice id of their own account. */
export const ELEVENLABS_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

/** One call speaks up to this many characters (about two minutes of audio). The caller splits longer text by sentence. */
export const MAX_TEXT_CHARS = 4000;
const MAX_AUDIO_BYTES = 48 * 1024 * 1024;
const DEADLINE_MS = 60_000;

export type RemoteSpeech = {
  provider: "openai" | "compatible" | "elevenlabs";
  baseUrl: string;
  model: string;
  voice: string;
  /** The language of the text (a tag or its first part), when known: a hint for providers that take one. */
  language?: string;
  /** The key, as bytes: the caller's buffer, zeroed here after the call. */
  key: Buffer;
};

/** The request a provider is sent: its address, headers, JSON body and the rate of the audio it answers with. */
export function speechRequest(cfg: Omit<RemoteSpeech, "key">, text: string, language?: string) {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  if (cfg.provider === "elevenlabs") {
    const voice = cfg.voice || ELEVENLABS_DEFAULT_VOICE;
    const model = cfg.model || ELEVENLABS_DEFAULT_MODEL;
    return {
      url: `${base}/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=pcm_16000`,
      keyHeader: "xi-api-key",
      keyPrefix: "",
      rate: SAMPLE_RATE,
      body: {
        text,
        model_id: model,
        // The multilingual v2 models do not take a language code; the others use it to pick the language of a short text.
        ...(language && !/multilingual_v2/.test(model) ? { language_code: language } : {}),
      },
    };
  }
  return {
    url: `${base}/audio/speech`,
    keyHeader: "authorization",
    keyPrefix: "Bearer ",
    rate: OPENAI_PCM_RATE,
    body: {
      model:
        cfg.model || (cfg.provider === "openai" ? OPENAI_DEFAULT_MODEL : COMPATIBLE_DEFAULT_MODEL),
      input: text,
      voice: cfg.voice || OPENAI_DEFAULT_VOICE,
      response_format: "pcm",
    },
  };
}

function failFor(status: number) {
  if (status === 401 || status === 403)
    return new SpeechError(
      "PROVIDER_AUTH",
      "The text-to-speech provider did not accept the API key. Check it in Studio > Voice.",
    );
  if (status === 429)
    return new SpeechError(
      "BUSY",
      "The text-to-speech provider is limiting requests. Try again in a moment.",
    );
  if (status === 413)
    return new SpeechError("TOO_LONG", "That text is too long for the text-to-speech provider.");
  return new SpeechError("FAILED", "The text-to-speech provider could not speak that.");
}

const collect = (chunks: Int16Array[]) => {
  const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};

export function createRemoteSynthesizer(deps: {
  /** What to call, read on every request so a changed setting applies at once. Throws a SpeechError when it cannot say. */
  resolve: (opts?: SynthesizeOptions) => Promise<RemoteSpeech>;
  /** Private addresses: a fixed answer, or a function asked at every request (the setting `allowPrivateNetwork`). */
  allowPrivate?: PrivateNetwork;
  fetch?: typeof fetch;
  deadlineMs?: number;
}): Synthesizer {
  const doFetch = deps.fetch ?? fetch;
  async function* stream(text: string, o?: SynthesizeOptions): AsyncGenerator<Int16Array> {
    const spoken = text.trim();
    if (!spoken) return;
    if (spoken.length > MAX_TEXT_CHARS)
      throw new SpeechError(
        "TOO_LONG",
        `One request can speak up to ${MAX_TEXT_CHARS} characters.`,
      );
    const cfg = await deps.resolve(o);
    const ctl = new AbortController();
    const outside = o?.signal;
    const onAbort = () => ctl.abort();
    const timer = setTimeout(() => ctl.abort(), deps.deadlineMs ?? DEADLINE_MS);
    try {
      const req = speechRequest(cfg, spoken, cfg.language?.slice(0, 2).toLowerCase() || undefined);
      if (cfg.provider === "compatible" && !(await privateAllowed(deps.allowPrivate)))
        await assertPublicUrl(req.url).catch(() => {
          throw new SpeechError(
            "NOT_CONFIGURED",
            "That text-to-speech address is not allowed: private addresses must be enabled by the administrator.",
          );
        });
      if (outside?.aborted) throw new SpeechError("FAILED", "The speech was cancelled.");
      outside?.addEventListener("abort", onAbort, { once: true });
      const res = await doFetch(req.url, {
        method: "POST",
        redirect: "error",
        signal: ctl.signal,
        headers: {
          "content-type": "application/json",
          [req.keyHeader]: `${req.keyPrefix}${cfg.key.toString("utf8")}`,
        },
        body: JSON.stringify(req.body),
      }).catch((e: unknown) => {
        throw new SpeechError(
          "FAILED",
          (e as { name?: string } | null)?.name === "AbortError"
            ? outside?.aborted
              ? "The speech was cancelled."
              : "The text-to-speech provider took too long."
            : "The text-to-speech provider could not be reached.",
        );
      });
      // The key was used for this request and for nothing else: it can go now.
      cfg.key.fill(0);
      if (!res.ok) throw failFor(res.status);
      if (!res.body) throw new SpeechError("FAILED", "The text-to-speech provider sent no audio.");
      const normal = createPcmNormalizer(req.rate);
      const reader = res.body.getReader();
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read().catch((e: unknown) => {
          throw new SpeechError(
            "FAILED",
            (e as { name?: string } | null)?.name === "AbortError" && outside?.aborted
              ? "The speech was cancelled."
              : "The text-to-speech audio was cut off.",
          );
        });
        if (done) break;
        total += value.length;
        if (total > MAX_AUDIO_BYTES)
          throw new SpeechError("FAILED", "The text-to-speech provider sent too much audio.");
        const pcm = normal.push(value);
        if (pcm.length) yield pcm;
      }
      const rest = normal.flush();
      if (rest.length) yield rest;
      if (!total) throw new SpeechError("FAILED", "The text-to-speech provider sent no audio.");
    } finally {
      clearTimeout(timer);
      outside?.removeEventListener("abort", onAbort);
      ctl.abort();
      cfg.key.fill(0);
    }
  }
  return {
    stream,
    async synthesize(text, o) {
      const chunks: Int16Array[] = [];
      for await (const c of stream(text, o)) chunks.push(c);
      return collect(chunks);
    },
  };
}
