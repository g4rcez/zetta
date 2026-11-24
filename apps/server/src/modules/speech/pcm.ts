import { SAMPLE_RATE, bytesToPcm16, resample } from "../voice/core/audio";

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * Brings the chunks of a provider's audio (little-endian 16-bit bytes at `rate`) to 16 kHz samples. Chunks arrive cut anywhere, so an
 * odd byte and a rest that does not fill a whole group of input samples wait for the next chunk; the group is the smallest one that
 * maps to whole output samples (3 samples at 24 kHz or 48 kHz), so the result does not depend on where the chunks were cut.
 */
export function createPcmNormalizer(rate: number) {
  const group = rate / gcd(rate, SAMPLE_RATE);
  let bytes = new Uint8Array(0);
  let samples = new Int16Array(0);
  const take = (all: Int16Array, final: boolean): Int16Array => {
    const usable = final ? all.length : all.length - (all.length % group);
    samples = all.slice(usable);
    return rate === SAMPLE_RATE
      ? all.slice(0, usable)
      : resample(all.slice(0, usable), rate, SAMPLE_RATE);
  };
  const join = (a: Int16Array, b: Int16Array) => {
    const out = new Int16Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };
  return {
    push(chunk: Uint8Array): Int16Array {
      const all = new Uint8Array(bytes.length + chunk.length);
      all.set(bytes);
      all.set(chunk, bytes.length);
      const even = all.length - (all.length % 2);
      bytes = all.slice(even);
      return take(join(samples, bytesToPcm16(all.subarray(0, even))), false);
    },
    flush(): Int16Array {
      return take(samples, true);
    },
  };
}

/** 16 kHz mono 16-bit WAV of samples (what a browser's `<audio>` plays). */
export function pcm16ToWav(pcm: Int16Array, rate = SAMPLE_RATE): Uint8Array {
  const data = pcm.length * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, data, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i] ?? 0, true);
  return out;
}
