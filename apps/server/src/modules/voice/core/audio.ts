/**
 * Audio helpers for live voice: pure functions, no I/O. The conversation runs on 16 kHz mono 16-bit samples in frames of 20 ms (what
 * speech to text reads); the phone network speaks 8 kHz mu-law, and some providers answer at 24 or 48 kHz, so there are converters.
 */

export const SAMPLE_RATE = 16_000;
export const FRAME_MS = 20;
/** 320 samples at 16 kHz. */
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
/** The rates a transport or a provider is known to use. `resample` accepts any rate; these are the ones tested. */
export const SUPPORTED_RATES = [8000, 16000, 24000, 48000] as const;

const clamp16 = (n: number) => (n > 32767 ? 32767 : n < -32768 ? -32768 : Math.round(n));

export function floatToPcm16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function pcm16ToFloat(p: Int16Array): Float32Array {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = (p[i] ?? 0) / 0x8000;
  return out;
}

/** Little-endian 16-bit bytes (what providers send as `pcm`) to samples. An odd trailing byte is ignored. */
export function bytesToPcm16(bytes: Uint8Array): Int16Array {
  const n = bytes.length >> 1;
  const out = new Int16Array(n);
  const v = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true);
  return out;
}

export function pcm16ToBytes(p: Int16Array): Uint8Array {
  const out = new Uint8Array(p.length * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < p.length; i++) v.setInt16(i * 2, p[i] ?? 0, true);
  return out;
}

/** Root mean square of a frame, 0 to 1 (1 is full scale). */
export function rms(frame: Int16Array): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = (frame[i] ?? 0) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / frame.length);
}

/**
 * Cuts a stream of samples (any chunk size) into frames of `FRAME_SAMPLES`. A rest shorter than a frame waits for the next push;
 * `flush` pads it with silence.
 */
export class FrameChunker {
  private rest = new Int16Array(0);
  constructor(private readonly size = FRAME_SAMPLES) {}
  push(samples: Int16Array): Int16Array[] {
    const all = new Int16Array(this.rest.length + samples.length);
    all.set(this.rest);
    all.set(samples, this.rest.length);
    const frames: Int16Array[] = [];
    let at = 0;
    for (; at + this.size <= all.length; at += this.size)
      frames.push(all.slice(at, at + this.size));
    this.rest = all.slice(at);
    return frames;
  }
  flush(): Int16Array[] {
    if (!this.rest.length) return [];
    const last = new Int16Array(this.size);
    last.set(this.rest);
    this.rest = new Int16Array(0);
    return [last];
  }
}

/**
 * Converts samples from one rate to another. Going down, every output sample is the average of the input it covers (a box filter, enough
 * to keep speech clean for a recognizer); going up, the samples between are linear interpolations.
 */
export function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (!(from > 0) || !(to > 0)) throw new RangeError("Sample rates must be positive.");
  if (from === to || !pcm.length) return pcm.slice();
  const outLen = Math.max(1, Math.round((pcm.length * to) / from));
  const out = new Int16Array(outLen);
  const ratio = from / to;
  if (to < from) {
    for (let i = 0; i < outLen; i++) {
      const start = i * ratio;
      const end = Math.min(pcm.length, (i + 1) * ratio);
      let sum = 0;
      let weight = 0;
      for (let j = Math.floor(start); j < Math.ceil(end); j++) {
        const w = Math.min(j + 1, end) - Math.max(j, start);
        if (w <= 0) continue;
        sum += (pcm[j] ?? 0) * w;
        weight += w;
      }
      out[i] = clamp16(weight ? sum / weight : 0);
    }
    return out;
  }
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = pcm[Math.min(j, pcm.length - 1)] ?? 0;
    const b = pcm[Math.min(j + 1, pcm.length - 1)] ?? 0;
    out[i] = clamp16(a + (b - a) * frac);
  }
  return out;
}

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** G.711 mu-law, the encoding of a phone call at 8 kHz. */
export function mulawEncodeSample(sample: number): number {
  let s = sample;
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  if (s > MULAW_CLIP) s = MULAW_CLIP;
  s += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function mulawDecodeSample(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const magnitude = (((mantissa << 3) + MULAW_BIAS) << exponent) - MULAW_BIAS;
  return sign ? -magnitude : magnitude;
}

export function mulawEncode(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = mulawEncodeSample(pcm[i] ?? 0);
  return out;
}

export function mulawDecode(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = mulawDecodeSample(bytes[i] ?? 0);
  return out;
}

/** A phone call's audio (8 kHz mu-law) to the conversation's samples, and back. */
export const phoneToPcm = (bytes: Uint8Array): Int16Array =>
  resample(mulawDecode(bytes), 8000, SAMPLE_RATE);
export const pcmToPhone = (pcm: Int16Array): Uint8Array =>
  mulawEncode(resample(pcm, SAMPLE_RATE, 8000));
