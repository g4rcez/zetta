import type { Clock, TimerHandle } from "./core/types";
import { VOICE_LIMITS } from "./protocol";

export type EndReason = "idle" | "time_limit";

/**
 * The limits of one call: its length and its silence. `touch()` is called whenever anyone speaks (or the bot works); when nothing has
 * happened for `idleMs`, or the call is `maxCallMs` old, `onEnd` is called once. `busy()` tells that the bot is working or speaking,
 * which is not silence: the idle clock then starts over instead of ending the call.
 */
export function createCallWatch(opts: {
  clock: Clock;
  onEnd: (reason: EndReason) => void;
  busy?: () => boolean;
  maxCallMs?: number;
  idleMs?: number;
}) {
  const { clock } = opts;
  const maxMs = opts.maxCallMs ?? VOICE_LIMITS.maxCallMs;
  const idleMs = opts.idleMs ?? VOICE_LIMITS.idleMs;
  let last = clock.now();
  let stopped = false;
  let idle: TimerHandle | null = null;
  const arm = () => {
    if (idle !== null) clock.clearTimeout(idle);
    idle = clock.setTimeout(
      () => {
        if (stopped) return;
        const quiet = clock.now() - last;
        if (opts.busy?.()) last = clock.now();
        else if (quiet >= idleMs) {
          stopped = true;
          return opts.onEnd("idle");
        }
        arm();
      },
      Math.max(0, idleMs - (clock.now() - last)),
    );
  };
  const limit = clock.setTimeout(() => {
    if (stopped) return;
    stopped = true;
    opts.onEnd("time_limit");
  }, maxMs);
  arm();
  return {
    touch() {
      last = clock.now();
    },
    stop() {
      stopped = true;
      clock.clearTimeout(limit);
      if (idle !== null) clock.clearTimeout(idle);
    },
  };
}
