import { describe, expect, test } from "bun:test";
import { dayKey, groupByDay, monthRange } from "./calendar-days";

describe("calendar helpers", () => {
  test("groups items by local day, sorted by time", () => {
    const a = new Date(2026, 5, 3, 9, 0).toISOString(), b = new Date(2026, 5, 3, 8, 0).toISOString(), c = new Date(2026, 5, 4, 7, 0).toISOString();
    const g = groupByDay([{ at: a, routineId: "1", title: "A", kind: "scheduled" }, { at: b, routineId: "2", title: "B", kind: "ran", status: "succeeded" }, { at: c, routineId: "1", title: "A", kind: "scheduled" }]);
    expect(g.get("2026-06-03")!.map((i) => i.title)).toEqual(["B", "A"]); expect(g.get("2026-06-04")).toHaveLength(1);
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
  test("month range stays within the server cap of 62 days", () => {
    const { from, to } = monthRange(new Date(2026, 1, 15));
    expect((to.getTime() - from.getTime()) / 86400000).toBeLessThan(62);
  });
});
