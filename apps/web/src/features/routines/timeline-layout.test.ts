import { describe, expect, test } from "bun:test";
import { layoutTimeline, type TimelineRun } from "./timeline-layout";

const run = (o: Partial<TimelineRun>): TimelineRun => ({
  id: "r",
  routineId: "a",
  title: "A",
  status: "succeeded",
  trigger: "schedule",
  conversationId: null,
  startedAt: "2026-01-01T01:00:00Z",
  finishedAt: "2026-01-01T02:00:00Z",
  ...o,
});
const from = Date.parse("2026-01-01T00:00:00Z"),
  to = Date.parse("2026-01-01T04:00:00Z");

describe("layoutTimeline", () => {
  test("places a finished run as a percentage of the window", () => {
    const [lane] = layoutTimeline([run({})], from, to, to);
    expect(lane!.bars[0]).toMatchObject({ left: 25, width: 25 });
  });
  test("a running run extends to now", () => {
    const [lane] = layoutTimeline(
      [run({ status: "running", finishedAt: null })],
      from,
      to,
      Date.parse("2026-01-01T03:00:00Z"),
    );
    expect(lane!.bars[0]).toMatchObject({ left: 25, width: 50 });
  });
  test("lanes with a running run come first", () => {
    const lanes = layoutTimeline(
      [
        run({ routineId: "a", title: "A" }),
        run({ id: "b", routineId: "b", title: "B", status: "running", finishedAt: null }),
      ],
      from,
      to,
      to,
    );
    expect(lanes.map((l) => l.title)).toEqual(["B", "A"]);
  });
});
