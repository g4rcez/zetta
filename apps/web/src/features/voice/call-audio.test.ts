import { describe, expect, test } from "bun:test";

import {
  bytesToPcm16,
  CaptureCore,
  FRAME_BYTES,
  FRAME_SAMPLES,
  JitterBuffer,
  levelOf,
  PlayerCore,
  Resampler,
} from "./call-audio";

const sine = (rate: number, hz: number, seconds: number, amp = 0.5) =>
  Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate),
  );

describe("Resampler", () => {
  test("48 kHz to 16 kHz gives a third of the samples, in blocks of any size", () => {
    const input = sine(48_000, 440, 1);
    const whole = new Resampler(48_000, 16_000).process(input);
    expect(whole.length).toBe(16_000);
    // The same signal cut into odd blocks comes out the same: the state carries over.
    const r = new Resampler(48_000, 16_000);
    const parts: number[] = [];
    for (let at = 0; at < input.length; at += 128)
      parts.push(...r.process(input.subarray(at, at + 128)));
    expect(parts.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i += 997) expect(parts[i]).toBeCloseTo(whole[i]!, 5);
  });
  test("44.1 kHz (a ratio that is not whole) keeps the length and the pitch", () => {
    const out = new Resampler(44_100, 16_000).process(sine(44_100, 400, 1));
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(1);
    // Count the rising zero crossings: 400 Hz for one second is 400 of them.
    let crossings = 0;
    for (let i = 1; i < out.length; i++) if (out[i - 1]! < 0 && out[i]! >= 0) crossings++;
    expect(Math.abs(crossings - 400)).toBeLessThanOrEqual(1);
  });
  test("a constant stays constant (nothing is added by the filter)", () => {
    const out = new Resampler(48_000, 16_000).process(new Float32Array(480).fill(0.25));
    for (const v of out) expect(v).toBeCloseTo(0.25, 6);
  });
  test("8 kHz up to 16 kHz doubles the samples along straight lines", () => {
    const out = new Resampler(8_000, 16_000).process(Float32Array.from([0, 1, 0, 1]));
    expect(out.length).toBe(8);
  });
  test("the same rate passes through", () => {
    const x = Float32Array.from([0.1, -0.2]);
    expect(Array.from(new Resampler(16_000, 16_000).process(x))).toEqual(Array.from(x));
  });
  test("a rate of zero is refused", () => {
    expect(() => new Resampler(0, 16_000)).toThrow();
  });
});

describe("CaptureCore", () => {
  test("one second at 48 kHz is 50 frames of 640 bytes, little-endian 16-bit", () => {
    const core = new CaptureCore(48_000);
    const frames: Uint8Array[] = [];
    const input = new Float32Array(48_000).fill(0.5);
    for (let at = 0; at < input.length; at += 128)
      frames.push(...core.process(input.subarray(at, at + 128)).frames);
    expect(frames.length).toBe(50);
    for (const f of frames) expect(f.byteLength).toBe(FRAME_BYTES);
    expect(new DataView(frames[1]!.buffer, frames[1]!.byteOffset).getInt16(0, true)).toBe(16384);
  });
  test("samples that do not fill a frame wait for the next block", () => {
    const core = new CaptureCore(16_000);
    expect(core.process(new Float32Array(FRAME_SAMPLES - 1)).frames.length).toBe(0);
    expect(core.process(new Float32Array(1)).frames.length).toBe(1);
  });
  test("it reports how loud the block was", () => {
    expect(new CaptureCore(16_000).process(new Float32Array(128)).level).toBe(0);
    expect(new CaptureCore(16_000).process(new Float32Array(128).fill(0.5)).level).toBeCloseTo(
      0.5,
      5,
    );
    expect(levelOf(new Float32Array(0))).toBe(0);
  });
});

describe("bytesToPcm16", () => {
  test("reads little-endian samples and drops a message that is not whole samples", () => {
    const b = new Uint8Array([0x00, 0x40, 0x00, 0xc0]);
    expect(Array.from(bytesToPcm16(b)!)).toEqual([16384, -16384]);
    expect(Array.from(bytesToPcm16(b.buffer)!)).toEqual([16384, -16384]);
    expect(bytesToPcm16(new Uint8Array(3))).toBeNull();
    expect(bytesToPcm16(new Uint8Array(0))).toBeNull();
  });
});

describe("JitterBuffer", () => {
  const ramp = (n: number, from = 0) => Int16Array.from({ length: n }, (_, i) => from + i);
  test("waits until the prebuffer is full, then plays in order", () => {
    const b = new JitterBuffer(100);
    b.push(ramp(60));
    expect(b.read()).toBeNull();
    expect(b.playing).toBe(false);
    b.push(ramp(60, 60));
    expect(b.playing).toBe(true);
    const got: number[] = [];
    for (let i = 0; i < 120; i++) got.push(Math.round(b.read()! * 32768));
    expect(got).toEqual(Array.from(ramp(120)));
  });
  test("when it runs dry it waits to fill again instead of stuttering", () => {
    const b = new JitterBuffer(50);
    b.push(ramp(50));
    for (let i = 0; i < 50; i++) b.read();
    expect(b.read()).toBeNull();
    b.push(ramp(10));
    expect(b.read()).toBeNull();
    b.push(ramp(40));
    expect(b.read()).not.toBeNull();
  });
  test("clear drops everything at once", () => {
    const b = new JitterBuffer(10);
    b.push(ramp(500));
    expect(b.size).toBe(500);
    b.clear();
    expect(b.size).toBe(0);
    expect(b.read()).toBeNull();
    expect(b.playing).toBe(false);
  });
});

describe("PlayerCore", () => {
  test("plays at the speaker's rate and counts the 16 kHz samples played", () => {
    const p = new PlayerCore(48_000, 60);
    p.push(new Int16Array(1600).fill(8192));
    const out = new Float32Array(128);
    let blocks = 0;
    while (p.bufferedSamples > 0 && blocks < 100) {
      p.render(out);
      blocks++;
    }
    // 1600 samples at 16 kHz are 100 ms: 4800 samples at 48 kHz, 37.5 blocks of 128 (plus the block that ends it).
    expect(blocks).toBeGreaterThanOrEqual(37);
    expect(blocks).toBeLessThanOrEqual(39);
    expect(p.playedSamples).toBe(1600);
  });
  test("plays silence while the prebuffer fills", () => {
    const p = new PlayerCore(48_000, 60);
    p.push(new Int16Array(100).fill(8192));
    const out = new Float32Array(128).fill(1);
    p.render(out);
    expect(out.every((v) => v === 0)).toBe(true);
    expect(p.playedSamples).toBe(0);
  });
  test("clear flushes at once: silence follows and the count restarts", () => {
    const p = new PlayerCore(48_000, 20);
    p.push(new Int16Array(3200).fill(8192));
    p.render(new Float32Array(128));
    expect(p.playedSamples).toBeGreaterThan(0);
    p.clear();
    const out = new Float32Array(128).fill(1);
    p.render(out);
    expect(out.every((v) => v === 0)).toBe(true);
    expect(p.bufferedSamples).toBe(0);
    expect(p.playedSamples).toBe(0);
  });
  test("resetPlayed starts a new reply's count without dropping audio", () => {
    const p = new PlayerCore(16_000, 20);
    p.push(new Int16Array(1600).fill(1000));
    p.render(new Float32Array(160));
    p.resetPlayed();
    expect(p.playedSamples).toBe(0);
    expect(p.bufferedSamples).toBeGreaterThan(0);
  });
});
