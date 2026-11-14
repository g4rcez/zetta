import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { attentionItem, auditEvent, configProposal } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { task } from "@zetta/db/schema/tasks";
import { message } from "@zetta/db/schema/chat";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createChatService } from "./service";

/** A promise someone else resolves: lets a test hold the fake harness at a known point of its run. */
const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((r) => {
    open = r;
  });
  return { open, opened };
};
let gates = { first: gate(), last: gate() };
/** A harness that reports a step before its first text, like Claude Code (which streams steps, not prose). */
let reportsSteps = false;
const fakeRun = Object.assign(async () => ({ text: "reply", stopped: false }), {
  stream: async function* () {
    if (reportsSteps) yield { activity: "Reading a.ts" };
    await gates.first.opened;
    yield "Hello";
    await gates.last.opened;
    yield " there";
  },
});

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`status-a-${uuidv7()}`, `status-b-${uuidv7()}`];
type Entry = {
  botId: string;
  status: string;
  reason: string;
  task: { id: string; title: string; status: string; stepsDone: number; stepsTotal: number } | null;
  openTasks: number;
};

suite("bot status against postgres", () => {
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
    chat: { access, chat: createChatService(db, fakeRun as never) },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = (as: string | null, method: string, path: string, body?: unknown) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          ...(as ? { "x-test-user": as } : {}),
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  const createBot = async (as: string, input: Record<string, unknown>) =>
    (
      (await (await call(as, "POST", "/api/bots", input)).json()) as {
        bot: { id: string };
      }
    ).bot.id;
  const statusOf = async (as: string, botId: string): Promise<Entry> => {
    const res = await call(as, "GET", "/api/bots/status");
    expect(res.status).toBe(200);
    const { statuses } = (await res.json()) as { statuses: Entry[] };
    return statuses.find((s) => s.botId === botId)!;
  };
  const until = async (as: string, botId: string, status: string) => {
    for (let i = 0; i < 100; i++) {
      if ((await statusOf(as, botId)).status === status) return;
      await Bun.sleep(25);
    }
    throw new Error(`bot never became ${status}: ${(await statusOf(as, botId)).status}`);
  };

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
    gates.first.open();
    gates.last.open();
    await Bun.sleep(100);
    await cleanupTestUsers(db, ids);
  });

  test("it needs a signed-in user", async () => {
    expect((await call(null, "GET", "/api/bots/status")).status).toBe(401);
  });

  test("a bot with nothing going on is available", async () => {
    const botId = await createBot(ids[0]!, { name: "Idle", harness: "pi" });
    expect(await statusOf(ids[0]!, botId)).toEqual({
      botId,
      status: "available",
      reason: "Online, no tasks",
      task: null,
      openTasks: 0,
    });
  });

  test("an open attention item and a blocked task make it pending until both are resolved", async () => {
    const botId = await createBot(ids[0]!, { name: "Needs me", harness: "pi" });
    const [item] = await db
      .insert(attentionItem)
      .values({ ownerUserId: ids[0]!, botId, title: "Approve rm", kind: "bot_ask" })
      .returning();
    expect(await statusOf(ids[0]!, botId)).toMatchObject({
      status: "pending",
      reason: "1 item waits for you",
    });
    const [blocked] = await db
      .insert(task)
      .values({ ownerUserId: ids[0]!, botId, title: "Stuck", status: "blocked" })
      .returning();
    expect((await statusOf(ids[0]!, botId)).reason).toBe("2 items wait for you");
    await db
      .update(attentionItem)
      .set({ status: "resolved" })
      .where(eq(attentionItem.id, item!.id));
    await db.update(task).set({ status: "done" }).where(eq(task.id, blocked!.id));
    expect((await statusOf(ids[0]!, botId)).status).toBe("available");
  });

  test("a bot names the open task it is furthest along on, with its steps, and drops it when it is done", async () => {
    const botId = await createBot(ids[0]!, { name: "Worker", harness: "pi" });
    const [waiting] = await db
      .insert(task)
      .values({ ownerUserId: ids[0]!, botId, title: "Later", status: "backlog" })
      .returning();
    expect(await statusOf(ids[0]!, botId)).toMatchObject({
      status: "available",
      reason: "Online, 1 open task",
      task: { id: waiting!.id, stepsTotal: 0 },
      openTasks: 1,
    });
    const [main] = await db
      .insert(task)
      .values({ ownerUserId: ids[0]!, botId, title: "Write the report", status: "in_progress" })
      .returning();
    await db.insert(task).values(
      ["a", "b", "c"].map((title, i) => ({
        ownerUserId: ids[0]!,
        botId,
        title,
        parentTaskId: main!.id,
        status: i === 0 ? ("done" as const) : ("backlog" as const),
      })),
    );
    const entry = await statusOf(ids[0]!, botId);
    // Steps are not tasks: they never raise the open count, only fill the steps of their task.
    expect(entry).toMatchObject({
      openTasks: 2,
      task: { id: main!.id, title: "Write the report", stepsDone: 1, stepsTotal: 3 },
    });
    await db.update(task).set({ status: "done" }).where(eq(task.id, main!.id));
    expect((await statusOf(ids[0]!, botId)).task?.id).toBe(waiting!.id);
  });

  test("a task asked of a person and another viewer's task never show as the bot's work", async () => {
    const botId = await createBot(ids[0]!, { name: "Asker", harness: "pi", visibility: "team" });
    await db.insert(task).values({
      ownerUserId: ids[0]!,
      botId,
      title: "Sign in for me",
      assignee: "person",
      assigneeUserId: ids[1]!,
    });
    await db
      .insert(task)
      .values({ ownerUserId: ids[1]!, botId, title: "Theirs", status: "in_progress" });
    expect(await statusOf(ids[0]!, botId)).toMatchObject({ task: null, openTasks: 0 });
    expect(await statusOf(ids[1]!, botId)).toMatchObject({
      task: { title: "Theirs" },
      openTasks: 1,
    });
  });

  test("a team bot shows only the viewer's own pending work", async () => {
    const botId = await createBot(ids[0]!, { name: "Shared", harness: "pi", visibility: "team" });
    await db
      .insert(attentionItem)
      .values({ ownerUserId: ids[0]!, botId, title: "Mine", kind: "bot_ask" });
    expect((await statusOf(ids[0]!, botId)).status).toBe("pending");
    expect((await statusOf(ids[1]!, botId)).status).toBe("available");
  });

  test("an update card and an expired approval do not make it pending: only what Inbox lists does", async () => {
    const botId = await createBot(ids[0]!, { name: "Claude", harness: "claude-code" });
    await db
      .insert(attentionItem)
      .values({ ownerUserId: ids[0]!, botId, title: "Idle", kind: "room_idle" });
    await db.insert(configProposal).values({
      ownerUserId: ids[0]!,
      botId,
      kind: "chief_action",
      baseVersion: 0,
      patch: {},
      diff: [],
      expiresAt: new Date(Date.now() - 3_600_000),
    });
    expect((await statusOf(ids[0]!, botId)).status).toBe("available");
    await db.insert(configProposal).values({
      ownerUserId: ids[0]!,
      botId,
      kind: "chief_action",
      baseVersion: 0,
      patch: {},
      diff: [],
    });
    expect((await statusOf(ids[0]!, botId)).status).toBe("pending");
  });

  test("a sign-in failure is an error until the next successful run", async () => {
    const botId = await createBot(ids[0]!, { name: "Claude", harness: "claude-code" });
    await db.insert(auditEvent).values({
      ownerUserId: ids[0]!,
      kind: "harness_run",
      outcome: "auth_required",
      botId,
      createdAt: new Date(Date.now() - 2000),
    });
    expect(await statusOf(ids[0]!, botId)).toMatchObject({
      status: "error",
      reason: "Not signed in to Claude Code",
    });
    await db
      .insert(auditEvent)
      .values({ ownerUserId: ids[0]!, kind: "harness_run", outcome: "ok", botId });
    expect((await statusOf(ids[0]!, botId)).status).toBe("available");
  });

  test("a harness that is not installed is offline", async () => {
    const botId = await createBot(ids[0]!, { name: "Missing", harness: "codex" });
    await db.insert(auditEvent).values({
      ownerUserId: ids[0]!,
      kind: "harness_run",
      outcome: "not_installed",
      botId,
    });
    expect(await statusOf(ids[0]!, botId)).toMatchObject({
      status: "offline",
      reason: "Codex is not installed on the server",
    });
  });

  test("a running answer keeps its steps on the saved row, so a reader without the live stream sees more than Thinking", async () => {
    gates = { first: gate(), last: gate() };
    reportsSteps = true;
    try {
      const botId = await createBot(ids[0]!, { name: "Steps", harness: "pi" });
      const conv = (
        (await (await call(ids[0]!, "POST", "/api/conversations", { botId })).json()) as {
          conversation: { id: string };
        }
      ).conversation;
      const turn = await call(ids[0]!, "POST", `/api/conversations/${conv.id}/stream`, {
        content: "hello",
      });
      expect(turn.status).toBe(200);
      type LiveMeta = { timeline?: { label: string }[]; activity?: string };
      let meta: LiveMeta | null = null;
      for (let i = 0; i < 100 && !meta?.timeline?.length; i++) {
        const [row] = await db
          .select({ meta: message.meta, status: message.status })
          .from(message)
          .where(and(eq(message.conversationId, conv.id), eq(message.role, "assistant")));
        meta = row?.status === "running" ? (row.meta as LiveMeta) : null;
        if (!meta?.timeline?.length) await Bun.sleep(25);
      }
      // Still running, and the row already says what the bot did and does.
      expect(meta?.timeline?.map((t) => t.label)).toEqual(["Reading a.ts"]);
      expect(meta?.activity).toBe("Reading a.ts");
      gates.first.open();
      gates.last.open();
      await until(ids[0]!, botId, "available");
      await turn.body?.cancel();
    } finally {
      reportsSteps = false;
    }
  });

  test("a running answer is planning until text arrives, then working, then available", async () => {
    gates = { first: gate(), last: gate() };
    const botId = await createBot(ids[0]!, { name: "Live", harness: "pi" });
    const conv = (
      (await (await call(ids[0]!, "POST", "/api/conversations", { botId })).json()) as {
        conversation: { id: string };
      }
    ).conversation;
    const turn = await call(ids[0]!, "POST", `/api/conversations/${conv.id}/stream`, {
      content: "hello",
    });
    expect(turn.status).toBe(200);
    await until(ids[0]!, botId, "planning");
    gates.first.open();
    await until(ids[0]!, botId, "working");
    gates.last.open();
    await until(ids[0]!, botId, "available");
    await turn.body?.cancel();
  });
});
