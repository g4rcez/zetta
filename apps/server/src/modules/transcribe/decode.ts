import { MAX_SAMPLES, SAMPLE_RATE, TranscribeError } from "./transcriber";

export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const DECODE_MS = 60_000;

/** Little-endian 16-bit mono samples (what the browser sends) as floats. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.length / 2);
  if (n > MAX_SAMPLES) throw new TranscribeError("TOO_LONG", "A recording can be up to 5 minutes.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** Whether this machine can turn a voice note (OGG/Opus, MP4, MP3 …) into samples: ffmpeg is on the PATH. */
export const hasDecoder = () => Boolean(Bun.which("ffmpeg"));

/**
 * Turns a recording in any common audio format into 16 kHz mono samples with ffmpeg. The bytes go in through a pipe (no file, no shell),
 * the output is cut at the limit, and the process stops at the deadline.
 */
export async function decodeAudio(bytes: Uint8Array, signal?: AbortSignal): Promise<Float32Array> {
  if (bytes.length > MAX_AUDIO_BYTES)
    throw new TranscribeError("TOO_BIG", "That recording is too big.");
  const ffmpeg = Bun.which("ffmpeg");
  if (!ffmpeg)
    throw new TranscribeError(
      "NO_DECODER",
      "This server cannot read that audio format. Record in the browser, or ask the administrator to install ffmpeg.",
    );
  const proc = Bun.spawn(
    [
      ffmpeg,
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-i",
      "pipe:0",
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-t",
      "300",
      "pipe:1",
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "ignore" },
  );
  const stop = () => proc.kill();
  const timer = setTimeout(stop, DECODE_MS);
  signal?.addEventListener("abort", stop, { once: true });
  try {
    // Feed the input while reading the output, so neither pipe fills up and blocks the other.
    const feeding = (async () => {
      try {
        proc.stdin.write(bytes);
        await proc.stdin.end();
      } catch {
        /* ffmpeg closed its input early (it had read enough, or the file is not audio): the exit code tells which */
      }
    })();
    const out = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
    await feeding;
    const code = await proc.exited;
    if (code !== 0 || out.length < 2)
      throw new TranscribeError("UNREADABLE", "That recording could not be read as audio.");
    return pcm16ToFloat32(out);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    proc.kill();
  }
}
