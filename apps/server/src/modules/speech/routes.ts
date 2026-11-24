import { SPEECH_LIMITS, SPEECH_NAME_PATTERN } from "@zetta/core/speech";
import { Elysia } from "elysia";
import { z } from "zod";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { speakableSentences } from "../voice/core/speakable";
import type { ConfiguredSynthesizer } from "./configured";
import { SpeechError } from "./errors";
import { pcm16ToWav } from "./pcm";

export type SpeechServices = {
  access: ReturnType<typeof createIdentityAccess>;
  speech: ConfiguredSynthesizer;
  /** The voice and language saved on a bot (`bot.voice`), for a person who may see it. Without it a `botId` is ignored. */
  botVoice?: (
    userId: string,
    botId: string,
  ) => Promise<{ voice?: string; language?: string } | undefined>;
};

/** A message to read aloud: the text of one bot message, as Markdown. */
export const SPEECH_INPUT_MAX = 20_000;
/** What one "Listen" speaks: about a minute and a half. A longer message is cut at the end of a sentence. */
export const LISTEN_MAX_CHARS = 1500;
export const SPEECH_PER_MINUTE = 20;

const body = z.strictObject({
  text: z.string().min(1).max(SPEECH_INPUT_MAX),
  /** The bot's own voice, when it has one: the provider's own name or id. Empty: the installation's. */
  voice: z.string().max(SPEECH_LIMITS.voice).regex(SPEECH_NAME_PATTERN).optional(),
  /** The language of the text ("pt-BR"). */
  language: z.string().max(SPEECH_LIMITS.language).optional(),
  /** The bot whose message this is: when no voice is given, the voice saved on the bot is used (it is kept on the server). */
  botId: z.string().uuid().optional(),
});

const STATUS: Record<SpeechError["code"], number> = {
  OFF: 409,
  BROWSER: 409,
  TOO_LONG: 413,
  BUSY: 429,
  PROVIDER_AUTH: 502,
  NOT_CONFIGURED: 503,
  FAILED: 502,
};

/** The sentences to speak, up to the limit: whole sentences while they fit, the start of the first one when even it does not. */
export function listenText(markdown: string): { text: string; truncated: boolean } {
  const sentences = speakableSentences(markdown);
  const kept: string[] = [];
  let used = 0;
  for (const s of sentences) {
    const next = used + s.length + (kept.length ? 1 : 0);
    if (next > LISTEN_MAX_CHARS) break;
    kept.push(s);
    used = next;
  }
  if (!kept.length && sentences[0])
    return { text: sentences[0].slice(0, LISTEN_MAX_CHARS), truncated: true };
  return { text: kept.join(" "), truncated: kept.length < sentences.length };
}

/**
 * `POST /api/speech`: the text of one bot message to audio, for the "Listen" button. With a provider it answers WAV (16 kHz mono); with
 * `browser` it answers `{ mode: "browser", text }` and the page speaks it with the device's own voice. At most a few requests a minute per
 * person: every call costs money at a provider.
 */
export function createSpeechRoutes(
  { access, speech, botVoice }: SpeechServices,
  trustedOrigins: readonly string[],
) {
  const calls = new Map<string, number[]>();
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof SpeechError) return fail(STATUS[e.code], `SPEECH_${e.code}`, e.safe);
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Send the text to read aloud.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  return new Elysia({ prefix: "/api", normalize: false }).post(
    "/speech",
    async ({ request, body: raw }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        const actor = await access.requireActive(request.headers);
        const v = body.parse(raw);
        const mode = await speech.mode();
        if (mode === "off") throw new SpeechError("OFF", "Text to speech is switched off.");
        const now = Date.now();
        const recent = (calls.get(actor.userId) ?? []).filter((t) => now - t < 60_000);
        if (recent.length >= SPEECH_PER_MINUTE)
          throw new SpeechError("BUSY", "That was a lot of requests. Wait a minute and try again.");
        calls.set(actor.userId, [...recent, now]);
        const { text, truncated } = listenText(v.text);
        if (!text)
          return fail(400, "NOTHING_TO_SAY", "There is nothing in that message to read aloud.");
        if (mode === "browser") return out({ mode: "browser", text, truncated });
        const saved =
          !v.voice && v.botId && botVoice ? await botVoice(actor.userId, v.botId) : undefined;
        const pcm = await speech.synthesize(text, {
          voice: v.voice || saved?.voice,
          language: v.language || saved?.language,
        });
        return new Response(pcm16ToWav(pcm), {
          headers: {
            "content-type": "audio/wav",
            "cache-control": "no-store",
            "x-speech-truncated": truncated ? "1" : "0",
          },
        });
      } catch (e) {
        return mapError(e);
      }
    },
  );
}
