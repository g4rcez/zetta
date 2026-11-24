import { describe, expect, test } from "bun:test";
import {
  FRAME_SAMPLES,
  FrameChunker,
  bytesToPcm16,
  floatToPcm16,
  mulawDecode,
  mulawEncode,
  pcm16ToBytes,
  pcm16ToFloat,
  pcmToPhone,
  phoneToPcm,
  resample,
  rms,
} from "./audio";
import { noise, tone } from "./test-audio";

/** Frequency of a sine by counting upward zero crossings. */
const hzOf = (pcm: Int16Array, rate: number) => {
  let n = 0;
  for (let i = 1; i < pcm.length; i++) if (pcm[i - 1]! < 0 && pcm[i]! >= 0) n++;
  return (n * rate) / pcm.length;
};

describe("frames", () => {
  test("a frame is 20 ms at 16 kHz", () => expect(FRAME_SAMPLES).toBe(320));
  test("the chunker cuts any chunk size into frames and keeps the rest", () => {
    const c = new FrameChunker();
    expect(c.push(new Int16Array(100))).toHaveLength(0);
    expect(c.push(new Int16Array(600))).toHaveLength(2);
    const last = c.flush();
    expect(last).toHaveLength(1);
    expect(last[0]!.length).toBe(320);
    expect(c.flush()).toHaveLength(0);
  });
  test("float and bytes round trips", () => {
    const f = Float32Array.from([0, 0.5, -0.5, 1, -1]);
    const back = pcm16ToFloat(floatToPcm16(f));
    f.forEach((v, i) => expect(Math.abs(back[i]! - v)).toBeLessThan(0.001));
    const p = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
    expect([...bytesToPcm16(pcm16ToBytes(p))]).toEqual([...p]);
    expect(bytesToPcm16(new Uint8Array([1, 0, 9])).length).toBe(1);
  });
  test("rms of a sine is amp / sqrt 2", () => {
    expect(rms(tone(100, 0.5))).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(rms(new Int16Array(0))).toBe(0);
  });
});

describe("resample", () => {
  for (const [from, to] of [
    [16000, 8000],
    [8000, 16000],
    [24000, 16000],
    [16000, 24000],
    [48000, 16000],
    [16000, 48000],
  ] as const) {
    test(`${from} to ${to} keeps length and pitch`, () => {
      const input = tone(500, 0.3, 440, from);
      const out = resample(input, from, to);
      expect(out.length).toBe(Math.round((input.length * to) / from));
      expect(hzOf(out, to)).toBeGreaterThan(425);
      expect(hzOf(out, to)).toBeLessThan(455);
      expect(rms(out)).toBeGreaterThan(0.18);
    });
  }
  test("same rate copies, empty stays empty, bad rate throws", () => {
    const a = tone(20);
    const b = resample(a, 16000, 16000);
    expect(b).not.toBe(a);
    expect([...b]).toEqual([...a]);
    expect(resample(new Int16Array(0), 8000, 16000).length).toBe(0);
    expect(() => resample(a, 0, 16000)).toThrow();
  });
  test("going down averages: a tone above the new Nyquist is attenuated", () => {
    const high = tone(200, 0.5, 7000, 16000);
    expect(rms(resample(high, 16000, 8000))).toBeLessThan(rms(high) * 0.7);
  });
});

describe("mu-law", () => {
  test("known G.711 values", () => {
    expect(mulawEncode(Int16Array.from([0]))[0]).toBe(0xff);
    expect(mulawEncode(Int16Array.from([32767]))[0]).toBe(0x80);
    expect(mulawEncode(Int16Array.from([-32768]))[0]).toBe(0x00);
    expect(mulawDecode(Uint8Array.from([0xff]))[0]).toBe(0);
    expect(mulawDecode(Uint8Array.from([0x80]))[0]).toBe(32124);
    expect(mulawDecode(Uint8Array.from([0x00]))[0]).toBe(-32124);
  });
  test("round trip keeps the signal within the companding error", () => {
    const input = noise(200, 0.5, 7);
    const back = mulawDecode(mulawEncode(input));
    let worst = 0;
    for (let i = 0; i < input.length; i++) {
      const err = Math.abs(back[i]! - input[i]!);
      worst = Math.max(worst, err / Math.max(256, Math.abs(input[i]!)));
    }
    expect(worst).toBeLessThan(0.07);
  });
  test("phone audio converts to 16 kHz and back", () => {
    const pcm = tone(400, 0.3, 440);
    const phone = pcmToPhone(pcm);
    expect(phone.length).toBe(3200);
    const back = phoneToPcm(phone);
    expect(back.length).toBe(pcm.length);
    expect(hzOf(back, 16000)).toBeGreaterThan(425);
    expect(hzOf(back, 16000)).toBeLessThan(455);
  });
});
