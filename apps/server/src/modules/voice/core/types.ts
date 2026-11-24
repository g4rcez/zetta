/**
 * The seams of a voice conversation. The session (`session.ts`) knows only these, so it runs the same with the real parts, with the fakes
 * of the tests, and later over a browser socket or a phone line.
 */

/** Speech to text for one finished utterance: 16 kHz mono floats between -1 and 1 (the server's `Transcriber`). */
export type VoiceTranscriber = {
  transcribe(
    pcm: Float32Array,
    opts?: { signal?: AbortSignal; language?: string },
  ): Promise<string>;
};

export type SynthesizeOptions = {
  signal?: AbortSignal;
  /** The language of the text, a tag or its first part ("pt-BR", "pt"). */
  language?: string;
  /** The provider's own voice name or id; empty means the installation's choice. */
  voice?: string;
  /** A model repository for the voice that runs inside the server (`local`); the installation's `speech_model`. */
  model?: string;
};

/** Text to speech. Every sample is 16 kHz mono 16-bit, whatever the provider sends. */
export type Synthesizer = {
  synthesize(text: string, opts?: SynthesizeOptions): Promise<Int16Array>;
  /** The same audio in chunks, as the provider produces them, so the first sound plays before the sentence is finished. */
  stream(text: string, opts?: SynthesizeOptions): AsyncIterable<Int16Array>;
};

/** What a running bot turn says while it works. */
export type TurnEvent =
  | { kind: "delta"; text: string }
  /** The bot is working (a tool call) without saying anything. */
  | { kind: "tool" };

export type TurnHandle = {
  /** The turn's text as it streams. The iteration ends when the turn is over. */
  events: AsyncIterable<TurnEvent>;
  /** A message the person said while the turn runs: it reaches the same turn. */
  sendLate(text: string): void | Promise<void>;
  /** Stops the turn (the person said "stop"). */
  stop(): void | Promise<void>;
};

/** Starts the bot's own turn for something the person said, in the conversation the voice session belongs to. */
export type TurnFollower = {
  start(text: string, opts?: { language?: string }): TurnHandle;
};

export type TimerHandle = unknown;
export type Clock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
