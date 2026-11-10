import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { createFeaturesService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`rchat-a-${uuidv7()}`, `rchat-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("a routine has one chat for all its runs", () => {
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
  // What the bot could read of the chat before each answer, and the answers it gave: reply-1, reply-2, ...
  const histories: string[] = [];
  let answers = 0;
  const fakeRun = Object.assign(async () => ({ text: "unused", stopped: false }), {
    stream: async function* (t: { history?: { content: string }[] }) {
      histories.push((t.history ?? []).map((h) => h.content).join("\n"));
      yield `reply-${++answers}`;
    },
  });
  const chat = createChatService(db, fakeRun as never);
  const features = createFeaturesService(db);
  // Same wiring as services.ts: a routine run is a chat turn as the owner that reads only the run before it.
  features.routines.useChat(async (userId, conversationId, prompt, requestKey) => {
    const actor = await issueBackgroundActor(async () => ({ isAdmin: false }) as never, userId);
    const { follow } = await chat.startTurn(actor!, conversationId, {
      content: prompt,
      clientRequestId: requestKey,
      history: "previous_turn",
    });
    let saved: { status: string; content: string } | undefined;
    for await (const { event } of follow()) if (event.type === "message") saved = event.message;
    return { ok: saved?.status === "complete", text: saved?.content ?? "" };
  });
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    features: { access, features },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
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
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const sql = (q: string, p: unknown[] = []) => db.$client.query(q, p);
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
    features.routines.useChat(undefined as never);
    await cleanupTestUsers(db, ids);
  });

  const setup = async () => {
    const b = (await call(A, "POST", "/api/bots", { name: "Digest bot", visibility: "team" })).json
      .bot as { id: string };
    await sql("update bot set onboarded = true where id = $1", [b.id]);
    const rid = (
      await call(A, "POST", "/api/routines", {
        botId: b.id,
        title: "Daily digest",
        prompt: "Summarize the news",
        timezone: "UTC",
        everyMinutes: 60,
      })
    ).json.routine.id as string;
    const run = (key: string) => call(A, "POST", `/api/routines/${rid}/run`, { requestKey: key });
    const chats = async () =>
      (
        await sql("select distinct conversation_id from routine_run where routine_id=$1", [rid])
      ).rows.map((r) => r.conversation_id as string);
    return { b, rid, run, chats };
  };

  test("three runs share one chat that keeps the routine title", async () => {
    const { rid, run, chats } = await setup();
    for (const k of ["share-run-0001", "share-run-0002", "share-run-0003"]) await run(k);
    const [conversationId, ...others] = await chats();
    expect(others).toEqual([]);
    expect(
      (await sql("select title from conversation where id=$1", [conversationId])).rows[0].title,
    ).toBe("Daily digest");
    expect(
      (
        await sql("select count(*)::int as n from message where conversation_id=$1", [
          conversationId,
        ])
      ).rows[0].n,
    ).toBe(6);
    expect(
      (await sql("select count(*)::int as n from routine_run where routine_id=$1", [rid])).rows[0]
        .n,
    ).toBe(3);
  });

  test("the bot reads only the run before the current one", async () => {
    histories.length = 0;
    answers = 0;
    const { run } = await setup();
    for (const k of ["hist-run-00001", "hist-run-00002", "hist-run-00003"]) await run(k);
    expect(histories).toEqual(["", "Summarize the news\nreply-1", "Summarize the news\nreply-2"]);
  });

  test("each run lists the steps of the reply it produced", async () => {
    const { rid, run, chats } = await setup();
    await run("steps-run-00001");
    const [conversationId] = await chats();
    for (let i = 0; i < 50; i++) {
      const done = await sql(
        "select 1 from routine_run where routine_id=$1 and finished_at is not null",
        [rid],
      );
      if (done.rows.length) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await sql(
      `update message set meta = coalesce(meta, '{}'::jsonb) || '{"timeline":[{"label":"Read the news"},{"label":"Wrote the digest"},{"nolabel":1}]}'::jsonb
       where conversation_id=$1 and role='assistant'`,
      [conversationId],
    );
    const runs = (await call(A, "GET", `/api/routines/${rid}/runs`)).json.runs;
    expect(runs[0].steps).toEqual(["Read the news", "Wrote the digest"]);
  });

  test("a standing goal: the next run starts from what the last run reported", async () => {
    const { rid, run, chats } = await setup();
    await call(A, "PATCH", `/api/routines/${rid}`, { expectedVersion: 1, mode: "goal" });
    expect((await sql("select mode from routine where id=$1", [rid])).rows[0].mode).toBe("goal");
    await run("goal-run-000001");
    await run("goal-run-000002");
    const [conversationId] = await chats();
    const asked = (
      await sql(
        "select content from message where conversation_id=$1 and role='user' order by created_at",
        [conversationId],
      )
    ).rows.map((r) => r.content as string);
    expect(asked[0]).toContain("first run toward this goal");
    const lastReply = (
      await sql(
        "select content from message where conversation_id=$1 and role='assistant' order by created_at limit 1",
        [conversationId],
      )
    ).rows[0].content as string;
    expect(asked[1]).toContain("Where the last run left it");
    expect(asked[1]).toContain(lastReply);
  });

  test("the routine list gives each routine its chat, null before the first run", async () => {
    const { rid, run, chats } = await setup();
    const listed = async () =>
      (await call(A, "GET", "/api/routines")).json.routines.find(
        (r: { id: string }) => r.id === rid,
      );
    expect((await listed()).conversationId).toBeNull();
    await run("chatlink-run-001");
    await run("chatlink-run-002");
    const [conversationId] = await chats();
    expect((await listed()).conversationId).toBe(conversationId);
  });

  test("a routine chat is not in the chat list but opens by id, for its owner only", async () => {
    const { b, chats, run } = await setup();
    await run("list-run-00001");
    const [conversationId] = await chats();
    const normal = (await call(A, "POST", "/api/conversations", { botId: b.id })).json.conversation
      .id as string;
    const listed = (await call(A, "GET", "/api/conversations")).json.conversations.map(
      (c: { id: string }) => c.id,
    );
    expect(listed).toContain(normal);
    expect(listed).not.toContain(conversationId);
    const opened = await call(A, "GET", `/api/conversations/${conversationId}`);
    expect(opened.status).toBe(200);
    expect(opened.json.conversation).toMatchObject({
      id: conversationId,
      botId: b.id,
      title: "Daily digest",
    });
    expect((await call(B, "GET", `/api/conversations/${conversationId}`)).status).toBe(404);
  });

  test("unread runs are counted per owner and cleared by opening their chat; a running run stays pending", async () => {
    const { rid, run, chats } = await setup();
    await sql("update routine_run set read_at = now() where owner_user_id = $1", [A]); // runs of the tests above are already seen
    await run("read-run-000001");
    await run("read-run-000002");
    const [conversationId] = await chats();
    const unread = (await call(A, "GET", "/api/routines/unread")).json;
    expect(unread.count).toBe(2);
    expect(unread.conversationIds).toContain(conversationId);
    expect((await call(B, "GET", "/api/routines/unread")).json).toEqual({
      count: 0,
      conversationIds: [],
    });

    await sql(
      "insert into routine_run (routine_id, owner_user_id, status, output, occurrence_key, conversation_id, started_at) values ($1,$2,'running','','sched:live',$3, now())",
      [rid, A, conversationId],
    );
    // Another user cannot clear it.
    await call(B, "POST", "/api/routines/read", { conversationId });
    expect((await call(A, "GET", "/api/routines/unread")).json.count).toBe(3);

    expect((await call(A, "POST", "/api/routines/read", { conversationId })).status).toBe(200);
    expect((await call(A, "GET", "/api/routines/unread")).json.count).toBe(1);
    expect((await call(A, "POST", "/api/routines/read", { conversationId: "nope" })).status).toBe(
      400,
    );
  });
});
