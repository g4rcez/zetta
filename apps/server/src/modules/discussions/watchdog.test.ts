import { describe, expect, test } from "bun:test";
import { verdict, type VerdictInput } from "./watchdog";

const MIN = 60_000;
const now = 100 * MIN;
const rec = { abort: new AbortController(), lastEventAt: now, done: false };
const base: VerdictInput = {
  entry: { rec },
  claimedAt: now - 30 * MIN,
  now,
  stuckMs: 10 * MIN,
  graceMs: MIN,
  activity: now - MIN,
};

describe("verdict", () => {
  test("a turn with recent activity is fine", () => {
    expect(verdict(base)).toBeUndefined();
  });

  test("a turn silent for more than the limit is stuck", () => {
    expect(verdict({ ...base, activity: now - 11 * MIN })).toBe("silent");
    expect(verdict({ ...base, activity: now - 9 * MIN })).toBeUndefined();
  });

  test("a command that is still printing is never stopped, however old the last event is", () => {
    // `activity` is the newer of the last event and the last output: the output is a minute old.
    expect(verdict({ ...base, activity: now - MIN })).toBeUndefined();
  });

  test("a claimed turn with no run record after the limit never started", () => {
    expect(verdict({ ...base, entry: {}, claimedAt: now - 11 * MIN })).toBe("never_started");
    expect(verdict({ ...base, entry: {}, claimedAt: now - 2 * MIN })).toBeUndefined();
  });

  test("a running turn this server has no entry for is gone, after a short grace", () => {
    expect(verdict({ ...base, entry: undefined, claimedAt: now - 61_000 })).toBe("gone");
    expect(verdict({ ...base, entry: undefined, claimedAt: now - 10_000 })).toBeUndefined();
  });

  test("a run whose process is gone is stuck once it has been quiet past the grace", () => {
    expect(verdict({ ...base, gone: true, activity: now - 2 * MIN })).toBe("gone");
    expect(verdict({ ...base, gone: true, activity: now - 10_000 })).toBeUndefined();
  });
});
