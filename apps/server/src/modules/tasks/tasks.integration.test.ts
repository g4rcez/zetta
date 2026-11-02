import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createTaskStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`task-a-${uuidv7()}`, `task-b-${uuidv7()}`];

suite("tasks kanban against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
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
    tasks: { access, tasks: createTaskStore(db) },
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
});
