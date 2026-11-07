import { describe, expect, test } from "bun:test";
import { followUpView, stepCounts, stepsOf, topLevel } from "./task-steps";
import type { Task } from "./tasks-api";

const task = (over: Partial<Task> & Pick<Task, "id" | "title">): Task => ({
  description: "",
  status: "backlog",
  priority: "none",
  labels: [],
  ownerUserId: "owner",
  assignee: "bot",
  assigneeUserId: null,
  assigneeName: null,
  botId: null,
  conversationId: null,
  parentTaskId: null,
  progress: "",
  followUp: "off",
  followUpReason: null,
  nextCheckAt: null,
  checks: 0,
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  ...over,
});

const all: Task[] = [
  task({ id: "p1", title: "Parent one" }),
  task({ id: "s2", title: "Second", parentTaskId: "p1", status: "done" }),
  task({ id: "s1", title: "First", parentTaskId: "p1", status: "done" }),
  task({ id: "s3", title: "Third", parentTaskId: "p1" }),
  task({ id: "p2", title: "Parent two" }),
  task({ id: "x1", title: "Other step", parentTaskId: "p2" }),
];

describe("steps of a task", () => {
  test("the board lists only top-level tasks", () => {
    expect(topLevel(all).map((t) => t.id)).toEqual(["p1", "p2"]);
  });
  test("a task's steps come in creation order, the id breaking a tie", () => {
    expect(stepsOf(all, "p1").map((t) => t.id)).toEqual(["s1", "s2", "s3"]);
    expect(stepsOf(all, "none")).toEqual([]);
  });
  test("each parent has its own count of done steps", () => {
    const counts = stepCounts(all);
    expect(counts.get("p1")).toEqual({ done: 2, total: 3 });
    expect(counts.get("p2")).toEqual({ done: 0, total: 1 });
    expect(counts.get("s1")).toBeUndefined();
  });
});

describe("how a follow-up shows", () => {
  test("nothing when nobody follows the task", () => {
    expect(followUpView(task({ id: "a", title: "a" }))).toBeNull();
  });
  test("following while the task is open, and not once it is done or waits for a person", () => {
    const followed = { followUp: "auto" as const };
    expect(followUpView(task({ id: "a", title: "a", ...followed }))).toMatchObject({
      label: "Following",
      tone: "info",
    });
    expect(followUpView(task({ id: "a", title: "a", ...followed, status: "done" }))).toBeNull();
    expect(followUpView(task({ id: "a", title: "a", ...followed, status: "blocked" }))).toBeNull();
  });
  test("paused shows the reason", () => {
    expect(
      followUpView(
        task({ id: "a", title: "a", followUp: "paused", followUpReason: "stopped by you" }),
      ),
    ).toEqual({ label: "Paused", tone: "warning", detail: "stopped by you" });
  });
});
