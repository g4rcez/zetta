import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { chatQueue, message } from "@zetta/db/schema/chat";
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
  const chat = createChatService(
    db,
    slowRun,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { backgroundActor: (id) => access.requireActive(new Headers({ "x-test-user": id })) },
  );
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
  // services.ts sets ZETTA_CODE_ACCESS=off while it is imported (when the shared database is in network mode), and which test files
  // import it first varies by machine: this suite needs code access on, so it owns the variable.
  let savedCodeAccess: string | undefined;
  beforeAll(async () => {
    savedCodeAccess = process.env.ZETTA_CODE_ACCESS;
    delete process.env.ZETTA_CODE_ACCESS;
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
    if (savedCodeAccess === undefined) delete process.env.ZETTA_CODE_ACCESS;
    else process.env.ZETTA_CODE_ACCESS = savedCodeAccess;
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

  type Row = {
    id: string;
    seq: number;
    role: string;
    content: string;
    status: string;
    parentMessageId?: string | null;
    queue?: string;
  };
  /** Waits until nothing is queued or running in the conversation, then returns its messages. */
  const drained = async (c: string): Promise<Row[]> => {
    for (let i = 0; i < 200; i++) {
      const msgs = (await call(A, "GET", `/api/conversations/${c}/messages`)).json
        .messages as Row[];
      if (
        !msgs.some((m) => m.queue === "pending" || m.queue === "running" || m.status === "running")
      )
        return msgs;
      await Bun.sleep(50);
    }
    throw new Error("the queue did not drain");
  };
  const chatReq = (as: string, c: string, body: object) =>
    req(as, "POST", `/api/conversations/${c}/chat`, body);

  test("messages sent while a turn runs are saved at once and answered together by one turn, in order", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "FIRST" });
    const reader = first.body!.getReader();
    await reader.read();
    const queued = await call(A, "POST", `/api/conversations/${c}/queue`, { content: "SECOND" });
    expect(queued.status).toBe(201);
    const busy = await chatReq(A, c, { content: "THIRD" });
    expect(busy.status).toBe(200);
    expect(await busy.text()).toContain('"type":"data-user-saved"');
    const pending = (await call(A, "GET", `/api/conversations/${c}/messages`)).json
      .messages as Row[];
    expect(
      pending.filter((m) => m.role === "user").map((m) => [m.content, m.queue ?? null]),
    ).toEqual([
      ["FIRST", null],
      ["SECOND", "pending"],
      ["THIRD", "pending"],
    ]);
    while (!(await reader.read()).done);
    prompts.length = 0;
    const before = runs;
    const msgs = await drained(c);
    // One turn answered both, on the main line, after the last of them: no thread, no second turn.
    expect(runs - before).toBe(1);
    const replies = msgs.filter((m) => m.role === "assistant");
    expect(replies.map((m) => [m.status, m.parentMessageId ?? null])).toEqual([
      ["complete", null],
      ["complete", null],
    ]);
    const third = msgs.find((m) => m.content === "THIRD")!;
    expect(replies[1]!.seq).toBeGreaterThan(third.seq);
    expect(msgs.some((m) => m.queue)).toBe(false);
    // The bot reads both messages once, oldest first, is told the later one wins, and still has what came before them.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Message 1 of 2:\nSECOND");
    expect(prompts[0]).toContain("Message 2 of 2:\nTHIRD");
    expect(prompts[0]).toContain("the latest instruction wins");
    expect(prompts[0]!.split("SECOND").length - 1).toBe(1);
    expect(prompts[0]!.split("THIRD").length - 1).toBe(1);
    expect(prompts[0]).toContain("FIRST");
  });

  test("a message sent while the batch is answered waits for the next turn", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "B1" });
    while (!(await reader.read()).done);
    // The batch turn (B1) is running now: B2 is not part of it.
    for (let i = 0; i < 100; i++) {
      const [row] = await db.select().from(chatQueue).where(eq(chatQueue.conversationId, c));
      if (row?.status === "running") break;
      await Bun.sleep(10);
    }
    prompts.length = 0;
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "B2" });
    const msgs = await drained(c);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
    // B2's own turn reads B2 as typed (one message is never wrapped), with B1 and its answer as history.
    const last = prompts.at(-1)!;
    expect(last).toContain("B2");
    expect(last).not.toContain("Message 1 of");
    expect(last).toContain("B1");
  });

  test("Stop ends the reply and holds the queued messages until the person sends or removes them", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    const q1 = await call(A, "POST", `/api/conversations/${c}/queue`, { content: "Q1" });
    const q2 = await call(A, "POST", `/api/conversations/${c}/queue`, { content: "Q2" });
    expect((await call(A, "POST", `/api/conversations/${c}/cancel`)).json.cancelled).toBe(true);
    while (!(await reader.read()).done);
    let msgs = await drained(c);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual(["cancelled"]);
    expect(msgs.filter((m) => m.queue).map((m) => [m.content, m.queue])).toEqual([
      ["Q1", "held"],
      ["Q2", "held"],
    ]);
    // Nothing runs behind the person's back: a tick later the held messages are still held.
    const before = runs;
    await chat.drainQueues();
    await Bun.sleep(100);
    expect(runs).toBe(before);
    // Someone else cannot release it; the owner sends one and removes the other.
    const id1 = q1.json.message.id as string;
    const id2 = q2.json.message.id as string;
    expect((await call(B, "POST", `/api/conversations/${c}/queue/${id1}/retry`)).status).toBe(404);
    expect((await call(A, "DELETE", `/api/conversations/${c}/queue/${id2}`)).status).toBe(200);
    expect((await call(A, "POST", `/api/conversations/${c}/queue/${id1}/retry`)).status).toBe(200);
    msgs = await drained(c);
    expect(msgs.some((m) => m.content === "Q2")).toBe(false);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual([
      "cancelled",
      "complete",
    ]);
    expect(msgs.some((m) => m.queue)).toBe(false);
  });

  test("a message sent after Stop is answered; it does not release what was held", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "HELD" });
    await call(A, "POST", `/api/conversations/${c}/cancel`);
    while (!(await reader.read()).done);
    await drained(c);
    prompts.length = 0;
    const next = await chatReq(A, c, { content: "NEW-REQUEST" });
    await next.text();
    const msgs = await drained(c);
    expect(msgs.find((m) => m.content === "HELD")!.queue).toBe("held");
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual([
      "cancelled",
      "complete",
    ]);
    expect(prompts).toHaveLength(1);
  });

  test("Send now interrupts the reply: the waiting message runs at once, continues the same session, and is told what was done", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "use the other file" });
    prompts.length = 0;
    expect((await call(A, "POST", `/api/conversations/${c}/interrupt`)).json).toEqual({
      interrupted: true,
    });
    expect((await call(B, "POST", `/api/conversations/${c}/interrupt`)).status).toBe(404);
    while (!(await reader.read()).done);
    const msgs = await drained(c);
    // Nothing held: the interrupted reply is stopped and the message is answered.
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual([
      "cancelled",
      "complete",
    ]);
    expect(msgs.some((m) => m.queue)).toBe(false);
    expect(prompts.at(-1)).toContain("interrupted you");
    expect(prompts.at(-1)).toContain("use the other file");
  });

  test("with Interrupt chosen in preferences, a message sent while the bot works interrupts it and is read at once", async () => {
    const { c } = await setup(A);
    await db.$client.query(
      "insert into user_preference (owner_user_id, steer_mode) values ($1, 'interrupt') on conflict (owner_user_id) do update set steer_mode = 'interrupt'",
      [A],
    );
    try {
      const first = await chatReq(A, c, { content: "slow" });
      const reader = first.body!.getReader();
      await reader.read();
      prompts.length = 0;
      await call(A, "POST", `/api/conversations/${c}/queue`, { content: "use the staging db" });
      while (!(await reader.read()).done);
      const msgs = await drained(c);
      expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual([
        "cancelled",
        "complete",
      ]);
      expect(prompts.at(-1)).toContain("interrupted you");
    } finally {
      await db.$client.query(
        "update user_preference set steer_mode = 'park' where owner_user_id = $1",
        [A],
      );
    }
  });

  test('"para" typed while the bot works stops it: the reply ends, the waiting message is held, the word is not answered', async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "ALSO-THIS" });
    const seen = prompts.length;
    const stop = await chatReq(A, c, { content: "Para!" });
    expect(stop.status).toBe(200);
    expect(await stop.text()).toContain('"type":"data-user-saved"');
    while (!(await reader.read()).done);
    const msgs = await drained(c);
    await Bun.sleep(100);
    // No run ever read the held message or the stop word (the first run may only just have started when the word arrived).
    expect(prompts.slice(seen).some((p) => /ALSO-THIS|Para!/.test(p))).toBe(false);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual(["cancelled"]);
    expect(msgs.find((m) => m.content === "ALSO-THIS")!.queue).toBe("held");
    const word = msgs.find((m) => m.content === "Para!")! as Row & { meta?: { stop?: unknown } };
    expect(word.queue).toBeUndefined();
    expect(word.meta?.stop).toEqual({ held: 1, rooms: 0 });
  });

  test("a sentence that only contains a stop word is an ordinary queued message", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "para o João revisar" });
    while (!(await reader.read()).done);
    const msgs = await drained(c);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual([
      "complete",
      "complete",
    ]);
  });

  test('"stop" in an idle chat with nothing running is a message for the bot', async () => {
    const { c } = await setup(A);
    const before = runs;
    await (await chatReq(A, c, { content: "stop" })).text();
    const msgs = await drained(c);
    expect(runs - before).toBe(1);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual(["complete"]);
  });

  test("a queued message can be removed before it starts, and a repeated clientRequestId queues it once", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    const body = { content: "DROP-ME", clientRequestId: "req-" + uuidv7() };
    const a = await call(A, "POST", `/api/conversations/${c}/queue`, body);
    const b = await call(A, "POST", `/api/conversations/${c}/queue`, body);
    expect(b.json.message.id).toBe(a.json.message.id);
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "KEEP-ME" });
    const id = a.json.message.id as string;
    expect((await call(B, "DELETE", `/api/conversations/${c}/queue/${id}`)).status).toBe(404);
    expect((await call(A, "DELETE", `/api/conversations/${c}/queue/${id}`)).status).toBe(200);
    expect((await call(A, "DELETE", `/api/conversations/${c}/queue/${id}`)).status).toBe(404);
    while (!(await reader.read()).done);
    const msgs = await drained(c);
    expect(msgs.some((m) => m.content === "DROP-ME")).toBe(false);
    const keep = msgs.find((m) => m.content === "KEEP-ME")!;
    expect(
      msgs.find((m) => m.role === "assistant" && m.seq > keep.seq && !m.parentMessageId)!.status,
    ).toBe("complete");
  });

  test("after a restart a batch that was running starts again whole; a message that keeps failing stops and can be retried", async () => {
    const { c } = await setup(A);
    const [early, asked] = await db
      .insert(message)
      .values([
        { conversationId: c, ownerUserId: A, seq: 1, role: "user", content: "RODE-ALONG" },
        { conversationId: c, ownerUserId: A, seq: 2, role: "user", content: "LOST-IN-RESTART" },
      ])
      .returning();
    const [anchor] = await db
      .insert(chatQueue)
      .values({
        ownerUserId: A,
        conversationId: c,
        messageId: asked!.id,
        status: "running",
        attempts: 1,
      })
      .returning();
    await db.insert(chatQueue).values({
      ownerUserId: A,
      conversationId: c,
      messageId: early!.id,
      status: "merged",
      batchId: anchor!.id,
      attempts: 1,
      createdAt: new Date(anchor!.createdAt.getTime() - 1000),
    });
    expect(await chat.recoverQueue()).toBeGreaterThanOrEqual(2);
    prompts.length = 0;
    await chat.drainQueues();
    let msgs = await drained(c);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual(["complete"]);
    expect(prompts[0]).toContain("Message 1 of 2:\nRODE-ALONG");
    expect(prompts[0]).toContain("Message 2 of 2:\nLOST-IN-RESTART");
    expect(msgs.some((m) => m.queue)).toBe(false);

    const [stuck] = await db
      .insert(message)
      .values({ conversationId: c, ownerUserId: A, seq: 50, role: "user", content: "CRASHES" })
      .returning();
    await db
      .insert(chatQueue)
      .values({ ownerUserId: A, conversationId: c, messageId: stuck!.id, attempts: 3 });
    await chat.drainQueues();
    msgs = await drained(c);
    expect(msgs.find((m) => m.id === stuck!.id)!.queue).toBe("failed");
    expect(msgs.some((m) => m.role === "assistant" && m.seq > stuck!.seq)).toBe(false);
    expect((await call(A, "POST", `/api/conversations/${c}/queue/${stuck!.id}/retry`)).status).toBe(
      200,
    );
    msgs = await drained(c);
    expect(msgs.find((m) => m.role === "assistant" && m.seq > stuck!.seq)!.status).toBe("complete");
  });
});
