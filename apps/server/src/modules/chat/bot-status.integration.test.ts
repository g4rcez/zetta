import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { attentionItem, auditEvent } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { task } from "@zetta/db/schema/tasks";
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
const fakeRun = Object.assign(async () => ({ text: "reply", stopped: false }), {
  stream: async function* () {
    await gates.first.opened;
    yield "Hello";
    await gates.last.opened;
    yield " there";
  },
});

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`status-a-${uuidv7()}`, `status-b-${uuidv7()}`];
type Entry = { botId: string; status: string; reason: string };

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
    });
  });

  test("an open attention item and a blocked task make it pending until both are resolved", async () => {
    const botId = await createBot(ids[0]!, { name: "Needs me", harness: "pi" });
    const [item] = await db
      .insert(attentionItem)
      .values({ ownerUserId: ids[0]!, botId, title: "Approve rm" })
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

  test("a team bot shows only the viewer's own pending work", async () => {
    const botId = await createBot(ids[0]!, { name: "Shared", harness: "pi", visibility: "team" });
    await db.insert(attentionItem).values({ ownerUserId: ids[0]!, botId, title: "Mine" });
    expect((await statusOf(ids[0]!, botId)).status).toBe("pending");
    expect((await statusOf(ids[1]!, botId)).status).toBe("available");
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
