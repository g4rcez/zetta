/**
 * Speech out (text to speech): what the administrator chose for the whole installation. The columns live on `installation_settings`
 * (`speech_*`); the API key of a provider that needs one is a sealed connection, never a column. See
 * docs/decisions/feedback-wave2-foundation.md.
 *
 * Only erasable syntax here: the database schema, the server and the web app all import this file.
 */

/**
 * Speech to text (the mirror of speech out): `off` turns it off (no recording or voice note is turned into text), `local` runs the
 * server's own Whisper model, `openai` and `compatible` send the recording to a provider (with a sealed key).
 */
export const TRANSCRIBE_PROVIDERS = ["off", "local", "openai", "compatible"] as const;
export type TranscribeProvider = (typeof TRANSCRIBE_PROVIDERS)[number];

/**
 * `off`: no "Listen" button and no voice mode answers aloud. `browser`: the device's own speech engine speaks (no setup, nothing is sent
 * to Zetta or to a provider by Zetta). `local`: a voice that runs inside the server (no key, nothing leaves the machine; one model download
 * of about 100 MB; English, Spanish and Brazilian Portuguese; works on a phone call too). `openai`: OpenAI's /audio/speech. `compatible`: any server that speaks the same API
 * (`speechBaseUrl`). `elevenlabs`: ElevenLabs.
 */
export const SPEECH_PROVIDERS = [
  "off",
  "browser",
  "local",
  "openai",
  "compatible",
  "elevenlabs",
] as const;
export type SpeechProvider = (typeof SPEECH_PROVIDERS)[number];

/**
 * `browser` is the default: it needs no key or address, and it only speaks when a person presses "Listen" or starts voice mode, so no
 * text leaves the page by itself. `off` would hide the feature until an administrator finds the setting.
 */
export const DEFAULT_SPEECH_PROVIDER: SpeechProvider = "browser";

/** The provider whose model runs inside the server: no key, no address, and it can speak on a phone call (unlike `browser`). */
export const speechIsLocal = (p: SpeechProvider) => p === "local";

/** Providers that run on a server the installation reaches: they need a key (sealed) and cost something. */
export const SPEECH_REMOTE_PROVIDERS = ["openai", "compatible", "elevenlabs"] as const;
export type SpeechRemoteProvider = (typeof SPEECH_REMOTE_PROVIDERS)[number];
export const speechIsRemote = (p: SpeechProvider): p is SpeechRemoteProvider =>
  (SPEECH_REMOTE_PROVIDERS as readonly string[]).includes(p);
/** Only `compatible` takes an address; the others have a fixed one. */
export const speechNeedsAddress = (p: SpeechProvider) => p === "compatible";

/** Longest values the columns hold (also CHECKs in the database). */
export const SPEECH_LIMITS = { baseUrl: 512, model: 100, voice: 100, language: 35 } as const;
/** A model or a voice is a provider's own name or id: letters, digits and `. _ : / -`. Empty means the provider's default. */
export const SPEECH_NAME_PATTERN = /^[A-Za-z0-9._:/-]*$/;

/** The sealed key of the installation's speech provider: a `connection` of this provider, saved with this transport purpose. */
export const SPEECH_KEY_CONNECTION_PROVIDER = "speech";
export const SPEECH_KEY_PURPOSE = "installation.speech-key";

export type SpeechSettings = {
  speechProvider: SpeechProvider;
  speechBaseUrl: string;
  speechModel: string;
  speechVoice: string;
  speechLanguage: string;
};

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  speechProvider: DEFAULT_SPEECH_PROVIDER,
  speechBaseUrl: "",
  speechModel: "",
  speechVoice: "",
  speechLanguage: "",
};

/**
 * Why a set of speech settings cannot be saved, or null. `compatible` needs an address. Every text must fit its limit and pattern. The
 * address itself (https, private network) is checked by the server where the administrator types it, as for speech to text.
 */
export function speechSettingsIssue(s: SpeechSettings): string | null {
  if (!(SPEECH_PROVIDERS as readonly string[]).includes(s.speechProvider))
    return "That is not a speech provider.";
  if (speechNeedsAddress(s.speechProvider) && !s.speechBaseUrl)
    return "A custom speech provider needs its address.";
  if (s.speechBaseUrl.length > SPEECH_LIMITS.baseUrl) return "The address is too long.";
  if (s.speechModel.length > SPEECH_LIMITS.model || !SPEECH_NAME_PATTERN.test(s.speechModel))
    return "The model name has characters that are not allowed.";
  if (s.speechVoice.length > SPEECH_LIMITS.voice || !SPEECH_NAME_PATTERN.test(s.speechVoice))
    return "The voice name has characters that are not allowed.";
  if (s.speechLanguage.length > SPEECH_LIMITS.language) return "The language is too long.";
  return null;
}

/** The settings that stay after a provider is chosen: the address of a provider that takes none is dropped. */
export function normalizeSpeechSettings(s: SpeechSettings): SpeechSettings {
  return speechNeedsAddress(s.speechProvider) ? s : { ...s, speechBaseUrl: "" };
}
