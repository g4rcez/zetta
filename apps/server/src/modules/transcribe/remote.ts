import { assertPublicUrl } from "../computer/service";
import { languageCode, SAMPLE_RATE, TranscribeError, type Transcriber } from "./transcriber";

/**
 * Speech to text through a provider that speaks OpenAI's `/audio/transcriptions`: OpenAI itself, or any server that copies it (Groq, a
 * self-hosted Whisper server). The recording leaves this machine for that address, so the administrator chooses it on purpose (Studio >
 * Decisions) and the page says so.
 *
 * Safety: the address goes through the same private-network rule as every address a person types (`assertPublicUrl`, unless the
 * administrator allowed private networks); redirects are refused so the key cannot follow one; the key is read only for the call and
 * zeroed after; nothing the provider says (status text, body) is passed on, only a fixed sentence; size and time are capped.
 */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_DEFAULT_MODEL = "whisper-1";
/** OpenAI accepts 25 MB; five minutes of 16 kHz mono 16-bit is 9.6 MB. */
const MAX_WAV_BYTES = 24 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1_000_000;
const DEADLINE_MS = 120_000;

export type RemoteSettings = {
  provider: "openai" | "compatible";
  baseUrl: string;
  model: string;
  /** The key, as bytes: the caller's buffer, zeroed here after the call. */
  key: Buffer;
};

/** 16 kHz mono 16-bit WAV of float samples between -1 and 1. */
export function encodeWav(pcm: Float32Array): Uint8Array {
  const data = pcm.length * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, data, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** The `/audio/transcriptions` address of a base URL ("https://host/v1" or "https://host/v1/"). */
export const transcriptionsUrl = (baseUrl: string) =>
  `${baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;

function failFor(status: number) {
  if (status === 401 || status === 403)
    return new TranscribeError(
      "PROVIDER_AUTH",
      "The speech-to-text provider did not accept the API key. Check it in Studio > Decisions.",
    );
  if (status === 429)
    return new TranscribeError(
      "BUSY",
      "The speech-to-text provider is limiting requests. Try again in a moment.",
    );
  if (status === 413)
    return new TranscribeError(
      "TOO_BIG",
      "That recording is too big for the speech-to-text provider.",
    );
  return new TranscribeError(
    "FAILED",
    "The speech-to-text provider could not turn that into text.",
  );
}

export function createRemoteTranscriber(deps: {
  /** What to call, read on every recording so a changed setting applies at once. Throws a TranscribeError when it cannot say. */
  resolve: () => Promise<RemoteSettings>;
  /** The default language when the call names none. */
  defaultLanguage?: () => string | undefined;
  allowPrivate?: boolean;
  fetch?: typeof fetch;
  deadlineMs?: number;
}): Transcriber {
  const doFetch = deps.fetch ?? fetch;
  return {
    async transcribe(pcm, o) {
      if (process.env.ZETTA_TRANSCRIBE === "off")
        throw new TranscribeError(
          "DISABLED",
          "Turning speech into text is switched off on this server.",
        );
      const wav = encodeWav(pcm);
      if (wav.byteLength > MAX_WAV_BYTES)
        throw new TranscribeError("TOO_LONG", "A recording can be up to 5 minutes.");
      const cfg = await deps.resolve();
      try {
        const url = transcriptionsUrl(cfg.baseUrl);
        if (!deps.allowPrivate)
          await assertPublicUrl(url).catch(() => {
            throw new TranscribeError(
              "NOT_CONFIGURED",
              "That speech-to-text address is not allowed: private addresses must be enabled by the administrator.",
            );
          });
        const form = new FormData();
        form.set("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
        form.set("model", cfg.model || OPENAI_DEFAULT_MODEL);
        form.set("response_format", "json");
        const code = languageCode(o?.language) ?? languageCode(deps.defaultLanguage?.());
        if (code) form.set("language", code);
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), deps.deadlineMs ?? DEADLINE_MS);
        const outside = o?.signal;
        if (outside?.aborted) {
          clearTimeout(timer);
          throw new TranscribeError("FAILED", "The recording was cancelled.");
        }
        const onAbort = () => ctl.abort();
        outside?.addEventListener("abort", onAbort, { once: true });
        try {
          const res = await doFetch(url, {
            method: "POST",
            redirect: "error",
            signal: ctl.signal,
            headers: { authorization: `Bearer ${cfg.key.toString("utf8")}` },
            body: form,
          }).catch((e: unknown) => {
            throw new TranscribeError(
              "FAILED",
              (e as { name?: string } | null)?.name === "AbortError"
                ? "Turning the recording into text took too long."
                : "The speech-to-text provider could not be reached.",
            );
          });
          if (!res.ok) throw failFor(res.status);
          const raw = await res.text();
          if (raw.length > MAX_RESPONSE_BYTES)
            throw new TranscribeError(
              "FAILED",
              "The speech-to-text provider gave an answer that is too large.",
            );
          let text: unknown;
          try {
            text = (JSON.parse(raw) as { text?: unknown }).text;
          } catch {
            text = undefined;
          }
          if (typeof text !== "string")
            throw new TranscribeError(
              "FAILED",
              "The speech-to-text provider gave an answer that could not be read.",
            );
          return text.trim();
        } finally {
          clearTimeout(timer);
          outside?.removeEventListener("abort", onAbort);
        }
      } finally {
        cfg.key.fill(0);
      }
    },
  };
}
