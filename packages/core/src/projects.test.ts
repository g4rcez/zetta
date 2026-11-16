import { describe, expect, test } from "bun:test";
import { projectHealth, type ProjectHealthInput } from "./projects";

const now = new Date("2026-11-12T12:00:00Z"); // a Thursday
const base: ProjectHealthInput = {
  status: "active",
  total: 12,
  done: 7,
  inProgress: 3,
  needsYou: 0,
  lastChange: new Date("2026-11-12T09:00:00Z"),
  now,
};

describe("project health", () => {
  test("work waiting on the reader comes first", () => {
    expect(projectHealth({ ...base, needsYou: 2 })).toEqual({
      state: "needs_you",
      sentence: "2 tasks are waiting on you. 7 of 12 done.",
    });
    expect(projectHealth({ ...base, needsYou: 1 }).sentence).toBe(
      "1 task is waiting on you. 7 of 12 done.",
    );
  });
  test("moving work is on track", () => {
    expect(projectHealth(base)).toEqual({
      state: "on_track",
      sentence: "3 in progress. 7 of 12 done.",
    });
    expect(projectHealth({ ...base, inProgress: 0 }).sentence).toBe("7 of 12 done.");
  });
  test("open work that nobody touched for three working days is quiet", () => {
    // Friday to Thursday: Mon, Tue, Wed and half of Thursday count; the weekend does not.
    const quiet = projectHealth({ ...base, lastChange: new Date("2026-11-06T12:00:00Z") });
    expect(quiet).toEqual({
      state: "quiet",
      sentence: "Nothing has moved in 4 working days. 7 of 12 done.",
    });
    // Tuesday to Thursday is two working days: still on track.
    expect(projectHealth({ ...base, lastChange: new Date("2026-11-10T12:00:00Z") }).state).toBe(
      "on_track",
    );
  });
  test("an empty project says so", () => {
    expect(projectHealth({ ...base, total: 0, done: 0, inProgress: 0, lastChange: null })).toEqual({
      state: "quiet",
      sentence: "Nothing has been asked for yet.",
    });
  });
  test("everything done", () => {
    expect(projectHealth({ ...base, done: 12, inProgress: 0 }).sentence).toBe(
      "All 12 tasks are done.",
    );
    expect(projectHealth({ ...base, total: 1, done: 1, inProgress: 0 }).sentence).toBe(
      "All 1 task is done.",
    );
  });
  test("the project status wins over the tasks", () => {
    expect(projectHealth({ ...base, status: "paused", needsYou: 3 }).state).toBe("on_hold");
    expect(projectHealth({ ...base, status: "done" })).toEqual({
      state: "done",
      sentence: "Finished. 7 of 12 done.",
    });
    expect(projectHealth({ ...base, status: "archived" }).state).toBe("done");
  });
});
