import { world } from "../integrations/plugins/test-world";
import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { createMemory } from "../memory/service";
import { configureMailbox } from "../integrations/plugins/mailbox";
import { createMailChat } from "./chat";
import type { Conversation, MailboxDriver } from "./driver";
import { mailContextLine } from "./context";
import { createMailHarness } from "./routes-harness";
import { createMailboxStore } from "./store";

/**
 * The chat of a mailbox and the mail conversation sent along with a message, on a real database with a scripted bot and a fake mail
 * driver. Needs `ZETTA_TEST_DB=embedded`; skipped without it.
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const [A, B] = [`mch-a-${uuidv7()}`, `mch-b-${uuidv7()}`];
const OWN = "ana@example.invalid";
const SUBJECT = "Quarterly vendor audit";
const SENDER = "zorblat@example.invalid";
const BODY_WORD = "pomegranate";

const CONV_ID = "conv-audit-1";
const audit: Conversation = {
  id: CONV_ID,
  subject: SUBJECT,
  messages: [
    {
      id: "m1",
      messageId: "m1@example.invalid",
      origin: "received",
      from: { name: "Zorblat Quux", address: SENDER },
      to: [{ name: "Ana", address: OWN }],
      cc: [],
      replyTo: [],
      date: "2026-01-01T10:00:00.000Z",
      subject: SUBJECT,
      text: `Please send the ${BODY_WORD} invoices by Friday.`,
      htmlUnsafe: "",
      attachments: [],
      source: "complete",
    },
  ],
};

suite("the chat of a mailbox and the mail conversation sent with a message", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const seen = { opens: [] as string[] };
  const driver: MailboxDriver = {
    check: async () => {},
    listConversations: async () => ({ conversations: [] }),
    getConversation: async (id) => (seen.opens.push(id), audit),
    getAttachment: async () => ({ fileName: "x", contentType: "x", bytes: new Uint8Array() }),
    getAttachments: async () => new Map(),
    send: async () => ({ messageId: "x", copy: "provider" }),
  };
  const lookup = async () => ({ isAdmin: false });
  const store = createMailboxStore(db);
  let script: string[] = [];
  const runs: { bot: string; prompt: string }[] = [];
  const reply = (t: { bot: { name: string }; prompt: string }) => {
    runs.push({ bot: t.bot.name, prompt: t.prompt });
    return script.shift() ?? "done";
  };
  const fakeRun = Object.assign(async (t: never) => ({ text: reply(t), stopped: false }), {
    stream: async function* (t: never) {
      yield reply(t);
    },
  });
  // Plugins on in-memory installs and bindings (built-in ones are activated per bot in beforeAll), with the real database for the audit.
  const { plugins } = world({ db });
  const chat = createChatService(
    db,
    fakeRun as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      plugins,
      openScope: () => undefined,
      runConfig: async () => undefined,
      tokenOf: async () => undefined,
      isBound: async () => false,
    } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    { memory: createMemory(db) },
  );
  const mailChat = createMailChat({
    db,
    store,
    chiefOf: async (a) => (await chat.ensureChief(a))!,
  });
  const h = createMailHarness(db, { driverFor: () => driver, chat: mailChat });
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    lookup,
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
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

  let actorA: Awaited<ReturnType<typeof issueBackgroundActor>> & {};
  let ownerBot = "";
  let otherBot = "";
  let chiefBot = "";
  let boxOwned = "";
  let boxFree = "";
  let boxB = "";
  const servers = {
    imapHost: "imap.example.invalid",
    imapPort: 993,
    smtpHost: "smtp.example.invalid",
    smtpPort: 465,
    user: OWN,
  };
  const mkBot = async (owner: string, name: string) =>
    (
      await db
        .insert(bot)
        .values({
          ownerUserId: owner,
          name,
          slug: `${name.toLowerCase()}-${uuidv7().slice(-8)}`,
          kind: "specialist",
          visibility: "private",
          onboarded: true,
        })
        .returning({ id: bot.id })
    )[0]!.id;
  const connect = async (address: string, label: string, botId?: string, as = actorA) =>
    (
      await h.mail.connect(as, {
        address,
        label,
        servers: { ...servers, user: address },
        password: "pw-test-not-a-real-password",
        ...(botId ? { botId } : {}),
      })
    ).id;
  const mailboxChat = async (as: string, id: string) =>
    h.call(as, "POST", `/api/mailboxes/${id}/chat`);
  const chatsTitled = async (title: string) =>
    (
      await db
        .select({ id: conversation.id })
        .from(conversation)
        .where(and(eq(conversation.ownerUserId, A), eq(conversation.title, title)))
    ).length;
  const pointer = async (id: string) =>
    (await db.$client.query("select chat_conversation_id from mailbox where id = $1", [id])).rows[0]
      .chat_conversation_id as string | null;
  const reset = () => {
    script = [];
    runs.length = 0;
    seen.opens.length = 0;
  };
  const ctx = (mailboxId: string, conversationId = CONV_ID) => ({
    kind: "mail" as const,
    mailboxId,
    conversationId,
  });
  const send = (as: string, conv: string, extra: Record<string, unknown>, content = "go") =>
    call(as, "POST", `/api/conversations/${conv}/messages`, { content, ...extra });
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 50));
    return ok();
  };
  const block = (tool: string, args: object) =>
    `\`\`\`zetta:plugin\n${JSON.stringify({ plugin: "mailbox", tool, args })}\n\`\`\``;

  beforeAll(async () => {
    const now = new Date();
    for (const id of [A, B]) {
      await db.insert(user).values({
        id,
        name: id,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .insert(membership)
        .values({ userId: id, status: "active" as const, joinedAt: now, updatedAt: now });
    }
    actorA = (await issueBackgroundActor(lookup, A))!;
    const actorB = (await issueBackgroundActor(lookup, B))!;
    ownerBot = await mkBot(A, "Mailer");
    otherBot = await mkBot(A, "Other");
    chiefBot = (await chat.ensureChief(actorA))!.id;
    // Built in, but not on by default: the person activates it for the bots that may use it.
    await plugins.install(actorA, "mailbox", {}, [ownerBot, otherBot, chiefBot]);
    // A Chief on the fixture harness answers with setup guidance instead of running the (scripted) engine.
    await db.update(bot).set({ harness: "claude-code" }).where(eq(bot.id, chiefBot));
    boxOwned = await connect(OWN, "Work", ownerBot);
    boxFree = await connect("free@example.invalid", "Shared");
    boxB = await connect("bea@example.invalid", "Bea", undefined, actorB);
    configureMailbox({
      sealKey: (userId) => `test-seal-key-${userId}`,
      store,
      mail: h.mail,
      actorFor: (userId) => issueBackgroundActor(lookup, userId),
      async botOf(userId, botId) {
        const [row] = await db
          .select({ id: bot.id, kind: bot.kind, ownerUserId: bot.ownerUserId })
          .from(bot)
          .where(and(eq(bot.id, botId), eq(bot.ownerUserId, userId)));
        return row ?? null;
      },
    });
  });
  afterAll(async () => {
    configureMailbox(undefined);
    await cleanupTestUsers(db, [A, B]);
  });

  test("the chat of a mailbox with an owner bot is made once, titled by the mailbox, and reused", async () => {
    const first = await mailboxChat(A, boxOwned);
    expect(first.status).toBe(200);
    expect(first.json.chat).toMatchObject({ botId: ownerBot, botKind: "specialist" });
    const again = await mailboxChat(A, boxOwned);
    expect(again.json.chat.conversationId).toBe(first.json.chat.conversationId);
    expect(await pointer(boxOwned)).toBe(first.json.chat.conversationId);
    expect(await chatsTitled("Mail: Work")).toBe(1);
    const [row] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.id, first.json.chat.conversationId));
    expect(row).toMatchObject({
      ownerUserId: A,
      botId: ownerBot,
      kind: "chat",
      title: "Mail: Work",
      titleSource: "manual",
    });
  });

  test("two requests at once still make one chat", async () => {
    const id = await connect("race@example.invalid", "Race", ownerBot);
    const all = await Promise.all([1, 2, 3, 4].map(() => mailboxChat(A, id)));
    expect(new Set(all.map((r) => r.json.chat.conversationId)).size).toBe(1);
    expect(await chatsTitled("Mail: Race")).toBe(1);
  });

  test("with no owner bot the chat is with the person's Chief, and the store accepts it (ownsChat)", async () => {
    const r = await mailboxChat(A, boxFree);
    expect(r.json.chat).toMatchObject({ botId: chiefBot, botKind: "chief" });
    expect((await mailboxChat(A, boxFree)).json.chat.conversationId).toBe(
      r.json.chat.conversationId,
    );
    // The same chat set through the store's own update is accepted, and a chat with another bot is not.
    const saved = await store.update(actorA, boxFree, {
      chatConversationId: r.json.chat.conversationId,
    });
    expect(saved.chatConversationId).toBe(r.json.chat.conversationId);
    const wrong = (await mailboxChat(A, boxOwned)).json.chat.conversationId;
    await expect(
      store.update(actorA, boxFree, { chatConversationId: wrong }),
    ).rejects.toMatchObject({
      code: "BAD_REFERENCE",
    });
  });

  test("a new owner gets a fresh chat; the old one stays in the chat list", async () => {
    const id = await connect("swap@example.invalid", "Swap", ownerBot);
    const old = (await mailboxChat(A, id)).json.chat.conversationId;
    await h.mail.update(actorA, id, { botId: otherBot });
    expect(await pointer(id)).toBeNull();
    const fresh = (await mailboxChat(A, id)).json.chat;
    expect(fresh).toMatchObject({ botId: otherBot });
    expect(fresh.conversationId).not.toBe(old);
    expect(await chatsTitled("Mail: Swap")).toBe(2);
    await h.mail.update(actorA, id, { botId: null });
    const chief = (await mailboxChat(A, id)).json.chat;
    expect(chief).toMatchObject({ botId: chiefBot, botKind: "chief" });
    expect(await chatsTitled("Mail: Swap")).toBe(3);
  });

  test("an archived chat is not reused", async () => {
    const id = await connect("arch@example.invalid", "Arch", ownerBot);
    const first = (await mailboxChat(A, id)).json.chat.conversationId;
    await db.update(conversation).set({ archived: true }).where(eq(conversation.id, first));
    const next = (await mailboxChat(A, id)).json.chat.conversationId;
    expect(next).not.toBe(first);
  });

  test("another person's mailbox is 404, and makes no chat", async () => {
    const before = await chatsTitled("Mail: Bea");
    const r = await mailboxChat(A, boxB);
    expect(r.status).toBe(404);
    expect(await chatsTitled("Mail: Bea")).toBe(before);
    expect((await mailboxChat(A, uuidv7())).status).toBe(404);
  });

  test("a valid context reaches the bot as one line of ids; no subject, sender or word of the mail before mail_read", async () => {
    reset();
    const c = (await mailboxChat(A, boxOwned)).json.chat.conversationId as string;
    script = [
      block("mail_read", { mailbox: boxOwned, conversation: CONV_ID }),
      `They want the ${BODY_WORD} invoices.`,
    ];
    const r = await send(A, c, { context: ctx(boxOwned) }, "What does this person want?");
    expect(r.status).toBe(201);
    expect(r.json.assistant.content).toContain("invoices");
    // The first run, before the bot read anything.
    const line = mailContextLine({ mailboxId: boxOwned, conversationId: CONV_ID });
    expect(runs[0]!.prompt).toContain(line);
    expect(line).toContain(boxOwned);
    expect(line).toContain(CONV_ID);
    for (const secret of [SUBJECT, "Quarterly", SENDER, "Zorblat", BODY_WORD])
      expect(runs[0]!.prompt).not.toContain(secret);
    // Nothing of the mail is stored in the person's message either.
    const stored = JSON.stringify(
      (
        await db.$client.query("select content, meta from message where conversation_id = $1", [c])
      ).rows.filter((m: { content: string }) => m.content === "What does this person want?"),
    );
    expect(stored).toContain(CONV_ID);
    for (const secret of [SUBJECT, SENDER, "Zorblat", BODY_WORD])
      expect(stored).not.toContain(secret);
    // The bot read that conversation through the tool, and only then saw its words, framed as outside data.
    expect(seen.opens).toEqual([CONV_ID]);
    expect(runs.length).toBeGreaterThan(1);
    expect(runs[1]!.prompt).toContain(BODY_WORD);
    expect(runs[1]!.prompt).toContain("UNTRUSTED EXTERNAL CONTENT");
  });

  test("the Chief gets the same context for a mailbox with no owner bot", async () => {
    reset();
    const c = (await mailboxChat(A, boxFree)).json.chat.conversationId as string;
    const r = await send(A, c, { context: ctx(boxFree) });
    expect(r.status).toBe(201);
    expect(runs[0]!.bot).toBe("Zetta");
    expect(runs[0]!.prompt).toContain(CONV_ID);
  });

  test("no context: no line, no ids on the scope", async () => {
    reset();
    const c = (await mailboxChat(A, boxOwned)).json.chat.conversationId as string;
    const r = await send(A, c, {}, "Find mail about invoices");
    expect(r.status).toBe(201);
    expect(runs[0]!.prompt).not.toContain("Zetta note");
  });

  test("a context that is not true is refused, not ignored, and no turn runs", async () => {
    reset();
    const mine = (await mailboxChat(A, boxOwned)).json.chat.conversationId as string;
    // Another person's mailbox.
    const theirs = await send(A, mine, { context: ctx(boxB) });
    expect(theirs.status).toBe(422);
    expect(theirs.json.error?.code ?? theirs.json.code).toBe("MAIL_CONTEXT");
    // A mailbox that does not exist.
    expect((await send(A, mine, { context: ctx(uuidv7()) })).status).toBe(422);
    // A chat that is not the mailbox's chat: a plain chat with the same bot, and the Chief's chat of another mailbox.
    const plain = (await call(A, "POST", "/api/conversations", { botId: ownerBot })).json
      .conversation.id as string;
    expect((await send(A, plain, { context: ctx(boxOwned) })).status).toBe(422);
    const freeChat = (await mailboxChat(A, boxFree)).json.chat.conversationId as string;
    expect((await send(A, freeChat, { context: ctx(boxOwned) })).status).toBe(422);
    expect(runs.length).toBe(0);
  });

  test("a bot that may not read the mailbox, or a retired mailbox, refuses the context", async () => {
    reset();
    const id = await connect("stale@example.invalid", "Stale", ownerBot);
    const c = (await mailboxChat(A, id)).json.chat.conversationId as string;
    expect((await send(A, c, { context: ctx(id) })).status).toBe(201);
    // The owner changed behind the chat's back (the pointer was left): the chat's bot no longer owns the mailbox.
    await db.$client.query("update mailbox set bot_id = $2 where id = $1", [id, otherBot]);
    expect((await send(A, c, { context: ctx(id) })).status).toBe(422);
    await db.$client.query("update mailbox set bot_id = $2 where id = $1", [id, ownerBot]);
    expect((await send(A, c, { context: ctx(id) })).status).toBe(201);
    await db.$client.query("update mailbox set state = 'retired' where id = $1", [id]);
    expect((await send(A, c, { context: ctx(id) })).status).toBe(422);
  });

  test("a conversation id or context of the wrong shape is a 400", async () => {
    const c = (await mailboxChat(A, boxOwned)).json.chat.conversationId as string;
    for (const bad of [
      ctx(boxOwned, ""),
      ctx(boxOwned, "has space"),
      ctx(boxOwned, "line\nbreak"),
      ctx(boxOwned, "x".repeat(4001)),
      ctx("not-a-uuid"),
      { ...ctx(boxOwned), kind: "calendar" },
      { ...ctx(boxOwned), subject: "forged" },
      { kind: "mail", mailboxId: boxOwned },
    ])
      expect((await send(A, c, { context: bad })).status).toBe(400);
  });

  test("a queued message keeps its context and is answered with the same line", async () => {
    reset();
    const c = (await mailboxChat(A, boxOwned)).json.chat.conversationId as string;
    const saved = await chat.enqueue(actorA, c, {
      content: "Summarise this conversation",
      clientRequestId: uuidv7(),
      mailContext: { mailboxId: boxOwned, conversationId: CONV_ID },
    });
    expect((saved.meta as { mail?: unknown }).mail).toEqual({
      mailboxId: boxOwned,
      conversationId: CONV_ID,
    });
    expect(await until(() => runs.length > 0)).toBe(true);
    expect(runs[0]!.prompt).toContain(
      mailContextLine({ mailboxId: boxOwned, conversationId: CONV_ID }),
    );
    // The queue refuses a context that is not true, as the send does.
    await expect(
      chat.enqueue(actorA, c, {
        content: "again",
        clientRequestId: uuidv7(),
        mailContext: { mailboxId: boxB, conversationId: CONV_ID },
      }),
    ).rejects.toMatchObject({ name: "MailContextError" });
  });
});
