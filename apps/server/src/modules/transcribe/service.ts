import { decodeAudio, hasDecoder, pcm16ToFloat32 } from "./decode";
import { TranscribeError, type Transcriber } from "./transcriber";

/** What a transcript may hold: more than a recording of five minutes speaks. */
const MAX_TEXT = 8000;

/** Speech to text for the web microphone and for voice notes that outside people send. */
export function createTranscribe(transcriber: Transcriber) {
  const clip = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  return {
    /** The browser's recording, already 16 kHz mono 16-bit samples. */
    async fromPcm(pcm16: Uint8Array, signal?: AbortSignal, language?: string) {
      return clip(await transcriber.transcribe(pcm16ToFloat32(pcm16), { signal, language }));
    },
    /** A recording in any format ffmpeg reads (a Telegram or WhatsApp voice note). */
    async fromAudio(bytes: Uint8Array, signal?: AbortSignal) {
      return clip(await transcriber.transcribe(await decodeAudio(bytes, signal), { signal }));
    },
    canDecodeFiles: hasDecoder,
  };
}
export type Transcribe = ReturnType<typeof createTranscribe>;
export { TranscribeError };
