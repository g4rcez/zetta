import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { message } from "@zetta/db/schema/chat";
import { eq } from "@zetta/db/query";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { HarnessError } from "./harness";
import { createTurnRunner } from "./pipeline";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`chat-dur-a-${uuidv7()}`, `chat-dur-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("durable chat turns against compose postgres", () => {
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
  let runs = 0;
  const prompts: string[] = [];
  const sessions: ({ id: string; resume: boolean } | undefined)[] = [];
  // 6 chunks, 40ms apart, honours cancellation.
  const slowCli = async function* (t: {
    prompt: string;
    signal?: AbortSignal;
    session?: { id: string; resume: boolean };
  }) {
    runs++;
    prompts.push(t.prompt);
    sessions.push(t.session);
    for (let i = 0; i < 6; i++) {
      if (t.signal?.aborted) throw new HarnessError("cancelled");
      await Bun.sleep(40);
      yield `part${i} `;
    }
  };
  const slowRun = createTurnRunner(db, (async () => "x") as never, slowCli as never);
  const chat = createChatService(db, slowRun);
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const req = (as: string, method: string, path: string, body?: unknown) =>
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
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await req(as, method, path, body);
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const frames = (text: string) =>
    text
      .split("\n\n")
      .filter(Boolean)
      .map((f) => ({
        id: Number(/^id: (\d+)/m.exec(f)?.[1]),
        data: JSON.parse(
          f
            .split("\n")
            .find((l) => l.startsWith("data: "))!
            .slice(6),
        ),
      }));
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
  const setup = async (as: string) => {
    const bot = (
      await call(as, "POST", "/api/bots", {
        name: `B${uuidv7().slice(-4)}`,
        harness: "pi",
      })
    ).json.bot.id as string;
    const c = (await call(as, "POST", "/api/conversations", { botId: bot })).json.conversation
      .id as string;
    return { bot, c };
  };
  const stream = (as: string, c: string, body: object) =>
    req(as, "POST", `/api/conversations/${c}/stream`, body);

  test("dropping the connection does not cancel the turn; it resumes from a cursor without duplicates", async () => {
    const { c } = await setup(A);
    const res = await stream(A, c, { content: "go" });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let seen = "";
    while (!seen.includes("part1")) seen += dec.decode((await reader.read()).value);
    const lastId = frames(seen).at(-1)!.id;
    await reader.cancel(); // client disconnects mid-turn
    await Bun.sleep(500); // turn keeps running server-side
    const resumed = frames(
      await (await req(A, "GET", `/api/conversations/${c}/stream?after=${lastId}`)).text(),
    );
    expect(resumed[0]!.id).toBe(lastId + 1); // no duplicates, no gaps
    expect(resumed.at(-1)!.data.type).toBe("done");
    const msgs = (await call(A, "GET", `/api/conversations/${c}/messages`)).json.messages;
    expect(msgs.map((m: { status: string }) => m.status)).toEqual(["complete", "complete"]);
    expect(msgs[1].content).toBe("part0 part1 part2 part3 part4 part5");
    expect((await req(B, "GET", `/api/conversations/${c}/stream?after=0`)).status).toBe(404); // another user cannot follow it
  });

  test("a silent stretch of a turn still sends keep-alive frames so the connection is not dropped", async () => {
    process.env.ZETTA_SSE_HEARTBEAT_MS = "10";
    try {
      const { c } = await setup(A);
      const text = await (await stream(A, c, { content: "quiet" })).text();
      expect(text).toContain(": ping\n\n");
      expect(
        frames(
          text
            .split("\n\n")
            .filter((f) => !f.startsWith(":"))
            .join("\n\n"),
        ).at(-1)!.data.type,
      ).toBe("done");
    } finally {
      delete process.env.ZETTA_SSE_HEARTBEAT_MS;
    }
  });

  test("a Claude Code run a restart cut off is found again and continues the same session", async () => {
    const bot = (
      await call(A, "POST", "/api/bots", {
        name: `R${uuidv7().slice(-4)}`,
        harness: "claude-code",
      })
    ).json.bot.id as string;
    const c = (await call(A, "POST", "/api/conversations", { botId: bot })).json.conversation
      .id as string;
    const first = await (await stream(A, c, { content: "work for days" })).text();
    expect(first).toContain('"type":"done"');
    const started = sessions.at(-1)!;
    expect(started.resume).toBe(false);
    // The process dies mid-run: the assistant row is left "running" with the session it recorded.
    const [dead] = await db
      .insert(message)
      .values({
        conversationId: c,
        ownerUserId: A,
        seq: 99,
        role: "assistant",
        content: "half",
        status: "running",
        botId: bot,
        meta: { harnessSession: started.id },
      } as never)
      .returning();
    const [finished] = await db
      .insert(message)
      .values({
        conversationId: c,
        ownerUserId: A,
        seq: 100,
        role: "assistant",
        content: "done",
        status: "complete",
        botId: bot,
        meta: { harnessSession: "old" },
      } as never)
      .returning();
    expect(await chat.recoverInterrupted()).toBeGreaterThanOrEqual(1);
    const found = chat.takeResumable().filter((r) => r.conversationId === c);
    expect(found).toEqual([
      { messageId: dead!.id, conversationId: c, ownerUserId: A, sessionId: started.id },
    ]);
    expect(chat.takeResumable()).toEqual([]); // handed out once
    expect((await db.select().from(message).where(eq(message.id, dead!.id)))[0]!.status).toBe(
      "interrupted",
    );
    expect((await db.select().from(message).where(eq(message.id, finished!.id)))[0]!.status).toBe(
      "complete",
    );
    const actor = await access.requireActive(new Headers({ "x-test-user": A }));
    const { follow } = await chat.startTurn(actor, c, {
      content: "Resuming after a server restart",
      resume: { sessionId: started.id, prompt: "Continue where you stopped." },
    });
    for await (const _ of follow());
    expect(sessions.at(-1)).toEqual({ id: started.id, resume: true });
    expect(prompts.at(-1)).toContain("Continue where you stopped.");
    const msgs = (await call(A, "GET", `/api/conversations/${c}/messages`)).json.messages as {
      role: string;
      content: string;
    }[];
    expect(
      msgs.some((m) => m.role === "system" && m.content === "Resuming after a server restart"),
    ).toBe(true);
  });

  test("a second turn in the same conversation is refused while one runs; cancel keeps partial output", async () => {
    const { c } = await setup(A);
    const first = await stream(A, c, { content: "slow" });
    const r1 = first.body!.getReader();
    await r1.read();
    expect((await stream(A, c, { content: "again" })).status).toBe(409);
    expect((await call(A, "POST", `/api/conversations/${c}/cancel`)).json.cancelled).toBe(true);
    expect((await call(B, "POST", `/api/conversations/${c}/cancel`)).status).toBe(404);
    await Bun.sleep(300);
    await r1.cancel();
    const msgs = (await call(A, "GET", `/api/conversations/${c}/messages`)).json.messages;
    expect(msgs[1].status).toBe("cancelled");
    expect(msgs[1].content.length).toBeGreaterThan(0);
    expect(
      (await call(A, "POST", `/api/conversations/${c}/messages`, { content: "next" })).status,
    ).toBe(201); // lock released
  });

  test("clientRequestId makes a retried send idempotent", async () => {
    const { c } = await setup(A);
    const before = runs;
    const body = { content: "once", clientRequestId: "req-" + uuidv7() };
    const a = await call(A, "POST", `/api/conversations/${c}/messages`, body);
    const b = await call(A, "POST", `/api/conversations/${c}/messages`, body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.json.user.id).toBe(a.json.user.id);
    expect(runs - before).toBe(1);
    expect((await call(A, "GET", `/api/conversations/${c}/messages`)).json.messages).toHaveLength(
      2,
    );
  });

  test("assistant rows are persisted as running and recovered as interrupted after a crash", async () => {
    const { bot, c } = await setup(A);
    await db.$client.query(
      "insert into message (conversation_id, owner_user_id, seq, role, content, status, author_bot_id) values ($1,$2,1,'assistant','partial',  'running', $3)",
      [c, A, bot],
    );
    expect(await chat.recoverInterrupted()).toBeGreaterThanOrEqual(1);
    expect((await call(A, "GET", `/api/conversations/${c}/messages`)).json.messages[0].status).toBe(
      "interrupted",
    );
  });

  test("thread turns only see their own thread and the current message appears once", async () => {
    const { c } = await setup(A);
    const m1 = (await call(A, "POST", `/api/conversations/${c}/messages`, { content: "ROOT-ONE" }))
      .json.user.id;
    await call(A, "POST", `/api/conversations/${c}/messages`, {
      content: "SIBLING-THREAD",
      parentMessageId: m1,
    });
    const root2 = (
      await call(A, "POST", `/api/conversations/${c}/messages`, { content: "ROOT-TWO" })
    ).json.user.id;
    prompts.length = 0;
    await call(A, "POST", `/api/conversations/${c}/messages`, {
      content: "ASK-IN-THREAD",
      parentMessageId: root2,
    });
    const p = prompts.at(-1)!;
    expect(p).toContain("ROOT-TWO");
    expect(p).not.toContain("SIBLING-THREAD");
    expect(p).not.toContain("ROOT-ONE");
    expect(p.split("ASK-IN-THREAD").length - 1).toBe(1);
  });

  test("mentions are stored as ids and unknown or unready names are reported", async () => {
    const { c } = await setup(A);
    const r = await call(A, "POST", `/api/conversations/${c}/messages`, {
      content: "@Ghost please",
    });
    expect(r.json.user.mentions.skipped[0].name).toBe("ghost");
    expect(r.json.assistant.content).toContain("was not asked");
  });
});
