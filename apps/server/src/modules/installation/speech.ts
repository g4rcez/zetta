import type { SpeechSettings } from "@zetta/core/speech";
import type { InstallationKeyReader, InstallationKeyState } from "../connections/installation-key";
import type { InstallationSettings } from "./service";

/** The speech-out columns of the installation settings, and nothing else. */
export const speechSettingsOf = (s: InstallationSettings): SpeechSettings => ({
  speechProvider: s.speechProvider,
  speechBaseUrl: s.speechBaseUrl,
  speechModel: s.speechModel,
  speechVoice: s.speechVoice,
  speechLanguage: s.speechLanguage,
});

/**
 * What the speech-out feature reads, on every call, so a change in Studio applies at once (the way `transcribe/configured.ts` does for
 * speech to text). Read-only and the same in every `ZETTA_ROLE`. The key never leaves as anything but the buffer the caller zeroes.
 */
export function createSpeechReader(deps: {
  load: () => Promise<InstallationSettings>;
  key: InstallationKeyReader;
}) {
  return {
    settings: async (): Promise<SpeechSettings> => speechSettingsOf(await deps.load()),
    /** Whether a key is there: none, a saved connection (still readable or not), or the operator's own (`ZETTA_SPEECH_API_KEY`). */
    keyState: async (): Promise<InstallationKeyState> =>
      deps.key.state((await deps.load()).speechConnectionId),
    /** The key as bytes (the caller zeroes them), or undefined when there is none to use. */
    secret: async (): Promise<Buffer | undefined> =>
      deps.key.secret((await deps.load()).speechConnectionId),
  };
}
export type SpeechReader = ReturnType<typeof createSpeechReader>;
