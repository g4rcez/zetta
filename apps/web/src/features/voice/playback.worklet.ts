import { PlayerCore, bytesToPcm16 } from "./call-audio";

/**
 * The speaker side of a voice call, in the audio thread: 16 kHz samples from the socket go into a small jitter buffer and come out at
 * the speaker's rate. `clear` drops what is queued at once. It reports the samples it has played, about four times a second.
 */
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
type Command = { type: "push"; bytes: ArrayBuffer } | { type: "clear" } | { type: "reset" };

class PlaybackProcessor extends AudioWorkletProcessor {
  private readonly core = new PlayerCore(sampleRate);
  private reported = -1;
  private blocks = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Command>) => {
      const m = e.data;
      if (m.type === "push") {
        const pcm = bytesToPcm16(m.bytes);
        if (pcm) this.core.push(pcm);
      } else if (m.type === "clear") {
        this.core.clear();
        this.reported = -1;
        this.port.postMessage({ played: 0 });
      } else this.core.resetPlayed();
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    this.core.render(out);
    for (let c = 1; c < (outputs[0]?.length ?? 0); c++) outputs[0]![c]!.set(out);
    // 128 samples a block: every ~85 blocks is about 250 ms at 44.1 or 48 kHz.
    if (++this.blocks % 85 === 0 && this.core.playedSamples !== this.reported) {
      this.reported = this.core.playedSamples;
      this.port.postMessage({ played: this.reported });
    }
    return true;
  }
}
registerProcessor("zetta-playback", PlaybackProcessor);
