import { describe, expect, test } from "bun:test";
import { roomToFlow } from "./room-graph";
import type { DiscussionMember, RoomTask, RoomTurn } from "./discussions-api";

const member = (botId: string, name: string): DiscussionMember => ({
  botId,
  name,
  role: "",
  requireApproval: false,
  turns: 0,
  code: false,
});
const turn = (
  id: string,
  botId: string,
  status: RoomTurn["status"],
  labels: string[],
): RoomTurn => ({
  id,
  botId,
  kind: "reply",
  status,
  createdAt: "2026-10-28T10:00:00Z",
  finishedAt: null,
  steps: labels.map((label) => ({ at: "2026-10-28T10:00:01Z", kind: "activity", label })),
});
const task = (id: string, title: string, status: RoomTask["status"], botId: string): RoomTask => ({
  id,
  title,
  description: "",
  status,
  botId,
});

describe("room canvas model", () => {
  const members = [member("c", "Lead"), member("a", "Coder"), member("b", "Tester")];

  test("the chief sits on top and every other member is linked to it", () => {
    const { nodes, edges } = roomToFlow(members, "c", [], []);
    expect(nodes.map((n) => [n.id, n.position.y, n.data.kind])).toEqual([
      ["c", 0, "chief"],
      ["a", 230, "member"],
      ["b", 230, "member"],
    ]);
    expect(edges.map((e) => `${e.source}>${e.target}`)).toEqual(["c>a", "c>b"]);
  });

  test("a bot shows the state and newest step of its latest turn, and idle without one", () => {
    const turns = [
      turn("t2", "a", "running", ["Opening the file", "Running tests"]),
      turn("t1", "a", "done", ["Old step"]),
    ];
    const byId = Object.fromEntries(
      roomToFlow(members, "c", turns, []).nodes.map((n) => [n.id, n.data]),
    );
    expect([byId.a!.state, byId.a!.lastStep]).toEqual(["running", "Running tests"]);
    expect([byId.b!.state, byId.b!.lastStep]).toEqual(["idle", ""]);
  });

  test("the task report counts a bot's tasks by status and lists up to 3 that are not done", () => {
    const tasks = [
      task("1", "Build page", "in_progress", "a"),
      task("2", "Add form", "review", "a"),
      task("3", "Old", "done", "a"),
      task("4", "Other", "backlog", "b"),
    ];
    const a = roomToFlow(members, "c", [], tasks).nodes.find((n) => n.id === "a")!.data.tasks;
    expect(a).toEqual({
      counts: { in_progress: 1, review: 1, done: 1 },
      open: ["Build page", "Add form"],
    });
  });
});
