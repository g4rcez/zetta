import captureUrl from "./capture.worklet.ts?worker&url";
import playbackUrl from "./playback.worklet.ts?worker&url";

/** What a call needs of the page's audio: the microphone in as 20 ms frames, the bot's voice out. Tests replace it with a fake. */
export type AudioSession = {
  /** 16 kHz samples of the bot's voice (the bytes of one socket message). */
  push(bytes: ArrayBuffer): void;
  /** Drop what is queued, now. */
  clear(): void;
  /** A new reply starts: count the played samples from zero. */
  resetPlayed(): void;
  /** Stop everything: the microphone is let go and the audio context closes. */
  close(): void;
};
export type AudioHandlers = {
  onFrame(bytes: Uint8Array): void;
  onLevel(level: number): void;
  onPlayed(samples: number): void;
};
export type OpenAudio = (stream: MediaStream, handlers: AudioHandlers) => Promise<AudioSession>;

/**
 * The real audio of a call. One AudioContext holds the microphone (an AudioWorklet that resamples to 16 kHz and cuts 20 ms frames) and
 * the speaker (a worklet with a small jitter buffer), so the bot's voice plays through the same page that listens: the browser's echo
 * canceller then has the reference it needs, and the bot does not hear itself. The worklets are bundled by Vite and served from the
 * app's own origin.
 */
export const openAudio: OpenAudio = async (stream, handlers) => {
  const context = new AudioContext({ latencyHint: "interactive" });
  try {
    await context.resume();
    await Promise.all([
      context.audioWorklet.addModule(captureUrl),
      context.audioWorklet.addModule(playbackUrl),
    ]);
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, "zetta-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    capture.port.onmessage = (e: MessageEvent<{ frame: Uint8Array; level?: number }>) => {
      handlers.onFrame(e.data.frame);
      if (e.data.level !== undefined) handlers.onLevel(e.data.level);
    };
    source.connect(capture);
    const playback = new AudioWorkletNode(context, "zetta-playback", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    playback.port.onmessage = (e: MessageEvent<{ played: number }>) =>
      handlers.onPlayed(e.data.played);
    playback.connect(context.destination);
    return {
      push: (bytes) => playback.port.postMessage({ type: "push", bytes }, [bytes]),
      clear: () => playback.port.postMessage({ type: "clear" }),
      resetPlayed: () => playback.port.postMessage({ type: "reset" }),
      close() {
        capture.port.onmessage = null;
        playback.port.onmessage = null;
        source.disconnect();
        playback.disconnect();
        void context.close().catch(() => undefined);
      },
    };
  } catch (e) {
    void context.close().catch(() => undefined);
    throw e;
  }
};
