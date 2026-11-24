import { CaptureCore } from "./call-audio";

/**
 * The microphone side of a voice call, in the audio thread: every block the microphone gives is resampled to 16 kHz, cut into 20 ms
 * frames and posted to the page, together with how loud the block was. Loaded with `audioWorklet.addModule` from the app's own origin.
 */
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly core = new CaptureCore(sampleRate);
  private since = 0;
  private level = 0;

  process(inputs: Float32Array[][]) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    const { frames, level } = this.core.process(channel);
    this.level = Math.max(this.level, level);
    for (const frame of frames) {
      this.since++;
      // The loudness goes with every other frame (25 a second), enough for a meter.
      const message = this.since % 2 === 0 ? { frame, level: this.level } : { frame };
      if (this.since % 2 === 0) this.level = 0;
      this.port.postMessage(message, [frame.buffer]);
    }
    return true;
  }
}
registerProcessor("zetta-capture", CaptureProcessor);
