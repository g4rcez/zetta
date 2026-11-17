import { uuidv7 } from "@zetta/core/uuid";
import { topics } from "@zetta/core/live-topics";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { conversationSummary, message } from "@zetta/db/schema/chat";
import { discussionTurn } from "@zetta/db/schema/discussions";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createDiscussionStore } from "../discussions/store";
import { events } from "../events/bus";
import { createIdentityAccess } from "../identity/access";
import { createMemory } from "../memory/service";
import { createChatService } from "./service";
import { createSummaries } from "./summary";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`edit-a-${uuidv7()}`, `edit-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("editing a message against postgres", () => {
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
  const store = createDiscussionStore(db);
  const chat = createChatService(
    db,
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
    undefined,
    { discussions: store, memory: createMemory(db) },
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    discussions: { access, store, worker: {} as never, chat },
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
  const newBot = async (as: string, name: string, ready = true) => {
    const bot = (await call(as, "POST", "/api/bots", { name })).json.bot as { id: string };
    if (ready) await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    return bot;
  };
  const conv = async (as: string, botId: string) =>
    (await call(as, "POST", "/api/conversations", { botId })).json.conversation.id as string;
  const say = (c: string, content: string, extra: object = {}) =>
    call(A, "POST", `/api/conversations/${c}/messages`, { content, ...extra });
  const patch = (c: string, id: string, content: string, as = A) =>
    call(as, "PATCH", `/api/conversations/${c}/messages/${id}`, { content });
  const rows = async (c: string) =>
    (await db.select().from(message).where(eq(message.conversationId, c))).length;

  test("the author edits a message: new text, the mark, the old text kept newest first", async () => {
    const bot = await newBot(A, "Editor one", false);
    const c = await conv(A, bot.id);
    const sent = await say(c, "first draft");
    const id = sent.json.user.id as string;
    const before = await rows(c);

    const one = await patch(c, id, "second draft");
    expect(one.status).toBe(200);
    expect(one.json.message).toMatchObject({ id, content: "second draft" });
    expect(one.json.message.editedAt).toBeTruthy();
    // The shape of the list: the page can swap it in place.
    expect(one.json.message).toHaveProperty("reactions");
    expect(one.json.message).toHaveProperty("replyCount");
    expect(one.json.message).toHaveProperty("attachments");
    await patch(c, id, "third draft");

    const revisions = await call(A, "GET", `/api/conversations/${c}/messages/${id}/revisions`);
    expect(revisions.status).toBe(200);
    expect(revisions.json.revisions.map((r: { content: string }) => r.content)).toEqual([
      "second draft",
      "first draft",
    ]);
    // The list shows the new text with the mark.
    const listed = (await call(A, "GET", `/api/conversations/${c}/messages`)).json.messages.find(
      (m: { id: string }) => m.id === id,
    );
    expect(listed).toMatchObject({ content: "third draft" });
    expect(listed.editedAt).toBeTruthy();
    // An edit starts no turn: no message was added, no answer was written.
    expect(await rows(c)).toBe(before);
  });

  test("saving the same text again changes nothing", async () => {
    const bot = await newBot(A, "Editor same", false);
    const c = await conv(A, bot.id);
    const id = (await say(c, "same words")).json.user.id as string;
    const r = await patch(c, id, "same words");
    expect(r.status).toBe(200);
    expect(r.json.message.editedAt).toBeNull();
    expect(
      (await call(A, "GET", `/api/conversations/${c}/messages/${id}/revisions`)).json.revisions,
    ).toEqual([]);
  });

  test("only the author, and only a person's own messages", async () => {
    const bot = await newBot(A, "Editor guard", false);
    const c = await conv(A, bot.id);
    const sent = await say(c, "mine");
    const mine = sent.json.user.id as string;
    const answer = sent.json.assistant.id as string;
    // Someone else cannot even see the chat.
    expect((await patch(c, mine, "stolen", B)).status).toBe(404);
    expect(
      (await call(B, "GET", `/api/conversations/${c}/messages/${mine}/revisions`)).status,
    ).toBe(404);
    // A bot's reply is never edited.
    const reply = await patch(c, answer, "I said something else");
    expect(reply.status).toBe(403);
    // A message of another chat is not found through this one.
    const other = await conv(A, bot.id);
    expect((await patch(other, mine, "wrong chat")).status).toBe(404);
    // Text rules are the same as posting.
    expect((await patch(c, mine, "   ")).status).toBe(400);
    expect((await patch(c, mine, "x".repeat(32_769))).status).toBe(400);
    expect((await patch(c, mine, "x".repeat(32_768))).status).toBe(200);
    expect(
      (await call(A, "GET", `/api/conversations/${c}/messages/${answer}/revisions`)).status,
    ).toBe(403);
  });

  test("a message an outside person wrote, and a chat from outside, are never edited", async () => {
    const bot = await newBot(A, "Editor inbound", false);
    const c = await conv(A, bot.id);
    const id = (await say(c, "from the channel")).json.user.id as string;
    await db.$client.query(
      `update message set meta = '{"inbound":{"plugin":"whatsapp","label":"WhatsApp","chat":"1","chatName":"Ana"}}'::jsonb where id = $1`,
      [id],
    );
    expect((await patch(c, id, "rewritten")).status).toBe(403);
    const mine = (await say(c, "typed here")).json.user.id as string;
    await db.$client.query(`update conversation set kind = 'inbound' where id = $1`, [c]);
    expect((await patch(c, mine, "rewritten")).status).toBe(403);
  });

  test("a poll keeps its question", async () => {
    const bot = await newBot(A, "Editor poll", false);
    const c = await conv(A, bot.id);
    const sent = await say(c, "Lunch?", { poll: { options: ["Pizza", "Sushi"] } });
    expect(sent.status).toBe(201);
    expect((await patch(c, sent.json.user.id, "Dinner?")).status).toBe(403);
  });

  test("quotes of the message follow the new text, and a quoted part stays while it is still there", async () => {
    const bot = await newBot(A, "Editor quote", false);
    const c = await conv(A, bot.id);
    const root = (await say(c, "the deploy runs at noon on friday")).json.user.id as string;
    const whole = await say(c, "why?", { quotedMessageId: root });
    const part = await say(c, "friday?", {
      quotedMessageId: root,
      quoteExcerpt: "at noon  on\nfriday",
    });
    expect(part.status).toBe(201);
    expect(part.json.user.meta.quote).toMatchObject({ excerpt: "at noon  on\nfriday", part: true });
    // A selection that is not in the message is refused, with its own status.
    const wrong = await say(c, "no", { quotedMessageId: root, quoteExcerpt: "at midnight" });
    expect(wrong.status).toBe(422);
    expect(wrong.json.error.code).toBe("QUOTE_EXCERPT_NOT_FOUND");
    // A selection needs the message it comes from.
    expect((await say(c, "no", { quoteExcerpt: "noon" })).status).toBe(400);

    await patch(c, root, "the deploy runs at noon on monday now");
    const listed = (await call(A, "GET", `/api/conversations/${c}/messages`)).json.messages;
    const quoteOf = (id: string) => listed.find((m: { id: string }) => m.id === id).meta.quote;
    expect(quoteOf(whole.json.user.id).excerpt).toBe("the deploy runs at noon on monday now");
    // The selection "at noon on friday" is gone from the text: the quote falls back to the start of the message.
    expect(quoteOf(part.json.user.id)).toMatchObject({
      excerpt: "the deploy runs at noon on monday now",
    });
    expect(quoteOf(part.json.user.id).part).toBeUndefined();

    const keep = await say(c, "noon?", { quotedMessageId: root, quoteExcerpt: "runs at noon" });
    await patch(c, root, "the deploy runs at noon on tuesday");
    const again = (await call(A, "GET", `/api/conversations/${c}/messages`)).json.messages.find(
      (m: { id: string }) => m.id === keep.json.user.id,
    );
    expect(again.meta.quote).toMatchObject({ excerpt: "runs at noon", part: true });
  });

  test("the rolling summary is marked stale only when it covers the message", async () => {
    const bot = await newBot(A, "Editor summary", false);
    const c = await conv(A, bot.id);
    const early = (await say(c, "early")).json.user;
    const late = (await say(c, "late")).json.user;
    expect(late.seq).toBeGreaterThan(early.seq);
    await db.insert(conversationSummary).values({
      ownerUserId: A,
      conversationId: c,
      botId: bot.id,
      throughSeq: late.seq - 1,
      wantedThroughSeq: late.seq - 1,
      body: "the person said early",
      status: "ready",
    });
    const summary = async () =>
      (
        await db.select().from(conversationSummary).where(eq(conversationSummary.conversationId, c))
      )[0]!;
    // The message after what the summary covers: nothing to redo.
    await patch(c, late.id, "later");
    expect(await summary()).toMatchObject({ status: "ready", throughSeq: late.seq - 1 });
    // The message inside it: the summary is queued to be written again from the start.
    await patch(c, early.id, "earlier");
    expect(await summary()).toMatchObject({
      status: "pending",
      throughSeq: 0,
      wantedThroughSeq: late.seq - 1,
    });
    // The job writes it again from the messages, and does not feed the old summary (it holds the old text) back in.
    const prompts: string[] = [];
    const summaries = createSummaries(db, (async (_owner: string, prompt: string) => {
      prompts.push(prompt);
      return { kind: "ok", value: { summary: "the person said earlier" } };
    }) as never);
    await db.$client.query(`update bot set summary_mode = 'chief' where id = $1`, [bot.id]);
    expect(await summaries.tick()).toBe(1);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("the person said early");
    expect(prompts[0]).toContain("earlier");
    expect(await summary()).toMatchObject({
      status: "ready",
      body: "the person said earlier",
      throughSeq: late.seq - 1,
    });
  });

  test("an edit tells the live channel, and a new mention wakes nobody", async () => {
    const bot = await newBot(A, "Editor live", false);
    const helper = await newBot(A, "Edithelper");
    const c = await conv(A, bot.id);
    const id = (await say(c, "plain words")).json.user.id as string;
    const before = await rows(c);
    const seen: string[] = [];
    const stop = events.subscribe(A, (t) => seen.push(t));
    try {
      const r = await patch(c, id, "plain words, now asking @Edithelper");
      expect(r.status).toBe(200);
      expect(r.json.message.mentions.asked.map((m: { botId: string }) => m.botId)).toEqual([
        helper.id,
      ]);
      await Bun.sleep(400);
    } finally {
      stop();
    }
    expect(seen).toContain(topics.conversation(c));
    // Stored, but nobody was asked: no message, no answer.
    expect(await rows(c)).toBe(before);
  });

  test("the page around a message ends where the loaded page begins", async () => {
    const bot = await newBot(A, "Editor around", false);
    const c = await conv(A, bot.id);
    const sent: { id: string; seq: number }[] = [];
    for (let i = 0; i < 8; i++) sent.push((await say(c, `line ${i}`)).json.user);
    const target = sent[2]!;
    const newest = sent[7]!;
    const page = await call(
      A,
      "GET",
      `/api/conversations/${c}/messages?around=${target.id}&before=${newest.seq}`,
    );
    expect(page.status).toBe(200);
    const seqs = page.json.messages.map((m: { seq: number }) => m.seq);
    expect(seqs).toContain(target.seq);
    expect(Math.max(...seqs)).toBeLessThan(newest.seq);
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
    expect(page.json.messages[0].hasMore).toBe(false); // the window reaches the start of this short chat
    expect(
      (await call(A, "GET", `/api/conversations/${c}/messages?around=${uuidv7()}`)).status,
    ).toBe(404);
  });

  test("a room: the owner edits a post, nobody is woken, and a bot's message stays", async () => {
    const dev = await newBot(A, "Room dev");
    const created = await call(A, "POST", "/api/discussions", {
      title: "Edit room",
      members: [{ bot: dev.id }],
      firstMessage: "Hello room",
    });
    const roomId = created.json.discussion.id as string;
    const conversationId = created.json.discussion.conversationId as string;
    const posted = await call(A, "POST", `/api/discussions/${roomId}/messages`, {
      content: "first words",
    });
    expect(posted.status).toBe(201);
    const id = posted.json.message.id as string;
    const turns = async () =>
      (await db.select().from(discussionTurn).where(eq(discussionTurn.discussionId, roomId)))
        .length;
    const queued = await turns();
    const before = await rows(conversationId);

    const edit = (content: string, mid = id, as = A) =>
      call(as, "PATCH", `/api/discussions/${roomId}/messages/${mid}`, { content });
    const r = await edit("better words");
    expect(r.status).toBe(200);
    expect(r.json.message).toMatchObject({ id, content: "better words" });
    expect(r.json.message.editedAt).toBeTruthy();
    expect(r.json.message).toHaveProperty("reactions");
    expect(await turns()).toBe(queued);
    expect(await rows(conversationId)).toBe(before);
    // A room post holds 4000 characters.
    expect((await edit("x".repeat(4001))).status).toBe(400);
    expect((await edit("x".repeat(4000))).status).toBe(200);
    // Someone else, and a bot's message.
    expect((await edit("stolen", id, B)).status).toBe(404);
    const botRow = (
      await db
        .select()
        .from(message)
        .where(and(eq(message.conversationId, conversationId), eq(message.role, "assistant")))
    )[0];
    if (botRow) expect((await edit("no", botRow.id)).status).toBe(403);
    const revisions = await call(A, "GET", `/api/discussions/${roomId}/messages/${id}/revisions`);
    expect(revisions.json.revisions.map((x: { content: string }) => x.content)).toEqual([
      "better words",
      "first words",
    ]);
    // A selection quote works in a room too.
    const quoted = await call(A, "POST", `/api/discussions/${roomId}/messages`, {
      content: "this part",
      quotedMessageId: id,
      quoteExcerpt: "xxxx",
    });
    expect(quoted.status).toBe(201);
    expect(quoted.json.message.meta.quote).toMatchObject({ excerpt: "xxxx", part: true });
    const bad = await call(A, "POST", `/api/discussions/${roomId}/messages`, {
      content: "that part",
      quotedMessageId: id,
      quoteExcerpt: "nowhere",
    });
    expect(bad.status).toBe(422);
  });
});
