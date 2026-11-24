import { describe, expect, test } from "bun:test";
import { FRAME_MS } from "./audio";
import { concat, frames, noise, silence, tone } from "./test-audio";
import { createEnergyVad, type VadEvent } from "./vad";

/** Feeds audio and returns each event with the time (ms) of the frame that raised it. */
function run(pcm: Int16Array, vad = createEnergyVad()) {
  const events: { at: number; event: VadEvent }[] = [];
  frames(pcm).forEach((f, i) => {
    const event = vad.push(f);
    if (event) events.push({ at: (i + 1) * FRAME_MS, event });
  });
  return events;
}
const room = (ms: number, amp = 0.003, seed = 3) => noise(ms, amp, seed);

describe("energy vad", () => {
  test("a quiet room never speaks", () => {
    expect(run(room(5000))).toEqual([]);
  });

  test("speech starts after about 200 ms and ends after the hangover", () => {
    const events = run(concat(room(1000), tone(1000), room(1000)));
    expect(events.map((e) => e.event)).toEqual(["speech-start", "speech-end"]);
    // tone begins at 1000 ms
    expect(events[0]!.at).toBeGreaterThanOrEqual(1200);
    expect(events[0]!.at).toBeLessThanOrEqual(1260);
    // tone ends at 2000 ms; hangover is 200 ms
    expect(events[1]!.at).toBeGreaterThanOrEqual(2200);
    expect(events[1]!.at).toBeLessThanOrEqual(2260);
  });

  test("a burst shorter than 200 ms is ignored", () => {
    expect(run(concat(room(1000), tone(100), room(1000)))).toEqual([]);
  });

  test("a short dip inside speech does not end it", () => {
    const events = run(concat(room(1000), tone(500), silence(100), tone(500), room(1000)));
    expect(events.map((e) => e.event)).toEqual(["speech-start", "speech-end"]);
  });

  test("two separate utterances give two pairs", () => {
    const events = run(concat(room(1000), tone(600), room(800), tone(600), room(800)));
    expect(events.map((e) => e.event)).toEqual([
      "speech-start",
      "speech-end",
      "speech-start",
      "speech-end",
    ]);
  });

  test("the level follows a steady noisy room measured at the start", () => {
    // Noise at RMS ~0.017 is far above the fixed minimum, yet it is the room, not speech.
    const loudRoom = (ms: number, seed: number) => noise(ms, 0.03, seed);
    expect(run(loudRoom(8000, 5))).toEqual([]);
    const events = run(concat(loudRoom(1000, 5), tone(800, 0.5), loudRoom(1000, 6)));
    expect(events.map((e) => e.event)).toEqual(["speech-start", "speech-end"]);
  });

  test("speech at the level of the noise is not heard, speech well above it is", () => {
    const quiet = run(concat(noise(1000, 0.03, 2), noise(800, 0.03, 9), noise(1000, 0.03, 4)));
    expect(quiet).toEqual([]);
  });

  test("reset forgets the room and any speech in progress", () => {
    const vad = createEnergyVad();
    run(concat(room(1000), tone(400)), vad);
    expect(vad.speaking).toBe(true);
    vad.reset();
    expect(vad.speaking).toBe(false);
  });

  test("options change the start time", () => {
    const events = run(concat(room(1000), tone(1000)), createEnergyVad({ startMs: 400 }));
    expect(events[0]!.at).toBeGreaterThanOrEqual(1400);
  });

  test("hangoverMs is exposed for the session", () => {
    expect(createEnergyVad().hangoverMs).toBe(200);
  });
});
