import { floatToPcm16, SPEECH_RATE } from "../chat/audio";

/**
 * The audio maths of a voice call, with no browser in it: the capture worklet and the playback worklet are thin wrappers around these, so
 * every line here runs in a unit test. The wire format is fixed by the server (`modules/voice/protocol.ts`): 16 kHz mono 16-bit
 * little-endian samples, 20 ms (320 samples, 640 bytes) per binary message, in both directions.
 */
export const FRAME_SAMPLES = SPEECH_RATE / 50;
export const FRAME_BYTES = FRAME_SAMPLES * 2;

/**
 * Turns the microphone's rate (44.1 or 48 kHz, whatever the device has) into another one, a block at a time, keeping its state between
 * blocks. Down to a lower rate each output sample is the average of the input it covers (a box filter, so a 48 kHz mic does not alias);
 * up to a higher rate it is a straight line between two input samples.
 */
export class Resampler {
  private readonly step: number;
  // Downsampling: the sum and the weight of the output sample being built.
  private sum = 0;
  private weight = 0;
  // Upsampling: the last input sample and where the next output sample sits after it (0 to 1).
  private prev = 0;
  private at = 0;

  constructor(
    readonly inRate: number,
    readonly outRate: number,
  ) {
    if (!(inRate > 0) || !(outRate > 0)) throw new Error("A sample rate must be positive.");
    this.step = inRate / outRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.step === 1) return input.slice();
    const out: number[] = [];
    if (this.step > 1) {
      for (let i = 0; i < input.length; i++) {
        const x = input[i]!;
        let left = 1;
        while (left > 1e-9) {
          const take = Math.min(left, this.step - this.weight);
          this.sum += x * take;
          this.weight += take;
          left -= take;
          if (this.weight >= this.step - 1e-9) {
            out.push(this.sum / this.step);
            this.sum = 0;
            this.weight = 0;
          }
        }
      }
    } else {
      for (let i = 0; i < input.length; i++) {
        const x = input[i]!;
        while (this.at < 1) {
          out.push(this.prev + (x - this.prev) * this.at);
          this.at += this.step;
        }
        this.at -= 1;
        this.prev = x;
      }
    }
    return Float32Array.from(out);
  }
}

/** The loudness of a block of samples, 0 to 1 (root mean square). */
export function levelOf(block: Float32Array): number {
  if (!block.length) return 0;
  let sum = 0;
  for (let i = 0; i < block.length; i++) sum += block[i]! * block[i]!;
  return Math.min(1, Math.sqrt(sum / block.length));
}

/**
 * What the microphone worklet does with each block it is handed: resample to 16 kHz, cut into 20 ms frames, and say how loud it was.
 * `process` returns the whole frames that are ready, each as the 640 bytes the socket carries.
 */
export class CaptureCore {
  private readonly resampler: Resampler;
  private pending = new Float32Array(0);

  constructor(inRate: number) {
    this.resampler = new Resampler(inRate, SPEECH_RATE);
  }

  process(input: Float32Array): { frames: Uint8Array[]; level: number } {
    const resampled = this.resampler.process(input);
    const all = new Float32Array(this.pending.length + resampled.length);
    all.set(this.pending);
    all.set(resampled, this.pending.length);
    const frames: Uint8Array[] = [];
    let at = 0;
    for (; at + FRAME_SAMPLES <= all.length; at += FRAME_SAMPLES)
      frames.push(floatToPcm16(all.subarray(at, at + FRAME_SAMPLES)));
    this.pending = all.slice(at);
    return { frames, level: levelOf(input) };
  }
}

/** One binary message from the socket as samples. Anything that is not whole 16-bit samples is dropped (null). */
export function bytesToPcm16(bytes: ArrayBuffer | Uint8Array): Int16Array | null {
  const view =
    bytes instanceof Uint8Array
      ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new DataView(bytes);
  if (view.byteLength < 2 || view.byteLength % 2 !== 0) return null;
  const out = new Int16Array(view.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/**
 * The queue between the socket and the speaker. Audio arrives in bursts, the speaker takes it at an even pace, so the buffer waits until
 * `prebufferSamples` are in before it lets any out (a little delay that absorbs the burst), and when it runs dry it waits for that much
 * again instead of stuttering through single frames. `clear()` drops everything at once (the person spoke over the bot).
 */
export class JitterBuffer {
  private chunks: Int16Array[] = [];
  private offset = 0;
  private held = 0;
  private primed = false;

  constructor(readonly prebufferSamples: number) {}

  /** Samples waiting to be played. */
  get size() {
    return this.held;
  }
  /** Whether samples are coming out (false while it waits to fill, and while empty). */
  get playing() {
    return this.primed;
  }

  push(pcm: Int16Array) {
    if (!pcm.length) return;
    this.chunks.push(pcm);
    this.held += pcm.length;
    if (!this.primed && this.held >= this.prebufferSamples) this.primed = true;
  }

  /** The next sample as a float, or null while the buffer waits to fill (the caller plays silence). */
  read(): number | null {
    if (!this.primed) return null;
    const chunk = this.chunks[0];
    if (!chunk) {
      this.primed = false;
      return null;
    }
    const sample = chunk[this.offset++]! / 32768;
    this.held--;
    if (this.offset >= chunk.length) {
      this.chunks.shift();
      this.offset = 0;
      if (!this.chunks.length) this.primed = false;
    }
    return sample;
  }

  clear() {
    this.chunks = [];
    this.offset = 0;
    this.held = 0;
    this.primed = false;
  }
}

/**
 * What the playback worklet does: it fills each block the speaker asks for from the jitter buffer, at the speaker's own rate (a straight
 * line between the 16 kHz samples), and counts the 16 kHz samples it has played, which the page reports to the server as `played`.
 */
export class PlayerCore {
  private readonly buffer: JitterBuffer;
  private readonly step: number;
  private a = 0;
  private b = 0;
  private at = 1;
  private count = 0;

  constructor(outRate: number, prebufferMs = 60) {
    this.step = SPEECH_RATE / outRate;
    this.buffer = new JitterBuffer(Math.round((SPEECH_RATE * prebufferMs) / 1000));
  }

  /** The 16 kHz samples played since the last `clear()` or `resetPlayed()`. */
  get playedSamples() {
    return this.count;
  }
  get bufferedSamples() {
    return this.buffer.size;
  }
  get playing() {
    return this.buffer.playing;
  }

  push(pcm: Int16Array) {
    this.buffer.push(pcm);
  }
  /** Everything not played yet is dropped, and the count of played samples starts again. */
  clear() {
    this.buffer.clear();
    this.a = this.b = 0;
    this.at = 1;
    this.count = 0;
  }
  /** A new reply starts: its played samples are counted from zero. */
  resetPlayed() {
    this.count = 0;
  }

  /** Fills `out` (the speaker's block). Returns how many 16 kHz samples were consumed. */
  render(out: Float32Array) {
    for (let i = 0; i < out.length; i++) {
      while (this.at >= 1) {
        const next = this.buffer.read();
        if (next === null) {
          this.a = this.b = 0;
          this.at = 1;
          out[i] = 0;
          break;
        }
        this.a = this.b;
        this.b = next;
        this.at -= 1;
        this.count++;
      }
      if (this.at >= 1) continue;
      out[i] = this.a + (this.b - this.a) * this.at;
      this.at += this.step;
    }
  }
}
