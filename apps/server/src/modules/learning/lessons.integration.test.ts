import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { botLesson, botLessonEvent } from "@zetta/db/schema/learning";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createMemory } from "../memory/service";
import { createLessons, LessonError, lessonsQuery } from "./lessons";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `les-a-${uuidv7()}`;
const B = `les-b-${uuidv7()}`;

suite("lessons: the life of what a bot learned, step by step", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const memory = createMemory(db);
  const lessons = createLessons(db, { memory });
  let botId!: string;
  let convId!: string;
  let msgId!: string;

  beforeAll(async () => {
    const now = new Date();
    for (const id of [A, B]) {
      await db.insert(user).values({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .insert(membership)
        .values({ userId: id, status: "active", joinedAt: now, updatedAt: now });
    }
    botId = (
      await db
        .insert(bot)
        .values({
          ownerUserId: A,
          kind: "specialist",
          visibility: "private",
          name: "Learner",
          slug: `learner-${uuidv7().slice(-8)}`,
          harness: "claude-code",
        } as never)
        .returning()
    )[0]!.id;
    convId = (
      await db
        .insert(conversation)
        .values({ ownerUserId: A, botId, title: "t" } as never)
        .returning()
    )[0]!.id;
    msgId = (
      await db
        .insert(message)
        .values({
          conversationId: convId,
          ownerUserId: A,
          seq: 1,
          role: "user",
          content: "hello",
          status: "complete",
        } as never)
        .returning()
    )[0]!.id;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
    // Close this file's connections: every test file opens its own pool, and the shared test Postgres has a connection limit.
    await db.$client.end();
  });

  const propose = (text: string, over: Partial<Parameters<typeof lessons.propose>[0]> = {}) =>
    lessons.propose({
      ownerUserId: A,
      botId,
      text,
      topic: "reports",
      kind: "rule",
      scope: "topic",
      ...over,
    });
  const eventsOf = async (id: string) =>
    (await db.select().from(botLessonEvent).where(eq(botLessonEvent.lessonId, id))).map((e) => [
      e.kind,
      e.by,
    ]);

  test("a candidate goes on trial as a small memory item that only the system wrote and bots may only suggest changes to", async () => {
    const c = await propose("Send client reports as a table, never as running text.");
    expect(c).toMatchObject({ status: "candidate", basis: null, memoryItemId: null });
    const on = await lessons.promote(A, c.id, "said", "system");
    expect(on).toMatchObject({ status: "trial", basis: "said" });
    const item = (await memory.read({ userId: A, botId }, `lesson-${c.id.slice(-12)}`))!;
    expect(item.page).toMatchObject({
      type: "solo",
      authorBotId: botId,
      botAccess: "suggest",
      content: "Send client reports as a table, never as running text.",
      tags: ["lesson", "reports"],
      updatedBy: "system",
    });
    // The bot reads it, but cannot rewrite it: its change waits for the owner.
    const tried = await memory.write(
      A,
      {
        slug: item.page.slug,
        title: "x",
        content: "something else",
        type: "solo",
        authorBotId: botId,
      },
      { by: "bot", botId },
    );
    expect(tried.suggested).toBeDefined();
    expect((await memory.read(A, item.page.slug))!.page.content).toBe(c.text);
    expect(await eventsOf(c.id)).toEqual([
      ["proposed", "system"],
      ["promoted", "system"],
    ]);
    // Promoting again changes nothing.
    expect((await lessons.promote(A, c.id, "said", "system")).memoryItemId).toBe(on.memoryItemId);
  });

  test("keep, drop and restore: the item is archived and brought back, every step is written down, nothing is deleted", async () => {
    const c = await propose("Answer in Portuguese.", { topic: "language", scope: "always" });
    await lessons.promote(A, c.id, "repeated", "system");
    expect((await lessons.keep(A, c.id, "system")).status).toBe("kept");
    const slug = `lesson-${c.id.slice(-12)}`;
    const dropped = await lessons.drop(
      A,
      c.id,
      "bad_results",
      "system",
      "the person stepped in twice",
    );
    expect(dropped).toMatchObject({ status: "dropped", dropReason: "bad_results" });
    expect((await memory.read(A, slug))!.page.status).toBe("archived");
    const back = await lessons.restore(A, c.id);
    expect(back).toMatchObject({ status: "trial", dropReason: null });
    expect((await memory.read(A, slug))!.page.status).toBe("current");
    expect((await eventsOf(c.id)).map(([k]) => k)).toEqual([
      "proposed",
      "promoted",
      "kept",
      "dropped",
      "restored",
    ]);
    await expect(lessons.restore(A, c.id)).rejects.toMatchObject({ code: "INVALID" }); // it is not dropped
  });

  test("dropping a candidate rejects it; a procedure and a secret never become lessons", async () => {
    const waiting = await propose("Use the new export.");
    expect((await lessons.drop(A, waiting.id, "person", "person")).status).toBe("rejected");
    expect(await lessons.reject(A, waiting.id, "person")).toMatchObject({ status: "rejected" }); // saying no twice is fine

    const steps = await propose("1. Open the table. 2. Export it. 3. Check the totals.", {
      kind: "procedure",
    });
    await expect(lessons.promote(A, steps.id, "said", "person")).rejects.toMatchObject({
      code: "INVALID",
    });
    expect((await db.select().from(botLesson).where(eq(botLesson.id, steps.id)))[0]!.status).toBe(
      "candidate",
    );

    const secret = await propose(
      "The key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 for billing.",
    );
    await expect(lessons.promote(A, secret.id, "said", "system")).rejects.toBeInstanceOf(
      LessonError,
    );
    expect((await db.select().from(botLesson).where(eq(botLesson.id, secret.id)))[0]!.status).toBe(
      "rejected",
    );
    expect((await eventsOf(secret.id)).map(([k]) => k)).toEqual(["proposed", "refused"]);
  });

  test("evidence is kept once per message, and 'seen twice' counts distinct chats and days", async () => {
    const c = await propose("Keep answers short.");
    const other = (
      await db
        .insert(conversation)
        .values({ ownerUserId: A, botId, title: "t2" } as never)
        .returning()
    )[0]!.id;
    const otherMsg = (
      await db
        .insert(message)
        .values({
          conversationId: other,
          ownerUserId: A,
          seq: 1,
          role: "user",
          content: "short please",
          status: "complete",
        } as never)
        .returning()
    )[0]!.id;
    expect(
      await lessons.addEvidence(c.id, [
        { conversationId: convId, messageId: msgId, quote: "keep it short", day: "2026-11-16" },
      ]),
    ).toBe(1);
    expect(
      await lessons.addEvidence(c.id, [
        { conversationId: convId, messageId: msgId, quote: "keep it short", day: "2026-11-16" },
      ]),
    ).toBe(0); // the same message is not a second sighting
    expect(await lessons.spread(c.id)).toEqual({ chats: 1, days: 1 });
    await lessons.addEvidence(c.id, [
      { conversationId: other, messageId: otherMsg, quote: "short please", day: "2026-11-17" },
    ]);
    expect(await lessons.spread(c.id)).toEqual({ chats: 2, days: 2 });
  });

  test("candidates nobody saw again expire; the page lists everything with its evidence, steps and results", async () => {
    const old = await propose("An old remark that never came back.");
    await db
      .update(botLesson)
      .set({ updatedAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(botLesson.id, old.id));
    expect(
      await lessons.expireCandidates(new Date(Date.now() - 30 * 86_400_000)),
    ).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(botLesson).where(eq(botLesson.id, old.id)))[0]!.status).toBe(
      "expired",
    );

    const live = await propose("Mention the client name in every subject line.", {
      topic: "email",
    });
    await lessons.addEvidence(live.id, [
      {
        conversationId: convId,
        messageId: msgId,
        quote: "put the client name in the subject",
        day: "2026-11-17",
      },
    ]);
    await lessons.promote(A, live.id, "said", "system");
    const all = await lessons.list(A, lessonsQuery.parse({ bot: botId }));
    const view = all.find((l) => l.id === live.id)!;
    expect(view).toMatchObject({
      status: "trial",
      basis: "said",
      memorySlug: `lesson-${live.id.slice(-12)}`,
      seen: { chats: 1, days: 1 },
      evidence: [{ quote: "put the client name in the subject", day: "2026-11-17" }],
      results: { uses: 0, label: "unclear", reason: "New: added today, nothing has used it yet." },
    });
    expect(view.events.map((e) => e.kind)).toEqual(["proposed", "promoted"]);
    // Waiting and dropped lessons are told apart, and the expired one shows with the dropped ones.
    expect(
      (await lessons.list(A, lessonsQuery.parse({ status: "trial" }))).every(
        (l) => l.status === "trial",
      ),
    ).toBe(true);
    expect(
      (await lessons.list(A, lessonsQuery.parse({ status: "dropped" }))).some(
        (l) => l.id === old.id,
      ),
    ).toBe(true);
    expect(all.indexOf(view)).toBeLessThan(all.findIndex((l) => l.id === old.id)); // trial before expired
  });

  test("the person edits a lesson in use: its memory item changes with it; a dropped one must come back first", async () => {
    const c = await propose("Use metric units.", { topic: "units" });
    await lessons.promote(A, c.id, "said", "system");
    const edited = await lessons.edit(A, c.id, { text: "Use metric units, and say the unit." });
    expect(edited.text).toBe("Use metric units, and say the unit.");
    expect((await memory.read(A, `lesson-${c.id.slice(-12)}`))!.page.content).toBe(
      "Use metric units, and say the unit.",
    );
    await lessons.drop(A, c.id, "person", "person");
    await expect(lessons.edit(A, c.id, { text: "Nope" })).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(lessons.edit(A, c.id, { text: "x".repeat(301) })).rejects.toBeTruthy(); // one sentence, at most 300 characters
  });

  test("what the person allows has defaults, and a lesson is only ever theirs", async () => {
    expect(await lessons.policy(A)).toEqual({
      batch: "daily",
      forget: "on",
      tidy: "weekly",
      strictness: "normal",
    });
    expect(await lessons.setPolicy(A, { strictness: "strict", batch: "off" })).toEqual({
      batch: "off",
      forget: "on",
      tidy: "weekly",
      strictness: "strict",
    });
    expect((await lessons.policy(B)).strictness).toBe("normal");
    const mine = await propose("Private lesson.");
    await expect(lessons.promote(B, mine.id, "said", "person")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await lessons.list(B, lessonsQuery.parse({ bot: botId }))).toEqual([]);
  });
});
