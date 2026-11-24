import { FRAME_MS, rms } from "./audio";

/**
 * Voice activity detection: feed one 20 ms frame at a time, get an event when speech starts or ends. The session depends only on this
 * interface, so a model-based detector can replace the energy one without touching it.
 */
export type VadEvent = "speech-start" | "speech-end" | null;
export type Vad = {
  push(frame: Int16Array): VadEvent;
  reset(): void;
  readonly speaking: boolean;
  /** How long after the last speech frame `speech-end` is reported. The session subtracts it from the end-of-turn silence. */
  readonly hangoverMs: number;
};

export const VAD_DEFAULTS = {
  /** Speech starts after this much sound above the level. Shorter bursts (a click, a cough) are ignored. */
  startMs: 200,
  /** Speech ends after this much silence. Natural dips inside a word or between two words are shorter. */
  hangoverMs: 200,
  /** The level never goes below this (full scale is 1): about -44 dBFS, a quiet room. */
  minLevel: 0.006,
  /** The level is this many times the measured noise floor. */
  floorRatio: 3,
  /** Where the noise floor starts. */
  initialFloor: 0.003,
  /** The first stretch of a call is taken as the room's noise: the floor is its average level and no speech is reported in it. */
  calibrateMs: 500,
};
export type EnergyVadOptions = Partial<typeof VAD_DEFAULTS>;

const FLOOR_MIN = 0.0005;
const FLOOR_MAX = 0.05;

/**
 * Energy plus hangover. A frame is speech when its RMS is above `max(minLevel, floor * floorRatio)`, where `floor` follows the noise:
 * it falls fast to a quieter room and rises slowly (about 4 seconds) to a noisier one, and it is not updated by frames that count as
 * speech, except for a very slow drift (about 40 seconds) so that a room that became permanently louder is not "speaking" forever.
 *
 * The first `calibrateMs` of a call only measure the room. Start: a score goes up by one for a speech frame and down by one for any other, and speech starts when it reaches `startMs`. End: no
 * speech frame for `hangoverMs`. Limits: it hears any loud sound, not only voices, and it cannot tell the bot's own voice coming back
 * through a microphone from the person's; echo cancellation belongs to the transport.
 */
export function createEnergyVad(options: EnergyVadOptions = {}): Vad {
  const o = { ...VAD_DEFAULTS, ...options };
  const startFrames = Math.max(1, Math.round(o.startMs / FRAME_MS));
  const hangoverFrames = Math.max(1, Math.round(o.hangoverMs / FRAME_MS));
  const calibrateFrames = Math.round(o.calibrateMs / FRAME_MS);
  let seen = 0;
  let calibrated = 0;
  let floor = o.initialFloor;
  let score = 0;
  let quiet = 0;
  let speaking = false;
  return {
    get speaking() {
      return speaking;
    },
    hangoverMs: hangoverFrames * FRAME_MS,
    reset() {
      floor = o.initialFloor;
      seen = 0;
      calibrated = 0;
      score = 0;
      quiet = 0;
      speaking = false;
    },
    push(frame) {
      const level = rms(frame);
      if (seen < calibrateFrames) {
        seen++;
        // A frame far above any room (the person already talking) does not set the floor.
        if (level <= FLOOR_MAX) {
          calibrated = Math.max(calibrated, 0) + level;
          floor = Math.min(FLOOR_MAX, Math.max(FLOOR_MIN, calibrated / seen));
        }
        return null;
      }
      const threshold = Math.max(o.minLevel, floor * o.floorRatio);
      const loud = level > threshold;
      if (loud) floor = Math.min(FLOOR_MAX, floor * 0.9995 + level * 0.0005);
      else
        floor = Math.max(
          FLOOR_MIN,
          level < floor ? floor * 0.9 + level * 0.1 : floor * 0.995 + level * 0.005,
        );
      if (!speaking) {
        score = loud ? score + 1 : Math.max(0, score - 1);
        if (score >= startFrames) {
          speaking = true;
          quiet = 0;
          score = 0;
          return "speech-start";
        }
        return null;
      }
      quiet = loud ? 0 : quiet + 1;
      if (quiet >= hangoverFrames) {
        speaking = false;
        quiet = 0;
        score = 0;
        return "speech-end";
      }
      return null;
    },
  };
}
