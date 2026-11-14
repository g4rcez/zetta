import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { attentionItem } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { task as taskTable } from "@zetta/db/schema/tasks";
import { team } from "@zetta/db/schema/teams";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createTeamPeople } from "../teams/people";
import { QUIET_MS, TaskRuleError } from "./follow-up";
import { createTaskStore, nestTasks, type PersonTaskEvent } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
// 0 owner, 1 stranger, 2 team member, 3 team member who is not asked
const ids = [
  `task-a-${uuidv7()}`,
  `task-b-${uuidv7()}`,
  `task-c-${uuidv7()}`,
  `task-d-${uuidv7()}`,
];

suite("tasks kanban against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const store = createTaskStore(db);
  const people = createTeamPeople(db);
  const heard: PersonTaskEvent[] = [];
  store.onPersonTask = (e) => void heard.push(e);
  let teamId = "";
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    tasks: { access, tasks: store },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = (as: string, method: string, path: string, body?: unknown) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": as,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  type Task = {
    id: string;
    title: string;
    status: string;
    priority: string;
    labels: string[];
    description: string;
    assignee: string;
    assigneeUserId: string | null;
    assigneeName: string | null;
  };
  const actorOf = (id: string) => access.requireActive(new Headers({ "x-test-user": id }));
  /** What a bot does when it needs a person: the owner's actor asks `assigneeUserId`. */
  const ask = async (
    assigneeUserId: string,
    title: string,
    over: { description?: string; teamId?: string | null } = {},
  ) =>
    store.ask(await actorOf(ids[0]!), {
      title,
      description: "Needs a login",
      nextAction: "Sign in",
      assigneeUserId,
      teamId,
      ...over,
    });
  const cardOf = async (userId: string, taskId: string) => {
    const [row] = await db
      .select()
      .from(attentionItem)
      .where(
        and(eq(attentionItem.ownerUserId, userId), eq(attentionItem.sourceKey, `task:${taskId}`)),
      );
    return row;
  };
  const list = async (as: string) =>
    ((await (await call(as, "GET", "/api/tasks")).json()) as { tasks: Task[] }).tasks;
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
    const [made] = await db
      .insert(team)
      .values({ ownerUserId: ids[0]!, name: `Crew ${ids[0]}` })
      .returning();
    teamId = made!.id;
    await people.add(teamId, ids[2]!);
    await people.add(teamId, ids[3]!);
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });

  test("a new task starts in the backlog and shows on its owner's board only", async () => {
    const res = await call(ids[0]!, "POST", "/api/tasks", { title: "Ship the report" });
    expect(res.status).toBe(201);
    const { task } = (await res.json()) as { task: Task };
    expect(task).toMatchObject({ title: "Ship the report", status: "backlog" });
    expect((await list(ids[0]!)).map((t) => t.title)).toEqual(["Ship the report"]);
    expect(await list(ids[1]!)).toEqual([]);
  });
  test("a task moves across the fixed statuses and rejects any other", async () => {
    const { task } = (await (
      await call(ids[0]!, "POST", "/api/tasks", { title: "Move me" })
    ).json()) as { task: Task };
    for (const status of ["in_progress", "blocked", "review", "done"]) {
      const res = await call(ids[0]!, "PATCH", `/api/tasks/${task.id}`, { status });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { task: Task }).task.status).toBe(status);
    }
    expect(
      (await call(ids[0]!, "PATCH", `/api/tasks/${task.id}`, { status: "weird" })).status,
    ).toBe(400);
  });
  test("another user can neither change nor delete a task", async () => {
    const { task } = (await (
      await call(ids[0]!, "POST", "/api/tasks", { title: "Private" })
    ).json()) as { task: Task };
    expect((await call(ids[1]!, "PATCH", `/api/tasks/${task.id}`, { status: "done" })).status).toBe(
      404,
    );
    expect((await call(ids[1]!, "DELETE", `/api/tasks/${task.id}`)).status).toBe(404);
    expect((await list(ids[0]!)).find((t) => t.id === task.id)?.status).toBe("backlog");
  });
  test("a task opens by id for its owner only", async () => {
    const { task } = (await (
      await call(ids[0]!, "POST", "/api/tasks", { title: "Open me", description: "Details" })
    ).json()) as { task: Task };
    const res = await call(ids[0]!, "GET", `/api/tasks/${task.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { task: Task }).task).toMatchObject({
      id: task.id,
      title: "Open me",
      description: "Details",
    });
    expect((await call(ids[1]!, "GET", `/api/tasks/${task.id}`)).status).toBe(404);
  });
  test("a new task has no priority and no labels", async () => {
    const { task } = (await (
      await call(ids[0]!, "POST", "/api/tasks", { title: "Plain" })
    ).json()) as { task: Task };
    expect(task).toMatchObject({ priority: "none", labels: [] });
  });
  test("priority and labels save on create and change on patch", async () => {
    const { task } = (await (
      await call(ids[0]!, "POST", "/api/tasks", {
        title: "Urgent bug",
        priority: "urgent",
        labels: ["bug"],
      })
    ).json()) as { task: Task };
    expect(task).toMatchObject({ priority: "urgent", labels: ["bug"] });
    const res = await call(ids[0]!, "PATCH", `/api/tasks/${task.id}`, {
      priority: "low",
      labels: ["design", "web"],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { task: Task }).task).toMatchObject({
      title: "Urgent bug",
      priority: "low",
      labels: ["design", "web"],
    });
    expect((await list(ids[0]!)).find((t) => t.id === task.id)).toMatchObject({
      priority: "low",
      labels: ["design", "web"],
    });
  });
  test("labels are lowercased and do not repeat", async () => {
    const { task } = (await (
      await call(ids[0]!, "POST", "/api/tasks", {
        title: "Tagged",
        labels: [" Bug ", "bug", "UI"],
      })
    ).json()) as { task: Task };
    expect(task.labels).toEqual(["bug", "ui"]);
  });
  test("an unknown priority, an empty label and too many labels are refused", async () => {
    const { task } = (await (
      await call(ids[0]!, "POST", "/api/tasks", { title: "Strict" })
    ).json()) as { task: Task };
    const patch = (body: unknown) => call(ids[0]!, "PATCH", `/api/tasks/${task.id}`, body);
    expect((await patch({ priority: "critical" })).status).toBe(400);
    expect((await patch({ labels: ["  "] })).status).toBe(400);
    expect((await patch({ labels: Array.from({ length: 11 }, (_, i) => `l${i}`) })).status).toBe(
      400,
    );
  });
  test("a deleted task leaves the board", async () => {
    const { task } = (await (
      await call(ids[0]!, "POST", "/api/tasks", { title: "Throwaway" })
    ).json()) as { task: Task };
    expect((await call(ids[0]!, "DELETE", `/api/tasks/${task.id}`)).status).toBe(200);
    expect((await list(ids[0]!)).some((t) => t.id === task.id)).toBe(false);
  });

  test("a task a bot asks of a team member shows on that member's board and raises a card for them", async () => {
    const asked = await ask(ids[2]!, "Sign in to the CRM");
    expect(await list(ids[2]!)).toContainEqual(
      expect.objectContaining({
        id: asked.id,
        title: "Sign in to the CRM",
        assignee: "person",
        assigneeUserId: ids[2],
        assigneeName: ids[2],
      }),
    );
    expect((await cardOf(ids[2]!, asked.id))?.status).toBe("open");
  });
  test("a team member who was not asked and a stranger do not see the task", async () => {
    const asked = await ask(ids[2]!, "Private ask");
    expect((await list(ids[3]!)).map((t) => t.id)).not.toContain(asked.id);
    expect((await list(ids[1]!)).map((t) => t.id)).not.toContain(asked.id);
    expect((await call(ids[1]!, "GET", `/api/tasks/${asked.id}`)).status).toBe(404);
  });
  test("the assignee moves the task but cannot edit or delete it", async () => {
    const asked = await ask(ids[2]!, "Move only");
    const moved = await call(ids[2]!, "PATCH", `/api/tasks/${asked.id}`, { status: "in_progress" });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { task: Task }).task.status).toBe("in_progress");
    expect(
      (await call(ids[2]!, "PATCH", `/api/tasks/${asked.id}`, { title: "Mine now" })).status,
    ).toBe(403);
    expect((await call(ids[2]!, "DELETE", `/api/tasks/${asked.id}`)).status).toBe(404);
    expect((await list(ids[0]!)).find((t) => t.id === asked.id)?.title).toBe("Move only");
  });
  test("done closes the card of the assignee", async () => {
    const asked = await ask(ids[2]!, "Finish me");
    await call(ids[2]!, "PATCH", `/api/tasks/${asked.id}`, { status: "done" });
    expect((await cardOf(ids[2]!, asked.id))?.status).toBe("resolved");
  });
  test("a deleted task cancels the card", async () => {
    const asked = await ask(ids[2]!, "Delete me");
    await call(ids[0]!, "DELETE", `/api/tasks/${asked.id}`);
    expect((await cardOf(ids[2]!, asked.id))?.status).toBe("cancelled");
  });
  test("the owner can be the assignee", async () => {
    const asked = await ask(ids[0]!, "For the owner", { teamId: null });
    expect((await list(ids[0]!)).find((t) => t.id === asked.id)).toMatchObject({
      assignee: "person",
      assigneeUserId: ids[0],
    });
    expect((await cardOf(ids[0]!, asked.id))?.status).toBe("open");
  });
  test("asking the same person again updates the open task and a finished one starts a new task", async () => {
    const first = await ask(ids[2]!, "Same ask", { description: "First" });
    const again = await ask(ids[2]!, "Same ask", { description: "Second" });
    expect(again.id).toBe(first.id);
    expect(
      (await list(ids[2]!)).filter((t) => t.title === "Same ask").map((t) => t.description),
    ).toEqual(["Second"]);
    await call(ids[2]!, "PATCH", `/api/tasks/${first.id}`, { status: "done" });
    const next = await ask(ids[2]!, "Same ask", { description: "Third" });
    expect(next.id).not.toBe(first.id);
  });
  test("a person who moves a task a bot asked for is reported with the old status, the new status and who moved it", async () => {
    const asked = await ask(ids[2]!, "Report my moves");
    await call(ids[2]!, "PATCH", `/api/tasks/${asked.id}`, { status: "in_progress" });
    await call(ids[0]!, "PATCH", `/api/tasks/${asked.id}`, { status: "done" });
    expect(heard.filter((e) => e.task.id === asked.id)).toMatchObject([
      { kind: "status", from: "backlog", to: "in_progress", by: ids[2] },
      { kind: "status", from: "in_progress", to: "done", by: ids[0] },
    ]);
  });
  test("a move to the same status, a priority change, a bot's own move and a plain bot task report nothing", async () => {
    const asked = await ask(ids[2]!, "Stay quiet");
    await call(ids[2]!, "PATCH", `/api/tasks/${asked.id}`, { status: "backlog" });
    await call(ids[0]!, "PATCH", `/api/tasks/${asked.id}`, { priority: "high" });
    await store.update(await actorOf(ids[0]!), asked.id, { status: "review" }, { by: "bot" });
    const plain = (await (
      await call(ids[0]!, "POST", "/api/tasks", { title: "Plain bot task" })
    ).json()) as { task: Task };
    await call(ids[0]!, "PATCH", `/api/tasks/${plain.task.id}`, { status: "done" });
    expect(heard.filter((e) => e.task.id === asked.id || e.task.id === plain.task.id)).toEqual([]);
  });
  test("a deleted task is reported with who deleted it", async () => {
    const asked = await ask(ids[2]!, "Report my deletion");
    await call(ids[0]!, "DELETE", `/api/tasks/${asked.id}`);
    expect(heard.filter((e) => e.task.id === asked.id)).toMatchObject([
      { kind: "removed", by: ids[0] },
    ]);
  });
  test("a member who leaves the team loses the task", async () => {
    const asked = await ask(ids[3]!, "Leaving soon");
    expect((await list(ids[3]!)).map((t) => t.id)).toContain(asked.id);
    await people.remove(teamId, ids[3]!);
    expect((await list(ids[3]!)).map((t) => t.id)).not.toContain(asked.id);
    expect((await call(ids[3]!, "GET", `/api/tasks/${asked.id}`)).status).toBe(404);
  });

  test("subtasks hang under one parent, one level deep, and go with it", async () => {
    const owner = await actorOf(ids[0]!);
    const { task: parent, subtasks } = await store.createWithSubtasks(
      owner,
      { title: "Plan the launch" },
      ["Draft", "Review", "Publish"],
    );
    expect(subtasks.map((t) => t.title)).toEqual(["Draft", "Review", "Publish"]);
    expect(subtasks.every((t) => t.parentTaskId === parent.id && t.followUp === "off")).toBe(true);
    const nested = nestTasks(await store.list(owner)).find((t) => t.id === parent.id);
    expect(nested?.subtasks.map((t) => t.title)).toEqual(["Draft", "Review", "Publish"]);
    // a subtask of a subtask is refused, and the 30th is the last
    await expect(
      store.create(owner, { title: "Deeper", parentTaskId: subtasks[0]!.id }),
    ).rejects.toMatchObject({ code: "SUBTASK_OF_SUBTASK" });
    for (let i = 0; i < 27; i++)
      await store.create(owner, { title: `More ${i}`, parentTaskId: parent.id });
    await expect(
      store.create(owner, { title: "One too many", parentTaskId: parent.id }),
    ).rejects.toBeInstanceOf(TaskRuleError);
    await store.remove(owner, parent.id);
    expect((await store.list(owner)).filter((t) => t.parentTaskId === parent.id)).toEqual([]);
  });
  test("a parent cannot be done while a subtask is open, and only the owner adds subtasks", async () => {
    const owner = await actorOf(ids[0]!);
    const { task: parent, subtasks } = await store.createWithSubtasks(
      owner,
      { title: "Close me", followUp: "auto" },
      ["First", "Second"],
    );
    await store.update(owner, subtasks[0]!.id, { status: "done" }, { by: "bot" });
    await expect(store.update(owner, parent.id, { status: "done" }, { by: "bot" })).rejects.toThrow(
      /“Second”/,
    );
    await store.update(owner, subtasks[1]!.id, { status: "done" }, { by: "bot" });
    const closed = await store.update(owner, parent.id, { status: "done" }, { by: "bot" });
    expect(closed).toMatchObject({ status: "done", followUp: "off", nextCheckAt: null });
    await expect(
      store.create(await actorOf(ids[1]!), { title: "Mine now", parentTaskId: parent.id }),
    ).rejects.toThrow();
  });
  test("a followed task waits for a quiet chat, a subtask is never followed, a check time is capped", async () => {
    const owner = await actorOf(ids[0]!);
    const before = Date.now();
    const row = await store.create(owner, { title: "Follow me", followUp: "auto" });
    expect(row.followUp).toBe("auto");
    const [sub] = (await store.createWithSubtasks(owner, { title: "Has a plan" }, ["Step"]))
      .subtasks;
    await expect(store.update(owner, sub!.id, { followUp: "auto" })).rejects.toMatchObject({
      code: "SUBTASK_FOLLOW_UP",
    });
    const soon = await store.update(owner, row.id, { followUp: "auto" });
    expect(+soon.nextCheckAt! - before).toBeGreaterThanOrEqual(QUIET_MS - 1000);
    await expect(
      store.update(owner, row.id, { nextCheckAt: new Date(Date.now() + 8 * 86_400_000) }),
    ).rejects.toMatchObject({ code: "BAD_CHECK_TIME" });
    const hour = new Date(Date.now() + 3_600_000);
    expect(+(await store.update(owner, row.id, { nextCheckAt: hour })).nextCheckAt!).toBe(+hour);
  });
  test("resuming a paused task starts its counters over; stopping clears the next check", async () => {
    const owner = await actorOf(ids[0]!);
    const row = await store.create(owner, { title: "Stuck once", followUp: "auto" });
    await db
      .update(taskTable)
      .set({
        followUp: "paused",
        followUpReason: "no progress",
        checks: 40,
        stalls: 3,
        failures: 2,
      })
      .where(eq(taskTable.id, row.id));
    const back = await store.update(owner, row.id, { followUp: "auto" });
    expect(back).toMatchObject({
      followUp: "auto",
      followUpReason: null,
      checks: 0,
      stalls: 0,
      failures: 0,
    });
    expect(back.nextCheckAt).not.toBeNull();
    const off = await store.update(owner, row.id, { followUp: "off" });
    expect(off).toMatchObject({ followUp: "off", nextCheckAt: null });
  });
  test("a step that starts or ends takes its task out of the backlog, and a held task stays held", async () => {
    const owner = await actorOf(ids[0]!);
    const parent = await store.create(owner, { title: "Plan in backlog" });
    const first = await store.create(owner, { title: "step 1", parentTaskId: parent.id });
    const second = await store.create(owner, { title: "step 2", parentTaskId: parent.id });
    expect((await store.get(owner, parent.id)).status).toBe("backlog");
    await store.update(owner, first.id, { status: "in_progress" });
    expect((await store.get(owner, parent.id)).status).toBe("in_progress");
    // Moving the parent on by hand is not undone by the next step.
    await store.update(owner, parent.id, { status: "review" });
    await store.update(owner, second.id, { status: "done" });
    expect((await store.get(owner, parent.id)).status).toBe("review");
    // A step that only changes its title does not start anything.
    const quiet = await store.create(owner, { title: "Quiet plan" });
    const step = await store.create(owner, { title: "step", parentTaskId: quiet.id });
    await store.update(owner, step.id, { title: "renamed" });
    expect((await store.get(owner, quiet.id)).status).toBe("backlog");
  });
  test("a task write tells the live channel who to refresh, and a failing listener breaks nothing", async () => {
    const owner = await actorOf(ids[0]!);
    const told: string[][] = [];
    store.onChange = (u) => void told.push(u);
    try {
      const row = await store.create(owner, { title: "Watched" });
      await store.update(owner, row.id, { priority: "high" });
      await store.start(row.id);
      expect((await store.get(owner, row.id)).status).toBe("in_progress");
      const asked = await ask(ids[2]!, "Watched ask");
      await store.remove(owner, row.id);
      expect(told.length).toBe(5);
      expect(told.slice(0, 3).every((u) => u.length === 1 && u[0] === ids[0]!)).toBe(true);
      // A task asked of a person refreshes the asker and that person.
      expect([...told[3]!].sort()).toEqual([ids[0]!, ids[2]!].sort());
      store.onChange = () => {
        throw new Error("listener down");
      };
      await expect(store.update(owner, asked.id, { priority: "low" })).resolves.toBeDefined();
    } finally {
      store.onChange = undefined;
    }
  });
  test("the routes add a subtask, refuse to close a parent early and resume a follow-up", async () => {
    const parent = (await (
      await call(ids[0]!, "POST", "/api/tasks", { title: "Route parent" })
    ).json()) as { task: Task };
    const sub = await call(ids[0]!, "POST", "/api/tasks", {
      title: "Route child",
      parentTaskId: parent.task.id,
    });
    expect(sub.status).toBe(201);
    const early = await call(ids[0]!, "PATCH", `/api/tasks/${parent.task.id}`, { status: "done" });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe("OPEN_SUBTASKS");
    const resumed = await call(ids[0]!, "PATCH", `/api/tasks/${parent.task.id}`, {
      followUp: "auto",
    });
    expect(resumed.status).toBe(200);
  });
});
