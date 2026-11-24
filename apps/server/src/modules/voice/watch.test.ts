import { describe, expect, test } from "bun:test";
import { VOICE_LIMITS } from "./protocol";
import { FakeClock } from "./test-kit";
import { createCallWatch, type EndReason } from "./watch";

const setup = (opts: { busy?: () => boolean; maxCallMs?: number; idleMs?: number } = {}) => {
  const clock = new FakeClock();
  const ended: EndReason[] = [];
  const watch = createCallWatch({ clock, onEnd: (r) => ended.push(r), ...opts });
  return { clock, ended, watch };
};

describe("call limits", () => {
  test("the defaults are 30 minutes in all and 2 minutes without speech", () => {
    expect(VOICE_LIMITS.maxCallMs).toBe(30 * 60_000);
    expect(VOICE_LIMITS.idleMs).toBe(2 * 60_000);
  });

  test("a call with no speech ends after 2 minutes", async () => {
    const { clock, ended } = setup();
    await clock.advance(119_000);
    expect(ended).toEqual([]);
    await clock.advance(2_000);
    expect(ended).toEqual(["idle"]);
  });

  test("speech from either side starts the 2 minutes again", async () => {
    const { clock, ended, watch } = setup();
    await clock.advance(100_000);
    watch.touch();
    await clock.advance(100_000);
    expect(ended).toEqual([]);
    watch.touch();
    await clock.advance(119_000);
    expect(ended).toEqual([]);
    await clock.advance(2_000);
    expect(ended).toEqual(["idle"]);
  });

  test("a call that keeps talking still ends at 30 minutes", async () => {
    const { clock, ended, watch } = setup();
    for (let i = 0; i < 29; i++) {
      await clock.advance(60_000);
      watch.touch();
    }
    expect(ended).toEqual([]);
    await clock.advance(61_000);
    expect(ended).toEqual(["time_limit"]);
  });

  test("a bot at work is not silence: the idle clock starts over while it is busy", async () => {
    let busy = true;
    const { clock, ended } = setup({ busy: () => busy });
    await clock.advance(10 * 60_000);
    expect(ended).toEqual([]);
    busy = false;
    await clock.advance(119_000);
    expect(ended).toEqual([]);
    await clock.advance(5_000);
    expect(ended).toEqual(["idle"]);
  });

  test("it ends once, and nothing fires after stop()", async () => {
    const a = setup();
    await a.clock.advance(31 * 60_000);
    expect(a.ended.length).toBe(1);
    const b = setup();
    b.watch.stop();
    await b.clock.advance(31 * 60_000);
    expect(b.ended).toEqual([]);
    expect(b.clock.pending).toBe(0);
  });
});
