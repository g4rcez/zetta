import { describe, expect, test } from "bun:test";
import {
  activeCount,
  applyFilters,
  DEFAULT_FILTERS,
  DEFAULT_STATE,
  FOR_ME,
  groupTasks,
  NO_BOT,
  parseTaskSearch,
  toTaskSearch,
  type TaskFilters,
} from "./task-filters";
import type { Task } from "./tasks-api";

const now = Date.parse("2026-11-01T12:00:00.000Z");

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
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
  ...over,
});

const tasks: Task[] = [
  task({
    id: "a",
    title: "Write weekly brief",
    status: "in_progress",
    priority: "high",
    labels: ["docs", "weekly"],
    botId: "writer",
    conversationId: "c1",
    createdAt: "2026-10-30T12:00:00.000Z",
    updatedAt: "2026-11-01T06:00:00.000Z",
  }),
  task({
    id: "b",
    title: "Review pull request",
    description: "Check the login flow",
    status: "review",
    priority: "urgent",
    labels: ["docs"],
    botId: "reviewer",
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-28T12:00:00.000Z",
  }),
  task({
    id: "c",
    title: "Archive old chats",
    status: "done",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-02T12:00:00.000Z",
  }),
  task({
    id: "d",
    title: "Backup the database",
    status: "blocked",
    botId: "writer",
    createdAt: "2026-10-31T12:00:00.000Z",
    updatedAt: "2026-10-31T18:00:00.000Z",
  }),
];

const ids = (filters: Partial<TaskFilters>) =>
  applyFilters(tasks, { ...DEFAULT_FILTERS, ...filters }, now).map((t) => t.id);

describe("applyFilters", () => {
  test("default filters keep every task in the server order", () => {
    expect(ids({})).toEqual(["a", "b", "c", "d"]);
  });

  test("search matches title or description, ignoring case and outer spaces", () => {
    expect(ids({ query: "  PULL " })).toEqual(["b"]);
    expect(ids({ query: "login" })).toEqual(["b"]);
  });

  test("bot filter takes bot ids and the no-bot choice together", () => {
    expect(ids({ botIds: ["writer"] })).toEqual(["a", "d"]);
    expect(ids({ botIds: [NO_BOT] })).toEqual(["c"]);
    expect(ids({ botIds: ["reviewer", NO_BOT] })).toEqual(["b", "c"]);
  });

  test("status filter keeps only the chosen columns", () => {
    expect(ids({ statuses: ["done", "blocked"] })).toEqual(["c", "d"]);
  });

  test("thread filter separates tasks with and without a conversation", () => {
    expect(ids({ thread: "with" })).toEqual(["a"]);
    expect(ids({ thread: "without" })).toEqual(["b", "c", "d"]);
  });

  test("updated window counts back from now", () => {
    expect(ids({ updated: "day" })).toEqual(["a", "d"]);
    expect(ids({ updated: "week" })).toEqual(["a", "b", "d"]);
    expect(ids({ updated: "month" })).toEqual(["a", "b", "d"]);
  });

  test("created window counts back from now", () => {
    expect(ids({ created: "day" })).toEqual(["d"]);
    expect(ids({ created: "month" })).toEqual(["a", "b", "d"]);
  });

  test("priority filter keeps the chosen priorities", () => {
    expect(ids({ priorities: ["urgent"] })).toEqual(["b"]);
    expect(ids({ priorities: ["high", "none"] })).toEqual(["a", "c", "d"]);
  });

  test("label filter keeps a task that has any chosen label", () => {
    expect(ids({ labels: ["docs"] })).toEqual(["a", "b"]);
    expect(ids({ labels: ["weekly", "missing"] })).toEqual(["a"]);
  });

  test("filters combine with AND", () => {
    expect(ids({ botIds: ["writer"], updated: "day", thread: "without" })).toEqual(["d"]);
  });

  test("sort orders by the chosen field without changing the filtered set", () => {
    expect(ids({ sort: "updated" })).toEqual(["a", "d", "b", "c"]);
    expect(ids({ sort: "created" })).toEqual(["d", "a", "b", "c"]);
    expect(ids({ sort: "title" })).toEqual(["c", "d", "b", "a"]);
  });

  test("sorting does not change the input array", () => {
    applyFilters(tasks, { ...DEFAULT_FILTERS, sort: "title" }, now);
    expect(tasks.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("tasks a bot asked of a person", () => {
  const asked: Task[] = [
    task({
      id: "p1",
      title: "Sign in to the CRM",
      botId: "writer",
      assignee: "person",
      assigneeUserId: "ana",
      assigneeName: "Ana",
    }),
    task({
      id: "p2",
      title: "Approve the budget",
      botId: "reviewer",
      assignee: "person",
      assigneeUserId: "leo",
      assigneeName: "Leo",
    }),
    task({
      id: "p3",
      title: "Send the export",
      botId: null,
      assignee: "person",
      assigneeUserId: "ana",
      assigneeName: "Ana",
    }),
    task({ id: "b1", title: "Tidy the memory", botId: "writer" }),
    task({ id: "b2", title: "Loose task" }),
  ];
  const forViewer = (botIds: string[], viewer: string) =>
    applyFilters(asked, { ...DEFAULT_FILTERS, botIds }, now, viewer).map((t) => t.id);

  test("the For me choice keeps only the tasks assigned to the viewer", () => {
    expect(forViewer([FOR_ME], "ana")).toEqual(["p1", "p3"]);
    expect(forViewer([FOR_ME], "leo")).toEqual(["p2"]);
    expect(forViewer([FOR_ME], "nobody")).toEqual([]);
  });

  test("For me combines with bot choices like the no-bot choice does", () => {
    expect(forViewer([FOR_ME, "writer"], "leo")).toEqual(["p1", "p2", "b1"]);
    expect(forViewer([FOR_ME, NO_BOT], "ana")).toEqual(["p1", "p3", "b2"]);
  });

  test("For me survives the address of the page", () => {
    expect(parseTaskSearch({ botIds: ["me", "writer"] })).toEqual({ botIds: ["me", "writer"] });
  });

  test("a bot choice also finds the person tasks that bot asked for", () => {
    expect(forViewer(["reviewer"], "ana")).toEqual(["p2"]);
  });

  test("grouping by assignee gives each person a group before the bots, and the bot tasks stay with their bot", () => {
    const groups = groupTasks(asked, "assignee", [{ id: "writer", name: "Writer" }], []);
    expect(groups.map((g) => [g.key, g.label, g.tasks.map((t) => t.id)])).toEqual([
      ["person:ana", "Ana", ["p1", "p3"]],
      ["person:leo", "Leo", ["p2"]],
      ["writer", "Writer", ["b1"]],
      [NO_BOT, "Unassigned", ["b2"]],
    ]);
  });
});

describe("activeCount", () => {
  test("is zero for the defaults, and sort alone does not count as a filter", () => {
    expect(activeCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeCount({ ...DEFAULT_FILTERS, sort: "title" })).toBe(0);
  });

  test("counts each filter once, however many values it holds", () => {
    expect(
      activeCount({
        ...DEFAULT_FILTERS,
        query: "x",
        botIds: ["a", "b"],
        statuses: ["done"],
        thread: "with",
        updated: "day",
        created: "week",
      }),
    ).toBe(6);
  });

  test("priority and label filters count once each", () => {
    expect(
      activeCount({ ...DEFAULT_FILTERS, priorities: ["low", "high"], labels: ["x", "y"] }),
    ).toBe(2);
  });

  test("a query of only spaces is not a filter", () => {
    expect(activeCount({ ...DEFAULT_FILTERS, query: "   " })).toBe(0);
  });
});

describe("groupTasks", () => {
  const bots = [
    { id: "writer", name: "Writer" },
    { id: "reviewer", name: "Reviewer" },
    { id: "idle", name: "Idle" },
  ];
  const keys = (groups: ReturnType<typeof groupTasks>) =>
    groups.map((g) => [g.key, g.tasks.map((t) => t.id)]);

  test("by status gives every column in board order, empty ones too", () => {
    expect(keys(groupTasks(tasks, "status", bots, []))).toEqual([
      ["backlog", []],
      ["in_progress", ["a"]],
      ["blocked", ["d"]],
      ["review", ["b"]],
      ["done", ["c"]],
    ]);
  });

  test("by status keeps only the chosen columns", () => {
    expect(groupTasks(tasks, "status", bots, ["done", "review"]).map((g) => g.label)).toEqual([
      "Review",
      "Done",
    ]);
  });

  test("by assignee gives one group per bot with tasks, then the unassigned ones", () => {
    expect(keys(groupTasks(tasks, "assignee", bots, []))).toEqual([
      ["writer", ["a", "d"]],
      ["reviewer", ["b"]],
      [NO_BOT, ["c"]],
    ]);
    expect(groupTasks(tasks, "assignee", bots, []).map((g) => g.label)).toEqual([
      "Writer",
      "Reviewer",
      "Unassigned",
    ]);
  });

  test("by assignee puts a task of an unknown bot under unassigned", () => {
    const orphan = task({ id: "z", title: "Orphan", botId: "gone" });
    expect(keys(groupTasks([orphan], "assignee", bots, []))).toEqual([[NO_BOT, ["z"]]]);
  });
});

describe("parseTaskSearch", () => {
  test("an empty URL gives no search params", () => {
    expect(parseTaskSearch({})).toEqual({});
  });

  test("keeps valid values", () => {
    expect(
      parseTaskSearch({
        query: "login",
        botIds: ["writer", NO_BOT],
        statuses: ["done"],
        priorities: ["high"],
        labels: ["docs"],
        thread: "with",
        updated: "week",
        created: "day",
        sort: "title",
        view: "list",
        groupBy: "assignee",
        task: "01a19a14-2391-799f-a480-708470871bef",
      }),
    ).toEqual({
      query: "login",
      botIds: ["writer", NO_BOT],
      statuses: ["done"],
      priorities: ["high"],
      labels: ["docs"],
      thread: "with",
      updated: "week",
      created: "day",
      sort: "title",
      view: "list",
      groupBy: "assignee",
      task: "01a19a14-2391-799f-a480-708470871bef",
    });
  });

  test("drops unknown enum values, unknown list items and a task that is not a uuid", () => {
    expect(
      parseTaskSearch({
        statuses: ["done", "weird"],
        priorities: ["critical"],
        thread: "maybe",
        updated: "year",
        sort: "random",
        view: "grid",
        groupBy: "label",
        task: "not-a-uuid",
      }),
    ).toEqual({ statuses: ["done"] });
  });

  test("turns a single string, a number and a list of numbers into text values", () => {
    expect(parseTaskSearch({ query: 123, labels: "docs", botIds: [7] })).toEqual({
      query: "123",
      labels: ["docs"],
      botIds: ["7"],
    });
  });

  test("a value equal to its default does not stay in the URL", () => {
    expect(
      parseTaskSearch({
        view: "board",
        groupBy: "status",
        thread: "any",
        sort: "default",
        query: "",
        labels: [],
      }),
    ).toEqual({});
  });
});

describe("toTaskSearch", () => {
  test("leaves out everything that is still the default", () => {
    expect(toTaskSearch(DEFAULT_STATE)).toEqual({});
    expect(toTaskSearch({ ...DEFAULT_STATE, view: "list", labels: ["docs"] })).toEqual({
      view: "list",
      labels: ["docs"],
    });
  });
});
