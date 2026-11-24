import { FRAME_SAMPLES, SAMPLE_RATE } from "./audio";

/** Generated audio for tests: nothing recorded, nothing random without a seed. */
export const tone = (ms: number, amp = 0.2, hz = 220, rate = SAMPLE_RATE): Int16Array => {
  const n = Math.round((rate * ms) / 1000);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++)
    out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * amp * 32767);
  return out;
};

/** Seeded white noise with the given RMS-ish amplitude (uniform between -amp and amp, RMS is amp / sqrt 3). */
export const noise = (ms: number, amp: number, seed = 1, rate = SAMPLE_RATE): Int16Array => {
  const n = Math.round((rate * ms) / 1000);
  const out = new Int16Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = Math.round(((x / 0xffffffff) * 2 - 1) * amp * 32767);
  }
  return out;
};

export const silence = (ms: number, rate = SAMPLE_RATE) =>
  new Int16Array(Math.round((rate * ms) / 1000));

export const concat = (...parts: Int16Array[]): Int16Array => {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export const frames = (pcm: Int16Array): Int16Array[] => {
  const out: Int16Array[] = [];
  for (let i = 0; i + FRAME_SAMPLES <= pcm.length; i += FRAME_SAMPLES)
    out.push(pcm.slice(i, i + FRAME_SAMPLES));
  return out;
};
