import { describe, expect, test } from "bun:test";
import { FRAME_MS, FRAME_SAMPLES } from "./audio";
import { VoiceSession, type SessionEvent } from "./session";
import { noise, tone } from "./test-audio";
import type { Clock, SynthesizeOptions, TurnEvent, TurnHandle } from "./types";
import { createEnergyVad } from "./vad";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

class FakeClock implements Clock {
  t = 0;
  private id = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.t;
  setTimeout(fn: () => void, ms: number) {
    this.timers.set(++this.id, { at: this.t + ms, fn });
    return this.id;
  }
  clearTimeout(h: unknown) {
    this.timers.delete(h as number);
  }
  async advance(ms: number) {
    const target = this.t + ms;
    for (;;) {
      const next = [...this.timers.entries()]
        .sort((a, b) => a[1].at - b[1].at)
        .find(([, v]) => v.at <= target);
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = Math.max(this.t, next[1].at);
      next[1].fn();
      await settle();
    }
    this.t = target;
    await settle();
  }
}

/** A bot turn the test drives by hand. */
class FakeTurn implements TurnHandle {
  late: string[] = [];
  stopped = false;
  private queue: (TurnEvent | null)[] = [];
  private wake: (() => void) | null = null;
  constructor(readonly text: string) {}
  events = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<TurnEvent>> => {
        while (!this.queue.length) await new Promise<void>((r) => (this.wake = r));
        const e = this.queue.shift()!;
        return e === null ? { done: true, value: undefined } : { done: false, value: e };
      },
    }),
  };
  private put(e: TurnEvent | null) {
    this.queue.push(e);
    this.wake?.();
  }
  say = (text: string) => this.put({ kind: "delta", text });
  tool = () => this.put({ kind: "tool" });
  finish = () => this.put(null);
  sendLate(text: string) {
    this.late.push(text);
  }
  stop() {
    this.stopped = true;
    this.put(null);
  }
}

type Harness = ReturnType<typeof setup>;
function setup(opts: { language?: string; transcripts?: string[] } = {}) {
  const clock = new FakeClock();
  const events: SessionEvent[] = [];
  const spoken: { text: string; voice?: string; language?: string }[] = [];
  const turns: FakeTurn[] = [];
  const transcripts = [...(opts.transcripts ?? [])];
  let transcribeCalls = 0;
  const gate = { hold: false, release: null as null | (() => void) };
  const session = new VoiceSession({
    vad: createEnergyVad(),
    clock,
    language: opts.language,
    voice: "v1",
    emit: (e) => events.push(e),
    transcriber: {
      async transcribe() {
        transcribeCalls++;
        return transcripts.length > 1 ? transcripts.shift()! : (transcripts[0] ?? "");
      },
    },
    synthesizer: {
      async synthesize() {
        return new Int16Array(0);
      },
      async *stream(text: string, o?: SynthesizeOptions) {
        spoken.push({ text, voice: o?.voice, language: o?.language });
        yield new Int16Array(1600).fill(100);
        if (gate.hold)
          await new Promise<void>((r) => {
            gate.release = r;
            o?.signal?.addEventListener("abort", () => r(), { once: true });
          });
        if (o?.signal?.aborted) return;
        yield new Int16Array(1600).fill(100);
      },
    },
    follower: {
      start(text) {
        const t = new FakeTurn(text);
        turns.push(t);
        return t;
      },
    },
  });
  const frame = (pcm: Int16Array) => session.pushAudio(pcm);
  const feed = async (pcm: Int16Array) => {
    for (let i = 0; i + FRAME_SAMPLES <= pcm.length; i += FRAME_SAMPLES) {
      frame(pcm.slice(i, i + FRAME_SAMPLES));
      await clock.advance(FRAME_MS);
    }
  };
  let seed = 1;
  const quiet = (ms: number) => feed(noise(ms, 0.003, seed++));
  const talk = (ms: number) => feed(tone(ms, 0.3));
  const types = () => events.map((e) => e.type);
  const of = <T extends SessionEvent["type"]>(type: T) =>
    events.filter((e): e is Extract<SessionEvent, { type: T }> => e.type === type);
  return {
    session,
    clock,
    events,
    spoken,
    turns,
    quiet,
    talk,
    types,
    of,
    gate,
    calls: () => transcribeCalls,
  };
}

/** One quiet second to calibrate the voice detector, as a real call starts. */
async function ready(h: Harness) {
  await h.quiet(600);
}

describe("a spoken turn", () => {
  test("the words go to the bot and the reply is spoken as it streams", async () => {
    const h = setup({ transcripts: ["What is the weather today?"] });
    await ready(h);
    await h.talk(600);
    await h.quiet(900);
    expect(h.turns).toHaveLength(1);
    expect(h.turns[0]!.text).toBe("What is the weather today?");
    expect(h.session.state).toBe("thinking");
    expect(h.of("transcript")[0]!.text).toBe("What is the weather today?");

    h.turns[0]!.say("It is sunny. And w");
    await settle();
    expect(h.spoken.map((s) => s.text)).toEqual(["It is sunny."]);
    expect(h.session.state).toBe("thinking");
    expect(h.of("audio")).toHaveLength(2);
    h.turns[0]!.say("arm today.");
    h.turns[0]!.finish();
    await settle();
    await settle();
    expect(h.spoken.map((s) => s.text)).toEqual(["It is sunny.", "And warm today."]);
    expect(h.session.state).toBe("listening");
    const reply = h.of("reply");
    expect(reply).toHaveLength(1);
    expect(reply[0]).toMatchObject({ interrupted: false, text: "It is sunny. And warm today." });
    expect(reply[0]!.spokenChars).toBe(reply[0]!.replyChars);
    expect(h.spoken[0]!.voice).toBe("v1");
  });

  test("code and tool blocks in the reply are not spoken", async () => {
    const h = setup({ transcripts: ["Do it."] });
    await ready(h);
    await h.talk(500);
    await h.quiet(900);
    h.turns[0]!.say("Done.\n```zetta:x\n{}\n```\nAll set.");
    h.turns[0]!.finish();
    await settle();
    await settle();
    expect(h.spoken.map((s) => s.text)).toEqual(["Done.", "All set."]);
  });

  test("noise shorter than 200 ms starts nothing", async () => {
    const h = setup({ transcripts: ["x"] });
    await ready(h);
    await h.talk(100);
    await h.quiet(2000);
    expect(h.turns).toHaveLength(0);
    expect(h.calls()).toBe(0);
    expect(h.session.state).toBe("listening");
  });

  test("an empty transcript is dropped", async () => {
    const h = setup({ transcripts: [""] });
    await ready(h);
    await h.talk(500);
    await h.quiet(1000);
    expect(h.turns).toHaveLength(0);
    expect(h.of("transcript")).toHaveLength(0);
    expect(h.session.state).toBe("listening");
  });
});

describe("end of turn", () => {
  test("a finished sentence goes after 700 ms of silence", async () => {
    const h = setup({ transcripts: ["Hello there."] });
    await ready(h);
    await h.talk(500);
    await h.quiet(600);
    expect(h.turns).toHaveLength(0);
    await h.quiet(200);
    expect(h.turns).toHaveLength(1);
  });

  test("an unfinished one waits 500 ms more", async () => {
    const h = setup({ transcripts: ["I want to talk about"] });
    await ready(h);
    await h.talk(500);
    await h.quiet(1000);
    expect(h.turns).toHaveLength(0);
    await h.quiet(300);
    expect(h.turns).toHaveLength(1);
  });

  test("speaking again during the wait makes one utterance", async () => {
    const h = setup({ transcripts: ["I want to talk about", "I want to talk about the budget."] });
    await ready(h);
    await h.talk(500);
    await h.quiet(900);
    await h.talk(500);
    await h.quiet(900);
    expect(h.turns).toHaveLength(1);
    expect(h.turns[0]!.text).toBe("I want to talk about the budget.");
  });
});

describe("barge-in", () => {
  async function speaking() {
    const h = setup({ transcripts: ["Tell me a story.", "Make it shorter."] });
    await ready(h);
    await h.talk(500);
    await h.quiet(900);
    h.gate.hold = true;
    h.turns[0]!.say("Once upon a time there was a fox. The fox was clever. ");
    await settle();
    return h;
  }

  test("the person speaking for 200 ms flushes the audio at once", async () => {
    const h = await speaking();
    expect(h.session.state).toBe("speaking");
    const before = h.events.length;
    await h.talk(260);
    const after = h.events.slice(before).map((e) => e.type);
    expect(after).toContain("flush");
    expect(h.session.state).toBe("interrupted");
    // no audio of the old reply after the flush
    expect(after.slice(after.indexOf("flush")).includes("audio")).toBe(false);
  });

  test("less than 200 ms does not interrupt", async () => {
    const h = await speaking();
    await h.talk(100);
    expect(h.types()).not.toContain("flush");
    expect(h.session.state).toBe("speaking");
  });

  test("the new utterance goes to the running turn as a late message, and the old text is dropped", async () => {
    const h = await speaking();
    await h.talk(500);
    h.turns[0]!.say("The fox ran home. "); // still the old reply
    await settle();
    await h.quiet(900);
    expect(h.turns).toHaveLength(1);
    expect(h.turns[0]!.late).toEqual(["Make it shorter."]);
    expect(h.spoken.map((s) => s.text)).toEqual(["Once upon a time there was a fox."]);
    h.gate.hold = false;
    h.turns[0]!.say("A fox lived. The end.");
    h.turns[0]!.finish();
    await settle();
    await settle();
    expect(h.spoken.map((s) => s.text)).toEqual([
      "Once upon a time there was a fox.",
      "A fox lived.",
      "The end.",
    ]);
    expect(h.session.state).toBe("listening");
  });

  test("spokenChars counts only what was heard before the cut", async () => {
    const h = await speaking();
    await h.talk(300);
    const r = h.of("reply")[0]!;
    expect(r.interrupted).toBe(true);
    expect(r.replyChars).toBeGreaterThan(30);
    // first chunk of the first sentence (1600 of an unknown 3200) was sent
    expect(r.spokenChars).toBeGreaterThan(0);
    expect(r.spokenChars).toBeLessThan("Once upon a time there was a fox.".length);
  });

  test("reportPlayed overrides what was sent", async () => {
    const h = await speaking();
    h.session.reportPlayed(0);
    await h.talk(300);
    expect(h.of("reply")[0]!.spokenChars).toBe(0);
  });

  test("a heard sentence counts in full", async () => {
    const h = setup({ transcripts: ["Go."] });
    await ready(h);
    await h.talk(500);
    await h.quiet(900);
    h.turns[0]!.say("First one. ");
    await settle();
    await settle();
    h.gate.hold = true;
    h.turns[0]!.say("Second one is longer. ");
    await settle();
    await h.talk(300);
    const r = h.of("reply")[0]!;
    expect(r.spokenChars).toBeGreaterThanOrEqual("First one.".length);
    expect(r.spokenChars).toBeLessThan(r.replyChars);
  });

  test("speaking while the bot is still thinking sends a late message and does not flush", async () => {
    const h = setup({ transcripts: ["Check the logs.", "And the metrics."] });
    await ready(h);
    await h.talk(500);
    await h.quiet(900);
    await h.talk(500);
    expect(h.session.state).toBe("interrupted");
    await h.quiet(900);
    expect(h.types()).not.toContain("flush");
    expect(h.turns[0]!.late).toEqual(["And the metrics."]);
    expect(h.session.state).toBe("thinking");
  });

  test("after the reply was fully generated, an interruption starts a new turn", async () => {
    const h = await speaking();
    h.turns[0]!.finish();
    await settle();
    await h.talk(500);
    await h.quiet(900);
    expect(h.turns).toHaveLength(2);
    expect(h.turns[1]!.text).toBe("Make it shorter.");
  });
});

describe("stop phrases", () => {
  test("'stop' while the bot speaks stops the turn", async () => {
    const h = setup({ transcripts: ["Tell me a story.", "Stop."] });
    await ready(h);
    await h.talk(500);
    await h.quiet(900);
    h.gate.hold = true;
    h.turns[0]!.say("Once upon a time there was a fox. ");
    await settle();
    await h.talk(500);
    await h.quiet(900);
    expect(h.turns[0]!.stopped).toBe(true);
    expect(h.turns[0]!.late).toEqual([]);
    expect(h.session.state).toBe("listening");
    expect(h.types()).toContain("flush");
  });

  test("a stop phrase with nothing running is ignored, not sent to the bot", async () => {
    const h = setup({ transcripts: ["Stop."] });
    await ready(h);
    await h.talk(500);
    await h.quiet(900);
    expect(h.turns).toHaveLength(0);
    expect(h.session.state).toBe("listening");
  });

  test("a sentence that merely contains the word goes on to the bot", async () => {
    const h = setup({ transcripts: ["Stop the dev server and restart it."] });
    await ready(h);
    await h.talk(500);
    await h.quiet(900);
    expect(h.turns).toHaveLength(1);
  });
});

describe("fillers", () => {
  test("one short phrase after 1.5 s without text, in the conversation's language", async () => {
    const h = setup({ language: "pt-BR", transcripts: ["Qual é o plano?"] });
    await ready(h);
    await h.talk(500);
    await h.quiet(720);
    h.spoken.length = 0;
    await h.clock.advance(1400);
    expect(h.spoken).toEqual([]);
    await h.clock.advance(200);
    expect(h.spoken.map((s) => s.text)).toEqual(["Um momento"]);
    expect(h.spoken[0]!.language).toBe("pt-BR");
    expect(h.of("audio").some((a) => a.kind === "filler")).toBe(true);
    // nothing more without tool work, however long the wait
    await h.clock.advance(30_000);
    expect(h.spoken).toHaveLength(1);
    // a filler is not part of the reply
    h.turns[0]!.say("O plano é simples.");
    h.turns[0]!.finish();
    await settle();
    await settle();
    expect(h.of("reply")[0]!.text).toBe("O plano é simples.");
  });

  test("Spanish and English phrases", async () => {
    for (const [language, phrase] of [
      ["es", "Un momento"],
      ["en-US", "One moment"],
      [undefined, "One moment"],
    ] as const) {
      const h = setup({ language, transcripts: ["Hello there."] });
      await ready(h);
      await h.talk(500);
      await h.quiet(720);
      h.spoken.length = 0;
      await h.clock.advance(1600);
      expect(h.spoken.map((s) => s.text)).toEqual([phrase]);
    }
  });

  test("no filler when text arrives within 1.5 s", async () => {
    const h = setup({ transcripts: ["Hello there."] });
    await ready(h);
    await h.talk(500);
    await h.quiet(720);
    await h.clock.advance(1000);
    h.turns[0]!.say("Hi. ");
    await settle();
    h.spoken.length = 0;
    await h.clock.advance(5000);
    expect(h.spoken).toEqual([]);
  });

  test("a second one after 8 s of silent tool work, and no third", async () => {
    const h = setup({ transcripts: ["Hello there."] });
    await ready(h);
    await h.talk(500);
    await h.quiet(720);
    h.turns[0]!.tool();
    await settle();
    await h.clock.advance(1600);
    expect(h.spoken.map((s) => s.text)).toEqual(["One moment"]);
    await h.clock.advance(8000);
    expect(h.spoken.map((s) => s.text)).toEqual(["One moment", "Still working on it"]);
    await h.clock.advance(60_000);
    expect(h.spoken).toHaveLength(2);
  });
});

describe("ending", () => {
  test("end stops the session and ignores more audio", async () => {
    const h = setup({ transcripts: ["Hello there."] });
    await ready(h);
    h.session.end();
    expect(h.session.state).toBe("ended");
    await h.talk(500);
    await h.quiet(900);
    expect(h.turns).toHaveLength(0);
  });

  test("a failing recognizer reports an error and goes back to listening", async () => {
    const h = setup();
    const failing = new VoiceSession({
      vad: createEnergyVad(),
      clock: h.clock,
      emit: (e) => h.events.push(e),
      transcriber: { transcribe: async () => Promise.reject(new Error("boom")) },
      synthesizer: { synthesize: async () => new Int16Array(0), async *stream() {} },
      follower: { start: () => new FakeTurn("x") },
    });
    for (let i = 0; i < 30; i++) failing.pushAudio(noise(20, 0.003, i + 1));
    for (let i = 0; i < 25; i++) failing.pushAudio(tone(20, 0.3));
    for (let i = 0; i < 40; i++) {
      failing.pushAudio(noise(20, 0.003, i + 99));
      await h.clock.advance(20);
    }
    expect(h.of("error")).toHaveLength(1);
    expect(failing.state).toBe("listening");
  });
});
