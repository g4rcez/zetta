import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { bot, conversation } from "@zetta/db/schema/chat";
import { discussion, discussionMember } from "@zetta/db/schema/discussions";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { BotPostNotAllowedError, insertMessage } from "./messages";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const owner = `guard-${uuidv7()}`;

suite("a bot posts only in its own chat or in a room it belongs to", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  let zetta = "",
    coach = "",
    chatOfZetta = "",
    roomWithCoach = "",
    roomWithoutCoach = "";
  const post = (conversationId: string, botId: string | null) =>
    insertMessage(db, conversationId, {
      ownerUserId: owner,
      role: botId ? "assistant" : "system",
      content: "hello",
      botId,
    });
  const makeBot = async (name: string) =>
    (
      await db
        .insert(bot)
        .values({
          ownerUserId: owner,
          name,
          slug: `${name.toLowerCase()}-${uuidv7().slice(-8)}`,
          kind: "specialist",
          visibility: "private",
        })
        .returning()
    )[0]!.id;
  const makeRoom = async (botId: string, members: string[]) => {
    const [conv] = await db
      .insert(conversation)
      .values({ ownerUserId: owner, botId, kind: "discussion", title: "Room" })
      .returning();
    const [d] = await db
      .insert(discussion)
      .values({
        ownerUserId: owner,
        conversationId: conv!.id,
        title: "Room",
        openKey: uuidv7(),
      })
      .returning();
    await db
      .insert(discussionMember)
      .values(members.map((m) => ({ discussionId: d!.id, botId: m })));
    return conv!.id;
  };

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({
      id: owner,
      name: owner,
      email: `${owner}@t.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: owner, status: "active", joinedAt: now, updatedAt: now });
    zetta = await makeBot("Zetta");
    coach = await makeBot("Coach");
    chatOfZetta = (
      await db
        .insert(conversation)
        .values({ ownerUserId: owner, botId: zetta, title: "Chat with Zetta" })
        .returning()
    )[0]!.id;
    roomWithCoach = await makeRoom(zetta, [zetta, coach]);
    roomWithoutCoach = await makeRoom(zetta, [zetta]);
  });
  afterAll(() => cleanupTestUsers(db, [owner]));

  test("a bot answers in its own chat and in a room where it is a member", async () => {
    expect((await post(chatOfZetta, zetta)).botId).toBe(zetta);
    expect((await post(roomWithCoach, coach)).botId).toBe(coach);
  });

  test("another bot cannot post in a chat that is not its own", async () => {
    await expect(post(chatOfZetta, coach)).rejects.toBeInstanceOf(BotPostNotAllowedError);
  });

  test("a bot that is not a member cannot post in a room", async () => {
    await expect(post(roomWithoutCoach, coach)).rejects.toBeInstanceOf(BotPostNotAllowedError);
  });

  test("system lines have no author and go anywhere", async () => {
    expect((await post(chatOfZetta, null)).botId).toBeNull();
  });

  test("the database refuses a foreign bot even when the insert skips the application", async () => {
    await expect(
      db.$client.query(
        "insert into message (conversation_id, owner_user_id, seq, role, content, author_bot_id) values ($1, $2, 99, 'assistant', 'x', $3)",
        [chatOfZetta, owner, coach],
      ),
    ).rejects.toThrow(/bot_post_not_allowed/);
  });
});
