import type { SpeechProvider, SpeechSettings } from "@zetta/core/speech";
import type { PrivateNetwork } from "../settings/private-network";
import { speechIsLocal, speechIsRemote } from "@zetta/core/speech";
import type { SynthesizeOptions, Synthesizer } from "../voice/core/types";
import { SpeechError } from "./errors";
import { createLocalSynthesizer } from "./local";
import { ELEVENLABS_BASE_URL, OPENAI_BASE_URL, createRemoteSynthesizer } from "./remote";

export const NO_SPEECH_KEY = new SpeechError(
  "NOT_CONFIGURED",
  "The API key for text to speech is not available. An administrator must enter it again in Studio > Voice.",
);

/** What the server does with a text, by the installation's choice. */
export type SpeechMode =
  /** Nothing speaks. */
  | "off"
  /** The device speaks the text itself: the server sends text, never audio. */
  | "browser"
  /** The server makes audio with a model that runs inside it: no key, nothing leaves the machine. */
  | "local"
  /** The server makes audio through a provider. */
  | "remote";

export const speechModeOf = (provider: SpeechProvider): SpeechMode =>
  provider === "off"
    ? "off"
    : provider === "browser"
      ? "browser"
      : speechIsLocal(provider)
        ? "local"
        : "remote";

export type ConfiguredSynthesizer = Synthesizer & {
  mode(): Promise<SpeechMode>;
  settings(): Promise<SpeechSettings>;
};

/**
 * The synthesizer the whole server uses: it reads the installation's choice on every request (like `createConfiguredTranscriber`), so a
 * change in Studio applies at once. The call's own language and voice win over the installation's defaults (the language is only a hint, used by ElevenLabs).
 */
export function createConfiguredSynthesizer(deps: {
  settings: () => Promise<SpeechSettings>;
  /** The key (the caller zeroes it): the sealed connection the administrator saved; there is no other source. */
  key: () => Promise<Buffer | undefined>;
  /** The voice that runs inside the server (`local`); one instance, so the model loads once and texts take turns. */
  local?: Synthesizer;
  allowPrivate?: PrivateNetwork;
  fetch?: typeof fetch;
  deadlineMs?: number;
}): ConfiguredSynthesizer {
  let inside: Synthesizer | undefined;
  const local = () => (inside ??= deps.local ?? createLocalSynthesizer());
  const remote = createRemoteSynthesizer({
    allowPrivate: deps.allowPrivate,
    fetch: deps.fetch,
    deadlineMs: deps.deadlineMs,
    resolve: async (o?: SynthesizeOptions) => {
      const s = await deps.settings();
      if (s.speechProvider === "off")
        throw new SpeechError("OFF", "Text to speech is switched off.");
      if (!speechIsRemote(s.speechProvider))
        throw new SpeechError(
          s.speechProvider === "browser" ? "BROWSER" : "NOT_CONFIGURED",
          s.speechProvider === "browser"
            ? "The browser speaks the text on its own device."
            : "That provider is not a remote one.",
        );
      const baseUrl =
        s.speechProvider === "openai"
          ? OPENAI_BASE_URL
          : s.speechProvider === "elevenlabs"
            ? ELEVENLABS_BASE_URL
            : s.speechBaseUrl;
      if (!baseUrl)
        throw new SpeechError(
          "NOT_CONFIGURED",
          "Text to speech needs a server address. An administrator must set it in Studio > Voice.",
        );
      const key = await deps.key().catch(() => undefined);
      if (!key?.length) throw NO_SPEECH_KEY;
      return {
        provider: s.speechProvider,
        baseUrl,
        model: s.speechModel,
        voice: o?.voice || s.speechVoice,
        language: o?.language || s.speechLanguage || undefined,
        key,
      };
    },
  });
  /** `local` speaks inside the server with the installation's voice and language unless the call names its own. */
  const own = async (o?: SynthesizeOptions) => {
    const s = await deps.settings();
    return speechIsLocal(s.speechProvider)
      ? {
          ...o,
          voice: o?.voice || s.speechVoice,
          language: o?.language || s.speechLanguage || undefined,
          model: s.speechModel || undefined,
        }
      : undefined;
  };
  async function* stream(text: string, o?: SynthesizeOptions) {
    const mine = await own(o);
    yield* mine ? local().stream(text, mine) : remote.stream(text, o);
  }
  return {
    mode: async () => speechModeOf((await deps.settings()).speechProvider),
    settings: deps.settings,
    async synthesize(text, o) {
      const mine = await own(o);
      return mine ? local().synthesize(text, mine) : remote.synthesize(text, o);
    },
    stream,
  };
}
