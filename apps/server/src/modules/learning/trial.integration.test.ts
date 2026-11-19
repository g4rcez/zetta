import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { attentionItem } from "@zetta/db/schema/features";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { botLesson, botLessonEvent, itemUse, replyOutcome } from "@zetta/db/schema/learning";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createMemory } from "../memory/service";
import { createLessons } from "./lessons";
import { createTrial } from "./trial";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `tri-a-${uuidv7()}`;

type Outcome = "good" | "bad" | "neutral";

suite(
  "the trial: a lesson is kept or dropped by what happened after the replies that used it",
  () => {
    const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
    const memory = createMemory(db);
    const lessons = createLessons(db, { memory });
    const trial = createTrial(db, { lessons });
    let seq = 0;

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
    });
    afterAll(async () => {
      await cleanupTestUsers(db, [A]);
      // Close this file's connections: every test file opens its own pool, and the shared test Postgres has a connection limit.
      await db.$client.end();
    });

    const newBot = async () => {
      const [b] = await db
        .insert(bot)
        .values({
          ownerUserId: A,
          kind: "specialist",
          visibility: "private",
          name: "Judged",
          slug: `judged-${uuidv7().slice(-10)}`,
          harness: "claude-code",
        } as never)
        .returning();
      const [c] = await db
        .insert(conversation)
        .values({ ownerUserId: A, botId: b!.id, title: "t" } as never)
        .returning();
      return { b: b!, c: c! };
    };
    const onTrial = async (botId: string, text: string) => {
      const c = await lessons.propose({
        ownerUserId: A,
        botId,
        text,
        topic: "reports",
        kind: "rule",
        scope: "topic",
      });
      return lessons.promote(A, c.id, "said", "system");
    };
    /** A reply that had `itemId` in front of it, and how it went. */
    const result = async (
      botId: string,
      convId: string,
      itemId: string | null,
      outcome: Outcome,
      exposure: "relevant" | "shown" = "relevant",
    ) => {
      // After the lesson started (a trial only counts what happened after it did), and in the order they were made.
      const at = new Date(Date.now() + 1000 + ++seq);
      const [m] = await db
        .insert(message)
        .values({
          conversationId: convId,
          ownerUserId: A,
          seq: ++seq,
          role: "assistant",
          content: "x",
          status: "complete",
          botId,
          createdAt: at,
        } as never)
        .returning();
      if (itemId)
        await db.insert(itemUse).values({
          ownerUserId: A,
          botId,
          conversationId: convId,
          messageId: m!.id,
          refKind: "memory",
          refId: itemId,
          exposure,
          origin: "person",
          createdAt: at,
        });
      await db.insert(replyOutcome).values({
        messageId: m!.id,
        ownerUserId: A,
        botId,
        origin: "person",
        outcome,
        resolvedAt: at,
        createdAt: at,
      });
    };
    const run = async (
      botId: string,
      convId: string,
      itemId: string | null,
      outcomes: Outcome[],
    ) => {
      for (const o of outcomes) await result(botId, convId, itemId, o);
    };
    const status = async (id: string) =>
      (await db.select().from(botLesson).where(eq(botLesson.id, id)))[0]!;
    const eventKinds = async (id: string) =>
      (await db.select().from(botLessonEvent).where(eq(botLessonEvent.lessonId, id))).map(
        (e) => e.kind,
      );

    test("five uses with nothing bad among the last three: kept; fewer than five: still on trial", async () => {
      const { b, c } = await newBot();
      const l = await onTrial(b.id, "Send client reports as a table.");
      await run(b.id, c.id, l.memoryItemId, ["good", "good", "neutral", "good"]);
      expect(await trial.tick()).toEqual({ kept: 0, dropped: 0 });
      expect((await status(l.id)).status).toBe("trial");
      await result(b.id, c.id, l.memoryItemId, "good");
      expect((await trial.tick()).kept).toBeGreaterThanOrEqual(1);
      expect((await status(l.id)).status).toBe("kept");
      expect((await eventKinds(l.id)).slice(-1)).toEqual(["kept"]);
    });

    test("two bad results that are clearly worse than the person's usual: dropped, archived, with a notice and a way back", async () => {
      const { b, c } = await newBot();
      // The person usually steps in after 1 of 12 replies of this bot: 8%.
      await run(b.id, c.id, null, [...Array<Outcome>(11).fill("good"), "bad"]);
      const l = await onTrial(b.id, "Use the old export.");
      await run(b.id, c.id, l.memoryItemId, ["bad", "good", "bad"]);
      const done = await trial.tick();
      expect(done.dropped).toBeGreaterThanOrEqual(1);
      expect(await status(l.id)).toMatchObject({ status: "dropped", dropReason: "bad_results" });
      expect((await memory.read(A, `lesson-${l.id.slice(-12)}`))!.page.status).toBe("archived");
      const dropped = (
        await db.select().from(botLessonEvent).where(eq(botLessonEvent.lessonId, l.id))
      ).find((e) => e.kind === "dropped")!;
      expect(dropped.detail).toBe("the person stepped in after 2 of 3 replies that used it");
      expect(
        (await db.select().from(attentionItem).where(eq(attentionItem.ownerUserId, A))).some((n) =>
          n.title.includes("did not help"),
        ),
      ).toBe(true);
      // A way back: restored, it starts its trial again, judged on what happens from now on (the old uses are in the past).
      await db.$client.query(
        "update item_use set created_at = created_at - interval '1 hour' where ref_id = $1",
        [l.memoryItemId],
      );
      await lessons.restore(A, l.id);
      expect(await trial.tick()).toEqual({ kept: 0, dropped: 0 });
      expect((await status(l.id)).status).toBe("trial");
    });

    test("a lesson is not blamed for corrections the person makes anyway: judged against their usual rate with this bot", async () => {
      const { b, c } = await newBot();
      // This person steps in after half of the replies of this bot, whatever it uses.
      await run(b.id, c.id, null, [
        "bad",
        "good",
        "bad",
        "good",
        "bad",
        "good",
        "bad",
        "good",
        "bad",
        "good",
      ]);
      const l = await onTrial(b.id, "Always answer in Portuguese.");
      await run(b.id, c.id, l.memoryItemId, ["bad", "good", "bad", "good"]);
      await trial.tick();
      expect((await status(l.id)).status).toBe("trial"); // 50% is the usual here: not clearly worse
    });

    test("an item that was only in the prompt, with nothing to do with the reply, is not judged by that reply", async () => {
      const { b, c } = await newBot();
      const l = await onTrial(b.id, "Mention the client name in the subject.");
      await run(b.id, c.id, null, [...Array<Outcome>(10).fill("good")]);
      for (let i = 0; i < 3; i++) await result(b.id, c.id, l.memoryItemId, "bad", "shown");
      await trial.tick();
      expect((await status(l.id)).status).toBe("trial"); // 'shown' uses do not count: it never fit the work
    });

    test("a person who turned 'forget' off still gets lessons kept, but nothing is dropped without them", async () => {
      const { b, c } = await newBot();
      await lessons.setPolicy(A, { forget: "off" });
      await run(b.id, c.id, null, [...Array<Outcome>(10).fill("good")]);
      const bad = await onTrial(b.id, "A bad lesson.");
      await run(b.id, c.id, bad.memoryItemId, ["bad", "bad", "bad"]);
      const good = await onTrial(b.id, "A good lesson.");
      await run(b.id, c.id, good.memoryItemId, ["good", "good", "good", "good", "good"]);
      await trial.tick();
      expect((await status(bad.id)).status).toBe("trial");
      expect((await status(good.id)).status).toBe("kept");
      await lessons.setPolicy(A, { forget: "on" });
    });

    test("the strictness the person chose applies: strict drops at the first bad result, loose keeps after three uses", async () => {
      const { b, c } = await newBot();
      await run(b.id, c.id, null, [...Array<Outcome>(10).fill("good")]);
      await lessons.setPolicy(A, { strictness: "strict" });
      const hard = await onTrial(b.id, "A lesson under strict rules.");
      await run(b.id, c.id, hard.memoryItemId, ["good", "bad"]);
      await trial.tick();
      expect((await status(hard.id)).status).toBe("dropped");
      await lessons.setPolicy(A, { strictness: "loose" });
      const easy = await onTrial(b.id, "A lesson under loose rules.");
      await run(b.id, c.id, easy.memoryItemId, ["good", "good", "good"]);
      await trial.tick();
      expect((await status(easy.id)).status).toBe("kept");
      await lessons.setPolicy(A, { strictness: "normal" });
    });
  },
);
