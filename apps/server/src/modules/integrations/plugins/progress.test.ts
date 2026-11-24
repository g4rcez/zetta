import { describe, expect, test } from "bun:test";

import { clock, formatProgress } from "./progress";

describe("progress text", () => {
  test("clock reads like a player", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(648)).toBe("10:48");
    expect(clock(3723)).toBe("1:02:03");
    expect(clock(-5)).toBe("0:00");
  });

  test("a download shows percent, speed and the time left", () => {
    expect(
      formatProgress({ stage: "Downloading", percent: 45.3, speed: "1.20MiB/s", eta: "00:05" }),
    ).toBe("Downloading · 45% · 1.20MiB/s · ETA 00:05");
  });

  test("an unknown time left is left out", () => {
    expect(formatProgress({ stage: "Downloading", percent: 0.2, eta: "Unknown" })).toBe(
      "Downloading · 0%",
    );
  });

  test("a transcription shows how much sound is done, with or without the total", () => {
    expect(
      formatProgress({
        stage: "Transcribing",
        percent: 61.7,
        doneSeconds: 648,
        totalSeconds: 1051,
      }),
    ).toBe("Transcribing · 62% · 10:48 of 17:31");
    expect(formatProgress({ stage: "Transcribing", doneSeconds: 90 })).toBe(
      "Transcribing · 1:30 done",
    );
  });

  test("a stage alone, and a percent outside 0-100, stay sane", () => {
    expect(formatProgress({ stage: "Looking for captions" })).toBe("Looking for captions");
    expect(formatProgress({ stage: "Saving", percent: 140 })).toBe("Saving · 100%");
  });
});
