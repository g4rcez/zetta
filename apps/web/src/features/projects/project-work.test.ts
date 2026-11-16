import { expect, test } from "bun:test";
import { workByWorker } from "./project-work";
import type { ProjectTask } from "./projects-api";

const task = (over: Partial<ProjectTask>): ProjectTask => ({
  id: over.title ?? "t",
  title: "T",
  status: "in_progress",
  priority: "none",
  assignee: "bot",
  assigneeUserId: null,
  assigneeName: null,
  botId: null,
  progress: "",
  followUp: "off",
  updatedAt: "2026-11-10T00:00:00Z",
  stepsDone: 0,
  stepsTotal: 0,
  canOpen: true,
  canTell: true,
  ...over,
});

test("open work is grouped by who does it, stuck work first, free people after busy ones", () => {
  const groups = workByWorker({
    bots: [
      { id: "b1", name: "Scribe" },
      { id: "b2", name: "Painter" },
    ],
    people: [{ userId: "u1", name: "Ana" }],
    tasks: [
      task({ title: "Draft", botId: "b1" }),
      task({ title: "Stuck", botId: "b1", status: "blocked" }),
      task({ title: "Newer", botId: "b1", updatedAt: "2026-11-12T00:00:00Z" }),
      task({ title: "Prices", assignee: "person", assigneeUserId: "u1", assigneeName: "Ana" }),
      task({ title: "Loose" }),
      task({ title: "Gone", botId: "b9" }),
    ],
  });
  expect(groups.map((g) => [g.key, g.tasks.map((t) => t.title)])).toEqual([
    ["bot:b1", ["Stuck", "Newer", "Draft"]],
    ["person:u1", ["Prices"]],
    ["bot:b9", ["Gone"]],
    ["bot:b2", []],
    ["nobody", ["Loose"]],
  ]);
  expect(groups.find((g) => g.key === "bot:b9")?.worker).toEqual({
    kind: "bot",
    id: "b9",
    name: "A bot",
  });
});
