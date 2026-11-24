import type { TranscribeProvider } from "@zetta/core/speech";
import type { PrivateNetwork } from "../settings/private-network";
import { createRemoteTranscriber, OPENAI_BASE_URL, OPENAI_DEFAULT_MODEL } from "./remote";
import { TranscribeError, type Transcriber } from "./transcriber";

/** What the administrator chose (the columns of `installation_settings`). */
export type TranscribeSettings = {
  /** `off`: no recording or voice note is turned into text. */
  transcribeProvider: TranscribeProvider;
  transcribeModel: string;
  transcribeLanguage: string;
  transcribeBaseUrl: string;
  transcribeConnectionId: string | null;
};

export const TRANSCRIBE_OFF = new TranscribeError(
  "DISABLED",
  "Turning speech into text is switched off on this server.",
);

export const NO_KEY = new TranscribeError(
  "NOT_CONFIGURED",
  "The API key for speech to text is not available. An administrator must enter it again in Studio > Voice.",
);

/**
 * The transcriber the whole server uses: it reads the installation's choice on every recording, so a change in Studio applies at once,
 * to the microphone and to voice notes alike. `local` runs the model inside the server; the others send the recording to a provider.
 *
 * Language: the call's own (the browser's, for the microphone) wins over the installation's default, which serves the voice notes of
 * outside people, who have no browser.
 */
export function createConfiguredTranscriber(deps: {
  settings: () => Promise<TranscribeSettings>;
  local: Transcriber;
  /** The key: the secret of the connection the administrator saved; there is no other source. The caller's buffer is zeroed. */
  key: (connectionId: string | null) => Promise<Buffer | undefined>;
  allowPrivate?: PrivateNetwork;
  fetch?: typeof fetch;
  deadlineMs?: number;
}): Transcriber {
  return {
    async transcribe(pcm, o) {
      const s = await deps.settings();
      if (s.transcribeProvider === "off") throw TRANSCRIBE_OFF;
      const language = o?.language || s.transcribeLanguage || undefined;
      if (s.transcribeProvider === "local")
        return deps.local.transcribe(pcm, {
          ...o,
          language,
          model: s.transcribeModel || undefined,
        });
      const remote = createRemoteTranscriber({
        allowPrivate: deps.allowPrivate,
        fetch: deps.fetch,
        deadlineMs: deps.deadlineMs,
        resolve: async () => {
          const baseUrl = s.transcribeProvider === "openai" ? OPENAI_BASE_URL : s.transcribeBaseUrl;
          if (!baseUrl)
            throw new TranscribeError(
              "NOT_CONFIGURED",
              "Speech to text needs a server address. An administrator must set it in Studio > Voice.",
            );
          const key = await deps.key(s.transcribeConnectionId).catch(() => undefined);
          if (!key?.length) throw NO_KEY;
          return {
            provider: s.transcribeProvider as "openai" | "compatible",
            baseUrl,
            model: s.transcribeModel || OPENAI_DEFAULT_MODEL,
            key,
          };
        },
      });
      return remote.transcribe(pcm, { ...o, language });
    },
  };
}
