import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { botLesson, botLessonEvent, replyOutcome } from "@zetta/db/schema/learning";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createMemory } from "../memory/service";
import { createLessons } from "./lessons";
import { createProgress } from "./progress";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `prg-a-${uuidv7()}`;
const B = `prg-b-${uuidv7()}`;
const DAY = 86_400_000;

suite("progress: how often the person had to step in, week by week", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const lessons = createLessons(db, { memory: createMemory(db) });
  // Wednesday 18 November 2026: the current week starts on Monday the 16th, and the twelve weeks start on 31 August.
  const clock = new Date("2026-11-18T12:00:00Z");
  const progress = createProgress(db, { now: () => clock });
  let botId!: string;
  let otherBotId!: string;
  const convs = new Map<string, string>();
  let seq = 0;

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
    const bots = await db
      .insert(bot)
      .values(
        ["One", "Two"].map((n) => ({
          ownerUserId: A,
          kind: "specialist",
          visibility: "private",
          name: n,
          slug: `prg-${n.toLowerCase()}-${uuidv7().slice(-8)}`,
          harness: "claude-code",
        })) as never,
      )
      .returning();
    [botId, otherBotId] = [bots[0]!.id, bots[1]!.id];
    for (const id of [botId, otherBotId])
      convs.set(
        id,
        (
          await db
            .insert(conversation)
            .values({ ownerUserId: A, botId: id, title: "t" } as never)
            .returning()
        )[0]!.id,
      );
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
    await db.$client.end();
  });

  /** `n` judged replies in the week that starts `weeksAgo` Mondays before the current one, `bad` of them stepped in on. */
  const week = async (
    weeksAgo: number,
    n: number,
    bad: number,
    o: { bot?: string; origin?: "person" | "server"; outcome?: "pending" } = {},
  ) => {
    const by = o.bot ?? botId;
    const at = new Date(Date.parse("2026-11-16T09:00:00Z") - weeksAgo * 7 * DAY + 2 * DAY);
    for (let i = 0; i < n; i++) {
      const [m] = await db
        .insert(message)
        .values({
          conversationId: convs.get(by)!,
          ownerUserId: A,
          seq: ++seq,
          role: "assistant",
          content: "x",
          status: "complete",
          botId: by,
          createdAt: at,
        } as never)
        .returning();
      await db.insert(replyOutcome).values({
        messageId: m!.id,
        ownerUserId: A,
        botId: by,
        origin: o.origin ?? "person",
        outcome: o.outcome ?? (i < bad ? "bad" : "good"),
        createdAt: at,
        resolvedAt: at,
      });
    }
  };
  /** A lesson step that happened `weeksAgo` Mondays ago. */
  const lessonEvent = async (
    lessonId: string,
    kind: "promoted" | "kept" | "dropped",
    weeksAgo: number,
  ) => {
    await db.insert(botLessonEvent).values({
      lessonId,
      kind,
      by: "system",
      at: new Date(Date.parse("2026-11-16T10:00:00Z") - weeksAgo * 7 * DAY + DAY),
    });
  };

  test("twelve weeks, the step-ins per hundred replies, the lessons of each week, and the last four weeks against the four before", async () => {
    // Earlier four weeks (7 to 4 weeks ago): 25 replies each, 10 stepped in on: 40 per 100. Last four (3 to 0): 25 each, 3 on: 12 per 100.
    for (const w of [7, 6, 5, 4]) await week(w, 25, 10);
    for (const w of [3, 2, 1, 0]) await week(w, 25, 3);
    // None of these count: not judged yet, started by the server, another bot, older than twelve weeks.
    await week(1, 5, 0, { outcome: "pending" });
    await week(1, 5, 5, { origin: "server" });
    await week(1, 40, 40, { bot: otherBotId });
    await week(14, 10, 10);
    const l1 = await lessons.propose({
      ownerUserId: A,
      botId,
      text: "Lesson one",
      topic: "x",
      kind: "rule",
      scope: "topic",
    });
    const l2 = await lessons.propose({
      ownerUserId: A,
      botId,
      text: "Lesson two",
      topic: "y",
      kind: "rule",
      scope: "topic",
    });
    await db.update(botLesson).set({ status: "kept" }).where(eq(botLesson.id, l1.id));
    await db.update(botLesson).set({ status: "dropped" }).where(eq(botLesson.id, l2.id));
    await lessonEvent(l1.id, "promoted", 4);
    await lessonEvent(l1.id, "kept", 2);
    await lessonEvent(l2.id, "promoted", 4);
    await lessonEvent(l2.id, "dropped", 1);

    const p = await progress.weekly(A, botId);
    expect(p.weeks).toHaveLength(12);
    expect(p.weeks[0]!.start).toBe("2026-08-31");
    expect(p.weeks.at(-1)!.start).toBe("2026-11-16");
    // The week that starts 4 weeks ago is index 7; the current week is index 11.
    expect(p.weeks[7]).toMatchObject({
      start: "2026-10-19",
      replies: 25,
      stepIns: 10,
      per100: 40,
      started: 2,
    });
    expect(p.weeks[9]).toMatchObject({ start: "2026-11-02", kept: 1 });
    expect(p.weeks[10]).toMatchObject({
      start: "2026-11-09",
      replies: 25,
      stepIns: 3,
      per100: 12,
      dropped: 1,
    });
    expect(p.weeks[11]).toMatchObject({ replies: 25, per100: 12 });
    expect(p.weeks[0]).toMatchObject({ replies: 0, stepIns: 0, per100: null }); // a quiet week has no rate, not a zero
    expect(p.earlier).toEqual({ replies: 100, stepIns: 40, per100: 40 });
    expect(p.recent).toEqual({ replies: 100, stepIns: 12, per100: 12 });
    expect(p.lessons).toEqual({ trial: 0, kept: 1, dropped: 1, waiting: 0 });
  });

  test("with too few replies on a side there is nothing to compare, and nobody else's bot can be read", async () => {
    const quiet = await progress.weekly(A, otherBotId);
    // This bot has 40 judged replies, all one week ago: the recent side exists, the earlier side has nothing to compare with.
    expect(quiet.recent).toEqual({ replies: 40, stepIns: 40, per100: 100 });
    expect(quiet.earlier).toBeNull();
    await expect(progress.weekly(B, botId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(progress.weekly(A, uuidv7())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
