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
  // What the stand-in does with a message handed to it while it "works" (only a Claude Code run gets an inbox): takes and reads it
  // as the real CLI does, takes it and never reads it, or takes it, reads it and then breaks (once).
  // `restart_once`: a message is there before the run did anything, and the caller allows starting again (see `restartEarly`).
  let live: "read" | "never_read" | "fail_once" | "restart_once" = "read";
  // 6 chunks, 40ms apart, honours cancellation.
  const slowCli = async function* (t: {
    prompt: string;
    signal?: AbortSignal;
    session?: { id: string; resume: boolean };
    inbox?: {
      take(): Promise<{ id: string; text: string }[]>;
      read(ids: string[]): void;
      restartEarly?(): boolean;
    };
  }) {
    runs++;
    prompts.push(t.prompt);
    sessions.push(t.session);
    if (live === "restart_once" && t.inbox) {
      await Bun.sleep(80);
      if ((await t.inbox.take()).length && t.inbox.restartEarly?.()) {
        live = "read";
        throw new HarnessError("restarted");
      }
    }
    for (let i = 0; i < 6; i++) {
      if (t.signal?.aborted) throw new HarnessError("cancelled");
      await Bun.sleep(40);
      yield `part${i} `;
      const got = (await t.inbox?.take()) ?? [];
      if (!got.length || live === "never_read") continue;
      t.inbox!.read(got.map((g) => g.id));
      if (live === "fail_once") {
        live = "read";
        throw new HarnessError("failed");
      }
      yield `[read ${got.map((g) => g.text).join(", ")}] `;
    }
  };
  // The rounds after the first answer (a tool round, or the round for messages sent while the bot worked) are plain calls.
  const laterPrompts: string[] = [];
  const laterCli = async (t: { prompt: string }) => {
    laterPrompts.push(t.prompt);
    return "more";
  };
  const slowRun = createTurnRunner(db, laterCli as never, slowCli as never);
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
    meta?: { steer?: { replyId: string }; stop?: unknown } | null;
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

  test("messages sent while a turn runs are saved at once and read by the same reply, in order", async () => {
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
    expect(pending.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
      "FIRST",
      "SECOND",
      "THIRD",
    ]);
    laterPrompts.length = 0;
    while (!(await reader.read()).done);
    const msgs = await drained(c);
    // No second turn and no second reply: the reply that was running read both before it closed, and now sits below them.
    const replies = msgs.filter((m) => m.role === "assistant");
    expect(replies.map((m) => [m.status, m.parentMessageId ?? null])).toEqual([["complete", null]]);
    const reply = replies[0]!;
    expect(msgs.map((m) => m.role)).toEqual(["user", "user", "user", "assistant"]);
    expect(reply.seq).toBeGreaterThan(msgs.find((m) => m.content === "THIRD")!.seq);
    expect(msgs.some((m) => m.queue)).toBe(false);
    expect(
      msgs.filter((m) => m.role === "user").map((m) => [m.content, m.meta?.steer?.replyId ?? null]),
    ).toEqual([
      ["FIRST", null],
      ["SECOND", reply.id],
      ["THIRD", reply.id],
    ]);
    // What the bot had answered stays, and what it added follows.
    expect(reply.content).toContain("part5");
    expect(reply.content.trim().endsWith("more")).toBe(true);
    // One extra round read both messages once, oldest first, with the request and the reply so far.
    expect(laterPrompts).toHaveLength(1);
    const prompt = laterPrompts[0]!;
    expect(prompt).toContain("Original request:\nFIRST");
    expect(prompt).toContain("Your reply so far (it stays as it is):\npart0");
    expect(prompt).toContain("The user sent this while you worked");
    expect(prompt.indexOf("- SECOND")).toBeGreaterThan(-1);
    expect(prompt.indexOf("- THIRD")).toBeGreaterThan(prompt.indexOf("- SECOND"));
    expect(prompt.split("SECOND").length - 1).toBe(1);
  });

  test("a message that needs a turn of its own is answered after the reply, with what was sent after it", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    // A `/command` acts on its raw text when it starts a turn, so it is never read as a note; LATER is not read before it.
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "/own turn" });
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "LATER" });
    laterPrompts.length = 0;
    while (!(await reader.read()).done);
    const msgs = await drained(c);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual([
      "complete",
      "complete",
    ]);
    expect(msgs.some((m) => m.meta?.steer)).toBe(false);
    expect(laterPrompts).toHaveLength(0);
    // The second turn answers both, oldest first, and has the first reply as history.
    const batch = prompts.at(-1)!;
    expect(batch).toContain("Message 1 of 2:\n/own turn");
    expect(batch).toContain("Message 2 of 2:\nLATER");
    expect(batch).toContain("part5");
  });

  test("a reply that read a later message is still history for a message answered after it", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    // NOTE is read by the running reply, which then moves below it; "/after" waits for its own turn and is older than that reply.
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "NOTE" });
    while (!(await reader.read()).done);
    await drained(c);
    const second = await chatReq(A, c, { content: "slow again" });
    const reader2 = second.body!.getReader();
    await reader2.read();
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "/after" });
    prompts.length = 0;
    while (!(await reader2.read()).done);
    const msgs = await drained(c);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
    // The turn for "/after" reads everything that was answered before it, in the order it happened.
    const prompt = prompts.at(-1)!;
    expect(prompt.indexOf("user: slow")).toBeGreaterThan(-1);
    expect(prompt.indexOf("user: NOTE")).toBeGreaterThan(prompt.indexOf("user: slow"));
    expect(prompt.indexOf("user: slow again")).toBeGreaterThan(prompt.indexOf("user: NOTE"));
    expect(prompt.indexOf("assistant: part0")).toBeGreaterThan(prompt.indexOf("user: NOTE"));
  });

  test("a run the server started in a chat (a notice, a loop step) reads what the person sends while it works", async () => {
    const { c } = await setup(A);
    const actor = await access.requireActive(new Headers({ "x-test-user": A }));
    laterPrompts.length = 0;
    const { rec } = await chat.startTurn(actor, c, {
      content: "Checking on the task",
      notice: { prompt: "A task you follow moved. Carry on with it." },
    });
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "NOTE-FOR-THE-STEP" });
    await rec.finished;
    const msgs = await drained(c);
    const replies = msgs.filter((m) => m.role === "assistant");
    expect(replies.map((m) => m.status)).toEqual(["complete"]);
    expect(msgs.find((m) => m.content === "NOTE-FOR-THE-STEP")!.meta?.steer?.replyId).toBe(
      replies[0]!.id,
    );
    expect(laterPrompts).toHaveLength(1);
    expect(laterPrompts[0]).toContain("- NOTE-FOR-THE-STEP");
    expect(await db.select().from(chatQueue).where(eq(chatQueue.conversationId, c))).toEqual([]);
  });

  const claudeChat = async () => {
    const bot = (
      await call(A, "POST", "/api/bots", { name: `L${uuidv7().slice(-4)}`, harness: "claude-code" })
    ).json.bot.id as string;
    return (await call(A, "POST", "/api/conversations", { botId: bot })).json.conversation
      .id as string;
  };

  test("a run that reads messages while it works: the message is read by the running reply, with no extra round", async () => {
    const c = await claudeChat();
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    laterPrompts.length = 0;
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "LIVE-NOTE" });
    let rest = "";
    const dec = new TextDecoder();
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest += dec.decode(r.value);
    const msgs = await drained(c);
    const replies = msgs.filter((m) => m.role === "assistant");
    expect(replies.map((m) => m.status)).toEqual(["complete"]);
    expect(replies[0]!.content).toContain("[read LIVE-NOTE]");
    expect(replies[0]!.content).toContain("part5");
    // The run itself read it: no round before the reply closed, nothing left in the queue.
    expect(laterPrompts).toHaveLength(0);
    expect(await db.select().from(chatQueue).where(eq(chatQueue.conversationId, c))).toEqual([]);
    const note = msgs.find((m) => m.content === "LIVE-NOTE")!;
    expect(note.meta?.steer?.replyId).toBe(replies[0]!.id);
    expect(replies[0]!.seq).toBeGreaterThan(note.seq);
    // The page was told the moment the bot took it.
    expect(rest).toContain('"type":"data-steer"');
  });

  test("a message that arrives before the bot did anything starts the run again: one answer to both", async () => {
    const c = await claudeChat();
    live = "restart_once";
    try {
      const first = await chatReq(A, c, { content: "FIRST-ASK" });
      const reader = first.body!.getReader();
      await reader.read();
      const before = prompts.length;
      laterPrompts.length = 0;
      await call(A, "POST", `/api/conversations/${c}/queue`, { content: "SECOND-ASK" });
      while (!(await reader.read()).done);
      const msgs = await drained(c);
      const replies = msgs.filter((m) => m.role === "assistant");
      expect(replies.map((m) => m.status)).toEqual(["complete"]);
      // The run that starts again has both messages in its prompt, the later one marked as added; its text is the whole reply.
      const again = prompts.slice(before).at(-1)!;
      expect(again).toContain("FIRST-ASK");
      expect(again).toContain("The user sent more before you started working");
      expect(again.trim().endsWith("- SECOND-ASK")).toBe(true);
      expect(replies[0]!.content.split("part0").length - 1).toBe(1);
      expect(laterPrompts).toHaveLength(0);
      const second = msgs.find((m) => m.content === "SECOND-ASK")!;
      expect(second.meta?.steer?.replyId).toBe(replies[0]!.id);
      expect(replies[0]!.seq).toBeGreaterThan(second.seq);
      expect(await db.select().from(chatQueue).where(eq(chatQueue.conversationId, c))).toEqual([]);
    } finally {
      live = "read";
    }
  });

  test("a message written to a run that never took it is read before the reply closes", async () => {
    const c = await claudeChat();
    live = "never_read";
    try {
      const first = await chatReq(A, c, { content: "slow" });
      const reader = first.body!.getReader();
      await reader.read();
      laterPrompts.length = 0;
      await call(A, "POST", `/api/conversations/${c}/queue`, { content: "MISSED-NOTE" });
      while (!(await reader.read()).done);
      const msgs = await drained(c);
      const replies = msgs.filter((m) => m.role === "assistant");
      expect(replies.map((m) => m.status)).toEqual(["complete"]);
      expect(replies[0]!.content).not.toContain("[read");
      expect(laterPrompts).toHaveLength(1);
      expect(laterPrompts[0]).toContain("- MISSED-NOTE");
      expect(replies[0]!.content.trim().endsWith("more")).toBe(true);
      expect(msgs.find((m) => m.content === "MISSED-NOTE")!.meta?.steer?.replyId).toBe(
        replies[0]!.id,
      );
      expect(await db.select().from(chatQueue).where(eq(chatQueue.conversationId, c))).toEqual([]);
    } finally {
      live = "read";
    }
  });

  test("a run that breaks after it took a message did not answer it: the next turn does", async () => {
    const c = await claudeChat();
    live = "fail_once";
    try {
      const first = await chatReq(A, c, { content: "slow" });
      const reader = first.body!.getReader();
      await reader.read();
      await call(A, "POST", `/api/conversations/${c}/queue`, { content: "LOST-NOTE" });
      while (!(await reader.read()).done);
      const msgs = await drained(c);
      expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual([
        "failed",
        "complete",
      ]);
      // The message is not marked as read by the reply that failed, and the turn after it was given the message.
      expect(msgs.find((m) => m.content === "LOST-NOTE")!.meta?.steer).toBeUndefined();
      expect(prompts.at(-1)!.trim().endsWith("LOST-NOTE")).toBe(true);
      expect(await db.select().from(chatQueue).where(eq(chatQueue.conversationId, c))).toEqual([]);
    } finally {
      live = "read";
    }
  });

  test("Stop ends the reply; messages the bot had not read stay in the chat and nothing answers them", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "Q1" });
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "Q2" });
    laterPrompts.length = 0;
    expect((await call(A, "POST", `/api/conversations/${c}/cancel`)).json.cancelled).toBe(true);
    while (!(await reader.read()).done);
    const msgs = await drained(c);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual(["cancelled"]);
    // Both messages are still there as what was said: no state, nothing to send or remove, and the bot never read them.
    expect(msgs.filter((m) => m.role === "user").map((m) => [m.content, m.queue ?? null])).toEqual([
      ["slow", null],
      ["Q1", null],
      ["Q2", null],
    ]);
    expect(msgs.some((m) => m.meta?.steer)).toBe(false);
    expect(await db.select().from(chatQueue).where(eq(chatQueue.conversationId, c))).toEqual([]);
    // Nothing runs behind the person's back: a tick later no answer has started.
    const before = runs;
    await chat.drainQueues();
    await Bun.sleep(100);
    expect(runs).toBe(before);
    expect(laterPrompts).toHaveLength(0);
  });

  test("a message sent after Stop is answered, and the bot sees the unread ones as earlier messages", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "UNREAD-ONE" });
    await call(A, "POST", `/api/conversations/${c}/cancel`);
    while (!(await reader.read()).done);
    await drained(c);
    prompts.length = 0;
    const next = await chatReq(A, c, { content: "NEW-REQUEST" });
    await next.text();
    const msgs = await drained(c);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual([
      "cancelled",
      "complete",
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("user: UNREAD-ONE");
    expect(prompts[0]!.trim().endsWith("NEW-REQUEST")).toBe(true);
  });

  test('"para" typed while the bot works stops it: the reply ends, the waiting message is not answered, nor is the word', async () => {
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
    // No run ever read the waiting message or the stop word (the first run may only just have started when the word arrived).
    expect(prompts.slice(seen).some((p) => /ALSO-THIS|Para!/.test(p))).toBe(false);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual(["cancelled"]);
    expect(msgs.find((m) => m.content === "ALSO-THIS")!.queue).toBeUndefined();
    const word = msgs.find((m) => m.content === "Para!")!;
    expect(word.queue).toBeUndefined();
    expect(word.meta?.stop).toEqual({ unread: 1, rooms: 0 });
  });

  test("a sentence that only contains a stop word is an ordinary message: the running reply reads it", async () => {
    const { c } = await setup(A);
    const first = await chatReq(A, c, { content: "slow" });
    const reader = first.body!.getReader();
    await reader.read();
    await call(A, "POST", `/api/conversations/${c}/queue`, { content: "para o João revisar" });
    while (!(await reader.read()).done);
    const msgs = await drained(c);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual(["complete"]);
    expect(msgs.find((m) => m.content === "para o João revisar")!.meta?.steer).toBeDefined();
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
