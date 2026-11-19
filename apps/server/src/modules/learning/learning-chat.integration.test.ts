import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, desc, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { itemUse, replyOutcome } from "@zetta/db/schema/learning";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import type { Used } from "../chat/pipeline";
import { issueBackgroundActor } from "../identity/access";
import { createMemory } from "../memory/service";
import { createLearning } from "./index";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `lrc-a-${uuidv7()}`;

type FakeTurn = { prompt: string; signal?: AbortSignal; onUsed?: (u: Used) => void };

suite("learning in a chat turn: what the reply used is recorded when it is saved", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const memory = createMemory(db, {
    embedder: { embed: async () => [], model: "none", dim: 0 } as never,
  });
  const learning = createLearning(db);
  let script: ((t: FakeTurn) => AsyncGenerator<string, void>)[] = [];
  const fakeRun = Object.assign(async () => ({ text: "done", stopped: false }), {
    stream: (t: FakeTurn) =>
      (
        script.shift() ??
        async function* () {
          yield "done";
        }
      )(t),
  });
  const build = (l: Pick<typeof learning, "uses"> = learning) =>
    createChatService(
      db,
      fakeRun as never,
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
      { memory, learning: l },
    );
  const chat = build();
  let actor!: Awaited<ReturnType<typeof issueBackgroundActor>> & object;

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({
      id: A,
      name: A,
      email: `${A}@t.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: A, status: "active", joinedAt: now, updatedAt: now });
    actor = (await issueBackgroundActor(async () => ({ isAdmin: false }), A))!;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A]);
    // Close this file's connections: every test file opens its own pool, and the shared test Postgres has a connection limit.
    await db.$client.end();
  });

  const newChat = async () => {
    const [b] = await db
      .insert(bot)
      .values({
        ownerUserId: A,
        kind: "specialist",
        visibility: "private",
        name: `Chatty ${uuidv7().slice(-6)}`,
        slug: `chatty-${uuidv7().slice(-10)}`,
        harness: "claude-code",
      } as never)
      .returning();
    const [c] = await db
      .insert(conversation)
      .values({ ownerUserId: A, botId: b!.id, title: "t" } as never)
      .returning();
    return { b: b!, c: c! };
  };
  const ask = async (service: typeof chat, conversationId: string, content: string) => {
    const { follow, rec } = await service.startTurn(actor, conversationId, {
      content,
      clientRequestId: `req-${uuidv7()}`,
    });
    return { follow, rec };
  };
  const lastReply = async (conversationId: string) =>
    (
      await db
        .select()
        .from(message)
        .where(and(eq(message.conversationId, conversationId), eq(message.role, "assistant")))
        .orderBy(desc(message.seq))
        .limit(1)
    )[0]!;
  const settle = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 100 && !(await check()); i++) await Bun.sleep(20);
  };

  test("the procedures the prompt held are recorded as used, the always-there notes are not", async () => {
    const { c } = await newChat();
    const [note, procedure] = [uuidv7(), uuidv7()];
    script = [
      async function* (t) {
        t.onUsed?.({
          notes: [{ id: note }],
          instructions: [{ id: procedure }],
          items: ["listed-only"],
        });
        yield "Here you go.";
      },
    ];
    const { follow } = await ask(chat, c.id, "Export the sales table");
    for await (const _ of follow());
    const reply = await lastReply(c.id);
    await settle(
      async () =>
        (await db.select().from(itemUse).where(eq(itemUse.messageId, reply.id))).length > 0,
    );
    const rows = await db.select().from(itemUse).where(eq(itemUse.messageId, reply.id));
    expect(rows.map((r) => [r.refId, r.exposure, r.origin])).toEqual([
      [procedure, "relevant", "person"],
    ]);
    expect(
      (await db.select().from(replyOutcome).where(eq(replyOutcome.messageId, reply.id)))[0],
    ).toMatchObject({ outcome: "pending", origin: "person" });
  });

  test("a memory item the bot reads during the reply is saved on the reply and counted as loaded", async () => {
    const { b, c } = await newChat();
    const item = await memory.write(
      A,
      {
        slug: `lrc-${uuidv7().slice(-8)}`,
        title: "Billing runbook",
        content: "Run the nightly job at three.",
      },
      { by: "user" },
    );
    script = [
      async function* () {
        yield `Let me check.\n\`\`\`zetta:memory\n{"action":"read","slug":"${item.page.slug}"}\n\`\`\``;
      },
      async function* () {
        yield "It runs at three.";
      },
    ];
    const { follow } = await ask(chat, c.id, "When does billing run?");
    for await (const _ of follow());
    const reply = await lastReply(c.id);
    expect((reply.meta as { used?: Used } | null)?.used?.loaded).toEqual([{ id: item.page.id }]);
    await settle(
      async () =>
        (await db.select().from(itemUse).where(eq(itemUse.messageId, reply.id))).length > 0,
    );
    const rows = await db.select().from(itemUse).where(eq(itemUse.messageId, reply.id));
    expect(rows.map((r) => [r.refId, r.exposure, r.botId])).toEqual([
      [item.page.id, "loaded", b.id],
    ]);
  });

  test("a failure while recording never changes the reply", async () => {
    const { c } = await newChat();
    const broken = build({
      uses: {
        record: async () => {
          throw new Error("disk full");
        },
      },
    } as never);
    script = [
      async function* (t) {
        t.onUsed?.({ notes: [], instructions: [{ id: uuidv7() }] });
        yield "Still answered.";
      },
    ];
    const { follow } = await ask(broken, c.id, "hello");
    for await (const _ of follow());
    const reply = await lastReply(c.id);
    expect(reply).toMatchObject({ status: "complete", content: "Still answered." });
  });

  test("Stop ends the reply as cancelled and leaves no mark on it", async () => {
    const waitForAbort = (t: FakeTurn) =>
      (async function* () {
        yield "Working on it.";
        await new Promise<void>((res) => t.signal?.addEventListener("abort", () => res()));
      })();
    const stopped = await newChat();
    script = [waitForAbort];
    const second = await ask(chat, stopped.c.id, "start another long job");
    await settle(
      async () =>
        (await db.select().from(message).where(eq(message.conversationId, stopped.c.id))).length >=
        2,
    );
    await chat.cancelTurn(actor, stopped.c.id);
    for await (const _ of second.follow());
    await Bun.sleep(100);
    const reply = await lastReply(stopped.c.id);
    expect(reply.status).toBe("cancelled");
    expect((reply.meta as { ended?: string } | null)?.ended).toBeUndefined();
  });
});
