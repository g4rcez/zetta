import { describe, expect, test } from "bun:test";
import type { Synthesizer } from "./core/types";
import { createPlayback, createTextSynthesizer, estimateSpeechMs } from "./playback";
import { FakeClock } from "./test-kit";

const chunk = (ms: number) => new Int16Array((16_000 * ms) / 1000);
const collect = async (it: AsyncIterable<Int16Array>) => {
  const out: Int16Array[] = [];
  for await (const c of it) out.push(c);
  return out;
};

describe("playback pacing", () => {
  const inner: Synthesizer = {
    synthesize: async () => chunk(0),
    async *stream() {
      for (let i = 0; i < 10; i++) yield chunk(100);
    },
  };

  test("holds a chunk back while more than the lead is waiting at the player", async () => {
    const clock = new FakeClock();
    const waits: number[] = [];
    const playback = createPlayback({
      clock,
      leadMs: 300,
      sleep: async (ms) => {
        waits.push(ms);
        clock.t += ms;
      },
    });
    const chunks = await collect(playback.wrap(inner).stream("x"));
    expect(chunks.length).toBe(10);
    // 100 ms per chunk, at most 300 ms ahead: the first four go at once, then one every 100 ms.
    expect(waits.length).toBe(6);
    expect(waits.every((w) => w === 100)).toBe(true);
    expect(clock.t).toBe(600);
  });

  test("pending() is what the player still has, and reset() empties it", async () => {
    const clock = new FakeClock();
    const playback = createPlayback({ clock, leadMs: Infinity });
    await collect(playback.wrap(inner).stream("x"));
    expect(playback.pending()).toBe(1000);
    clock.t += 400;
    expect(playback.pending()).toBe(600);
    playback.reset();
    expect(playback.pending()).toBe(0);
  });

  test("an aborted stream stops without sending more", async () => {
    const clock = new FakeClock();
    const ctl = new AbortController();
    const playback = createPlayback({
      clock,
      leadMs: 0,
      sleep: async () => {
        ctl.abort();
      },
    });
    const chunks = await collect(playback.wrap(inner).stream("x", { signal: ctl.signal }));
    expect(chunks.length).toBeLessThan(10);
  });
});

describe("the browser's own voice", () => {
  test("a sentence is sent as text once, and the stream lasts about as long as speaking it", async () => {
    const said: string[] = [];
    let slept = 0;
    const synth = createTextSynthesizer({
      say: (t) => said.push(t),
      sleep: async (ms) => {
        slept += ms;
      },
    });
    const text = "This is a sentence of some length.";
    const chunks = await collect(synth.stream(text));
    expect(said).toEqual([text]);
    expect(chunks.length).toBeGreaterThan(5);
    expect(slept).toBeCloseTo(estimateSpeechMs(text), -2);
  });

  test("a faster rate shortens the wait, and an abort ends it at once", async () => {
    let slept = 0;
    const fast = createTextSynthesizer({
      say: () => undefined,
      rate: 10,
      sleep: async (ms) => {
        slept += ms;
      },
    });
    await collect(fast.stream("A short one."));
    expect(slept).toBeLessThan(estimateSpeechMs("A short one."));

    const ctl = new AbortController();
    const said: string[] = [];
    const synth = createTextSynthesizer({
      say: (t) => said.push(t),
      sleep: async () => {
        ctl.abort();
      },
    });
    expect((await collect(synth.stream("Cut short please.", { signal: ctl.signal }))).length).toBe(
      0,
    );
    expect(said).toEqual(["Cut short please."]);
  });
});
