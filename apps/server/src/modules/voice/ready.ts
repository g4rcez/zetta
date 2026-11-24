import { speechIsLocal, speechIsRemote, type SpeechSettings } from "@zetta/core/speech";
import type { InstallationKeyState } from "../connections/installation-key";
import type { TranscribeSettings } from "../transcribe/configured";

const usable = (s: InstallationKeyState) => s === "set";

/**
 * Voice is on when both halves can work: the person's words can be turned into text, and the bot's text can be spoken. It does not call
 * a provider: it reads what the administrator chose and whether the key a provider needs is there. `browser` speech needs nothing (the
 * device speaks); the `local` speech to text and the `local` voice need no key. Both are decided by the provider alone: `off` means the
 * half is off, and a provider other than `local` means the local model is not used.
 */
export function createVoiceReadiness(deps: {
  settings: () => Promise<TranscribeSettings & SpeechSettings>;
  transcribeKey: (connectionId: string | null) => Promise<InstallationKeyState>;
  speechKey: () => Promise<InstallationKeyState>;
}) {
  return async (): Promise<boolean> => {
    const s = await deps.settings();
    const hears =
      s.transcribeProvider === "off"
        ? false
        : s.transcribeProvider === "local"
          ? true
          : (s.transcribeProvider === "openai" || Boolean(s.transcribeBaseUrl)) &&
            usable(await deps.transcribeKey(s.transcribeConnectionId));
    if (!hears) return false;
    if (s.speechProvider === "off") return false;
    if (speechIsLocal(s.speechProvider)) return true;
    if (!speechIsRemote(s.speechProvider)) return true;
    if (s.speechProvider === "compatible" && !s.speechBaseUrl) return false;
    return usable(await deps.speechKey());
  };
}
