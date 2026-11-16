/** What the browser sends for speech to text: 16 kHz mono 16-bit samples, the shape the server's speech model reads. */
export const SPEECH_RATE = 16_000;
/** The same limit as the server: five minutes. */
export const MAX_RECORDING_SECONDS = 300;

/** Floats between -1 and 1 as little-endian 16-bit samples. A value outside the range is clipped, not wrapped. */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return out;
}

/** Base64 of bytes, in slices: one `String.fromCharCode(...all)` call would overflow the stack on a long recording. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const slice = 0x8000;
  for (let i = 0; i < bytes.length; i += slice)
    binary += String.fromCharCode(...bytes.subarray(i, i + slice));
  return btoa(binary);
}

/** "0:07" for a recording of 7 seconds. */
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The text with the transcript added after it, with a space between them when the text did not end in one. */
export const withTranscript = (text: string, transcript: string) =>
  transcript ? `${text}${text && !/\s$/.test(text) ? " " : ""}${transcript}` : text;

/**
 * Turns a recording (what MediaRecorder produced: webm/opus in Chrome and Firefox, mp4/aac in Safari) into 16 kHz mono samples, in the
 * browser, so the server needs no audio decoder for it.
 */
export async function recordingToSamples(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const seconds = Math.min(decoded.duration, MAX_RECORDING_SECONDS);
    const offline = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(seconds * SPEECH_RATE)),
      SPEECH_RATE,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    void context.close();
  }
}
