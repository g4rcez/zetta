import { SAMPLE_RATE } from "./core/audio";
import type { Clock, SynthesizeOptions, Synthesizer } from "./core/types";

/** Waits `ms`, or until the signal aborts (it then resolves at once, the caller checks the signal). */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const realSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve();
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

const chunkMs = (pcm: Int16Array) => (pcm.length * 1000) / SAMPLE_RATE;

/**
 * Keeps what is sent to the person's player close to real time. Without it a whole sentence arrives in a moment and the session thinks it
 * has finished speaking while the player still has seconds to play, so the person speaking over it is not taken for a barge-in. The
 * wrapper holds a chunk back until less than `leadMs` of audio is waiting at the player; `reset()` (the player was cleared) empties that
 * count, and `pending()` says how much would still be playing.
 */
export function createPlayback(opts: { clock: Clock; sleep?: Sleep; leadMs?: number }) {
  const sleep = opts.sleep ?? realSleep;
  const lead = opts.leadMs ?? 500;
  // The time (clock.now()) at which everything sent so far has been played.
  let playedAt = 0;
  const pending = () => Math.max(0, playedAt - opts.clock.now());
  const before = async (pcm: Int16Array, signal?: AbortSignal) => {
    const wait = pending() - lead;
    if (wait > 0) await sleep(wait, signal);
    if (signal?.aborted) return;
    playedAt = Math.max(playedAt, opts.clock.now()) + chunkMs(pcm);
  };
  return {
    pending,
    reset() {
      playedAt = 0;
    },
    /** Waits for room, then counts the chunk as sent. */
    before,
    wrap(inner: Synthesizer): Synthesizer {
      return {
        synthesize: inner.synthesize.bind(inner),
        async *stream(text: string, o?: SynthesizeOptions) {
          for await (const pcm of inner.stream(text, o)) {
            await before(pcm, o?.signal);
            if (o?.signal?.aborted) return;
            yield pcm;
          }
        },
      };
    },
  };
}

/** About how long a sentence takes to say, for a voice the server does not hear (the device's own). */
export const estimateSpeechMs = (text: string) => Math.min(30_000, Math.max(600, text.length * 65));

/**
 * The synthesizer of the `browser` mode: the device speaks, so the server sends the sentence as text (`say`) and plays nothing. To stay
 * in step with the device (so the session knows the bot is still "speaking" and a person talking over it is a barge-in), it takes about
 * as long as the sentence does and yields silent chunks, which the caller drops. `rate` above 1 makes it faster (tests).
 */
export function createTextSynthesizer(opts: {
  say: (text: string) => void;
  sleep?: Sleep;
  rate?: number;
}): Synthesizer {
  const sleep = opts.sleep ?? realSleep;
  const rate = opts.rate ?? 1;
  const TICK_MS = 100;
  const silent = new Int16Array((SAMPLE_RATE * TICK_MS) / 1000);
  async function* stream(text: string, o?: SynthesizeOptions) {
    opts.say(text);
    let left = estimateSpeechMs(text);
    while (left > 0 && !o?.signal?.aborted) {
      await sleep(Math.min(TICK_MS, left) / rate, o?.signal);
      if (o?.signal?.aborted) return;
      left -= TICK_MS;
      yield silent;
    }
  }
  return {
    stream,
    async synthesize(text, o) {
      const parts: Int16Array[] = [];
      for await (const p of stream(text, o)) parts.push(p);
      const all = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        all.set(p, at);
        at += p.length;
      }
      return all;
    },
  };
}
