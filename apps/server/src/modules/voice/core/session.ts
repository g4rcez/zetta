import { asksToStop } from "../../chat/stop-intent";
import { FRAME_MS, pcm16ToFloat } from "./audio";
import { END_SILENCE_MS, EXTEND_MS, looksUnfinished } from "./end-of-turn";
import { SpeakableStream } from "./speakable";
import type {
  Clock,
  Synthesizer,
  TimerHandle,
  TurnFollower,
  TurnHandle,
  VoiceTranscriber,
} from "./types";
import type { Vad } from "./vad";

/**
 * One spoken conversation with a bot: a state machine that takes the person's audio in 20 ms frames and gives audio back. It owns no
 * network and no model: the voice activity detector, the recognizer, the synthesizer, the bot's turn and the clock are all injected, so
 * a browser socket or a phone line only has to feed `pushAudio` and play the `audio` events.
 *
 *   listening: waiting for the person (or hearing them).   thinking: the bot's turn runs and nothing is playing.
 *   speaking: the reply is being played.   interrupted: the person spoke over the bot; their words are being collected.   ended.
 *
 * The answer stays the bot's own: the person's words go to the bot's normal turn (`TurnFollower`), and the reply text is spoken
 * sentence by sentence as it streams (`SpeakableStream`).
 */

export type SessionState = "listening" | "thinking" | "speaking" | "interrupted" | "ended";

export type SessionEvent =
  | { type: "state"; state: SessionState }
  /** Audio to play, 16 kHz mono 16-bit. `filler` is a short "one moment", not part of the reply. */
  | { type: "audio"; pcm: Int16Array; kind: "reply" | "filler" }
  /** Drop every sample not played yet, now: the person spoke over the bot. */
  | { type: "flush" }
  /** What the person said (one utterance). */
  | { type: "transcript"; text: string }
  /** A sentence of the reply that is about to be spoken (for captions). */
  | { type: "reply-text"; text: string }
  /** A reply is over, heard in full or cut. `spokenChars` is how much of `replyChars` the person heard. */
  | { type: "reply"; text: string; spokenChars: number; replyChars: number; interrupted: boolean }
  | { type: "error"; message: string };

export const SESSION_DEFAULTS = {
  /** Silence after the person's turn before the bot says a short "one moment". */
  fillerAfterMs: 1500,
  /** Silent tool work (no text, no sound) before a second one. */
  longWaitMs: 8000,
  /** Audio kept from before speech was detected, so the first syllable is not cut. */
  prerollMs: 500,
};

const FILLERS: Record<string, readonly [string, string]> = {
  en: ["One moment", "Still working on it"],
  pt: ["Um momento", "Ainda estou nisso"],
  es: ["Un momento", "Sigo con ello"],
};
const fillerFor = (language: string | undefined, n: 0 | 1) =>
  (FILLERS[(language ?? "en").toLowerCase().slice(0, 2)] ?? FILLERS.en!)[n];

type Segment = { chars: number; samples: number; complete: boolean };
type Item = { text: string; kind: "reply" | "filler"; segment?: Segment };
type Turn = {
  handle: TurnHandle;
  done: boolean;
  stopped: boolean;
  textSeen: boolean;
  toolSeen: boolean;
  lastTextAt: number;
  fillers: number;
};

export type SessionDeps = {
  vad: Vad;
  transcriber: VoiceTranscriber;
  synthesizer: Synthesizer;
  follower: TurnFollower;
  clock: Clock;
  emit: (event: SessionEvent) => void;
  /** The conversation's language ("pt-BR"): passed to the recognizer and the synthesizer, and picks the filler phrase. */
  language?: string;
  /** The voice of the synthesizer (the bot's own, when it has one). */
  voice?: string;
  /** Whether a whole utterance means "stop". Defaults to the chat's stop phrases. */
  isStop?: (text: string) => boolean;
  config?: Partial<typeof SESSION_DEFAULTS>;
};

export class VoiceSession {
  private st: SessionState = "listening";
  private readonly cfg: typeof SESSION_DEFAULTS;
  private readonly stream = new SpeakableStream();
  private ring: Int16Array[] = [];
  private utterance: Int16Array[] | null = null;
  private version = 0;
  private extended = false;
  private endTimer: TimerHandle | null = null;
  private speculative: { frames: number; text: Promise<string | null> } | null = null;

  private turn: Turn | null = null;
  private fillerTimer: TimerHandle | null = null;
  private waitTimer: TimerHandle | null = null;
  private queue: Item[] = [];
  private pumping = false;
  private abort: AbortController | null = null;
  private epoch = 0;
  /** After a barge-in, the old reply's text is dropped until the person's words reach the turn. */
  private discard = false;
  private segments: Segment[] = [];
  private replyText = "";
  private emitted = 0;
  private played: number | null = null;

  constructor(private readonly d: SessionDeps) {
    this.cfg = { ...SESSION_DEFAULTS, ...d.config };
  }

  get state(): SessionState {
    return this.st;
  }

  /** One frame of the person's audio (16 kHz mono 16-bit, normally 20 ms). */
  pushAudio(frame: Int16Array) {
    if (this.st === "ended") return;
    if (this.utterance) this.utterance.push(frame);
    else {
      this.ring.push(frame);
      const keep = Math.ceil(this.cfg.prerollMs / FRAME_MS);
      if (this.ring.length > keep) this.ring.shift();
    }
    const event = this.d.vad.push(frame);
    if (event === "speech-start") this.onSpeechStart();
    else if (event === "speech-end") this.onSpeechEnd();
  }

  /**
   * The transport tells how many samples of this reply the person has really heard (what the player consumed). Without it the session
   * counts what it sent, which is more than was heard when the transport buffers.
   */
  reportPlayed(samples: number) {
    this.played = samples;
  }

  /** The person hung up. A running bot turn is left to finish: its answer is saved in the chat like any other. */
  end() {
    if (this.st === "ended") return;
    this.epoch++;
    this.abort?.abort();
    this.queue = [];
    this.clearTimers();
    this.clearEndTimer();
    this.finishReply(true);
    this.setState("ended");
  }

  private setState(s: SessionState) {
    if (this.st === s || this.st === "ended") return;
    this.st = s;
    this.d.emit({ type: "state", state: s });
  }

  private clearEndTimer() {
    if (this.endTimer !== null) this.d.clock.clearTimeout(this.endTimer);
    this.endTimer = null;
  }
  private clearTimers() {
    for (const t of [this.fillerTimer, this.waitTimer])
      if (t !== null) this.d.clock.clearTimeout(t);
    this.fillerTimer = null;
    this.waitTimer = null;
  }

  // ---- hearing the person ----

  private onSpeechStart() {
    this.clearEndTimer();
    this.extended = false;
    this.version++;
    if (!this.utterance) {
      this.utterance = this.ring;
      this.ring = [];
    }
    if (this.st === "speaking") this.bargeIn();
    else if (this.st === "thinking") this.setState("interrupted");
  }

  private onSpeechEnd() {
    if (!this.utterance) return;
    const version = this.version;
    // Recognize what was said so far at once: by the time the silence is long enough, the words are known and decide whether to wait.
    const frames = this.utterance.length;
    this.speculative = { frames, text: this.recognize(this.utterance) };
    this.clearEndTimer();
    this.endTimer = this.d.clock.setTimeout(
      () => void this.onEndTimer(version),
      Math.max(0, END_SILENCE_MS - this.d.vad.hangoverMs),
    );
  }

  private recognize(frames: Int16Array[]): Promise<string | null> {
    const total = frames.reduce((n, f) => n + f.length, 0);
    const all = new Int16Array(total);
    let at = 0;
    for (const f of frames) {
      all.set(f, at);
      at += f.length;
    }
    return this.d.transcriber
      .transcribe(pcm16ToFloat(all), { language: this.d.language })
      .catch(() => null);
  }

  private async onEndTimer(version: number) {
    this.endTimer = null;
    const spec = this.speculative;
    if (!spec || version !== this.version || this.st === "ended") return;
    const text = await spec.text;
    if (version !== this.version || this.state === "ended") return;
    if (text === null) {
      this.d.emit({ type: "error", message: "The recording could not be turned into text." });
      return this.dropUtterance();
    }
    if (looksUnfinished(text) && !this.extended) {
      this.extended = true;
      this.endTimer = this.d.clock.setTimeout(() => void this.onEndTimer(version), EXTEND_MS);
      return;
    }
    await this.finalize(text.trim());
  }

  private dropUtterance() {
    this.utterance = null;
    this.speculative = null;
    this.ring = [];
    this.discard = false;
    this.setState(this.turn && !this.turn.done ? "thinking" : "listening");
  }

  private async finalize(text: string) {
    this.utterance = null;
    this.speculative = null;
    this.ring = [];
    const running = this.turn && !this.turn.done ? this.turn : null;
    if (!text) return this.dropUtterance();
    this.d.emit({ type: "transcript", text });
    if ((this.d.isStop ?? asksToStop)(text)) {
      if (running) this.stopTurn(running);
      return this.dropUtterance();
    }
    if (running) {
      this.setState("thinking");
      try {
        await running.handle.sendLate(text);
      } catch {
        this.d.emit({ type: "error", message: "The bot could not take that message." });
      }
      this.discard = false;
      return;
    }
    this.discard = false;
    this.startTurn(text);
  }

  // ---- the bot's turn ----

  private startTurn(text: string) {
    this.stream.reset();
    const turn: Turn = {
      handle: this.d.follower.start(text, { language: this.d.language }),
      done: false,
      stopped: false,
      textSeen: false,
      toolSeen: false,
      lastTextAt: -1,
      fillers: 0,
    };
    this.turn = turn;
    this.setState("thinking");
    this.fillerTimer = this.d.clock.setTimeout(() => {
      this.fillerTimer = null;
      if (this.turn === turn && !turn.textSeen) this.speakFiller(turn);
    }, this.cfg.fillerAfterMs);
    void this.consume(turn);
  }

  private stopTurn(turn: Turn) {
    turn.stopped = true;
    turn.done = true;
    this.clearTimers();
    this.epoch++;
    this.abort?.abort();
    this.queue = [];
    this.stream.reset();
    void Promise.resolve(turn.handle.stop()).catch(() => undefined);
    this.finishReply(true);
  }

  private async consume(turn: Turn) {
    try {
      for await (const ev of turn.handle.events) {
        if (this.turn !== turn || turn.stopped) return;
        if (ev.kind === "tool") {
          turn.toolSeen = true;
          this.armLongWait(turn);
          continue;
        }
        if (!ev.text) continue;
        turn.textSeen = true;
        turn.lastTextAt = this.d.clock.now();
        this.clearTimers();
        if (this.discard) continue;
        for (const s of this.stream.push(ev.text)) this.enqueue(s);
      }
    } catch {
      if (this.turn === turn) this.d.emit({ type: "error", message: "The bot's turn failed." });
    }
    if (this.turn !== turn || turn.stopped) return;
    if (!this.discard) for (const s of this.stream.flush()) this.enqueue(s);
    turn.done = true;
    this.clearTimers();
    if (!this.pumping && !this.queue.length && this.st !== "interrupted") this.settle();
  }

  private speakFiller(turn: Turn) {
    if (this.st === "interrupted" || this.pumping || this.queue.length || turn.fillers > 1) return;
    const text = fillerFor(this.d.language, turn.fillers === 0 ? 0 : 1);
    turn.fillers++;
    this.queue.push({ text, kind: "filler" });
    void this.pump();
    this.armLongWait(turn);
  }

  /** The second filler: after `longWaitMs` with tool work going on and no text since. */
  private armLongWait(turn: Turn) {
    if (turn.fillers >= 2) return;
    if (this.waitTimer !== null) this.d.clock.clearTimeout(this.waitTimer);
    const armedAt = this.d.clock.now();
    this.waitTimer = this.d.clock.setTimeout(() => {
      this.waitTimer = null;
      if (this.turn === turn && !turn.done && turn.toolSeen && turn.lastTextAt < armedAt)
        this.speakFiller(turn);
    }, this.cfg.longWaitMs);
  }

  // ---- speaking ----

  private enqueue(sentence: string) {
    const segment: Segment = { chars: sentence.length, samples: 0, complete: false };
    this.segments.push(segment);
    this.replyText += (this.replyText ? " " : "") + sentence;
    this.queue.push({ text: sentence, kind: "reply", segment });
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && this.state !== "ended") {
        const item = this.queue.shift()!;
        const epoch = this.epoch;
        const ctl = new AbortController();
        this.abort = ctl;
        this.setState("speaking");
        if (item.kind === "reply") this.d.emit({ type: "reply-text", text: item.text });
        try {
          for await (const pcm of this.d.synthesizer.stream(item.text, {
            signal: ctl.signal,
            language: this.d.language,
            voice: this.d.voice,
          })) {
            if (epoch !== this.epoch) break;
            if (item.segment) item.segment.samples += pcm.length;
            if (item.kind === "reply") this.emitted += pcm.length;
            this.d.emit({ type: "audio", pcm, kind: item.kind });
          }
          if (epoch === this.epoch && item.segment) item.segment.complete = true;
        } catch {
          if (epoch === this.epoch) {
            if (item.segment) item.segment.complete = true;
            this.d.emit({ type: "error", message: "That could not be spoken." });
          }
        }
      }
    } finally {
      this.pumping = false;
      this.abort = null;
    }
    if (this.state === "ended" || this.state === "interrupted") return;
    if (this.queue.length) return void this.pump();
    if (this.turn && !this.turn.done) this.setState("thinking");
    else this.settle();
  }

  /** The turn is over and nothing is left to play. */
  private settle() {
    this.finishReply(false);
    this.setState("listening");
  }

  private bargeIn() {
    this.epoch++;
    this.abort?.abort();
    this.queue = [];
    this.stream.reset();
    if (this.turn && !this.turn.done) this.discard = true;
    this.d.emit({ type: "flush" });
    this.finishReply(true);
    this.setState("interrupted");
  }

  /** Records the reply that just ended or was cut: how much of it was heard. */
  private finishReply(interrupted: boolean) {
    if (!this.replyText) return;
    const replyChars = this.segments.reduce((n, s) => n + s.chars, 0);
    let remaining = this.played ?? this.emitted;
    const done = this.segments.filter((s) => s.complete && s.samples > 0);
    const perChar = done.length
      ? done.reduce((n, s) => n + s.samples, 0) / done.reduce((n, s) => n + s.chars, 0)
      : 1000;
    let spokenChars = 0;
    for (const s of this.segments) {
      if (remaining <= 0 || s.samples === 0) continue;
      const take = Math.min(remaining, s.samples);
      spokenChars += s.complete
        ? Math.round((s.chars * take) / s.samples)
        : Math.min(s.chars, Math.round(take / perChar));
      remaining -= take;
    }
    this.d.emit({
      type: "reply",
      text: this.replyText,
      spokenChars: Math.min(spokenChars, replyChars),
      replyChars,
      interrupted,
    });
    this.segments = [];
    this.replyText = "";
    this.emitted = 0;
    this.played = null;
  }
}
